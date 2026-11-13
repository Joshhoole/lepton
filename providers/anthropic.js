// Anthropic API: Claude models for the LLM node (Messages API, raw HTTP to keep the app dependency-free).
const { fetchJson, localFile, b64, ApiError, P } = require('./common.js');

const BASE = 'https://api.anthropic.com/v1';
const hdr = (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' });

// Preferred order at the top of the picker; everything else follows newest-first.
const ORDER = ['claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'];

function toModel(m) {
  const id = m.id;
  if (!/^claude/.test(id)) return null;
  return {
    job_type: `anthropic:${id}`, display_name: m.display_name || id, description: '', type: 'llm', provider: 'anthropic', created_at: m.created_at,
    params: [P('prompt', 'string', null, null, { required: true }), P('image_urls', 'array[string]', null)],
    medias: [{ role: 'image', param: 'image_urls', multi: true }],
  };
}

async function listModels(key) {
  const out = [];
  let after = null;
  do {
    const r = await fetchJson(`${BASE}/models?limit=100${after ? `&after_id=${after}` : ''}`, { headers: hdr(key), timeoutMs: 30000 });
    for (const m of r.data || []) { const x = toModel(m); if (x) out.push(x); }
    after = r.has_more ? r.last_id : null;
  } while (after);
  const rank = (m) => { const i = ORDER.indexOf(m.job_type.slice(10)); return i >= 0 ? i : 100; };
  out.sort((a, b) => rank(a) - rank(b) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return out;
}
async function verify(key) {
  try { await fetchJson(`${BASE}/models?limit=1`, { headers: hdr(key), timeoutMs: 20000 }); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// Claude has no image or video generation endpoint; this provider only serves the LLM node.
async function generate() { throw new ApiError('Anthropic models generate text only. Use them in an LLM node.'); }
async function job(key, id) { return { id, status: 'failed', error: 'Not a generation job' }; }

async function complete(key, model, { system, instructions, prompt, medias = [], params = {} }) {
  const id = model.replace(/^anthropic:/, '');
  const content = [];
  for (const m of medias) {
    const f = await localFile(m);
    if (m.label && f.mime.startsWith('image/')) content.push({ type: 'text', text: `${m.label}:` });
    if (f.mime.startsWith('image/')) content.push({ type: 'image', source: { type: 'base64', media_type: f.mime === 'image/jpg' ? 'image/jpeg' : f.mime, data: b64(f.abs) } });
    else throw new ApiError('Claude reads images but not video or audio. Use a Gemini model for those inputs, or connect an image.');
  }
  const userText = [prompt, instructions].filter(Boolean).join('\n\n') || 'Describe the input.';
  content.push({ type: 'text', text: userText });
  const body = { model: id, max_tokens: 16000, messages: [{ role: 'user', content }] };
  if (system) body.system = system;
  if (params.temperature !== undefined && !/opus-5|fable|sonnet-5|opus-4-[78]/.test(id)) body.temperature = Number(params.temperature);
  const r = await fetchJson(`${BASE}/messages`, { method: 'POST', headers: hdr(key), body, timeoutMs: 600000 });
  if (r.stop_reason === 'refusal') throw new ApiError(`Claude declined this request${r.stop_details?.explanation ? `: ${r.stop_details.explanation}` : '.'}`);
  const text = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  if (!text) throw new ApiError('The model returned nothing.');
  return { text };
}

module.exports = {
  id: 'anthropic', name: 'Anthropic', short: 'Claude',
  blurb: 'Claude models for the LLM node (reads images; no video or audio input, no image generation).',
  consoleUrl: 'https://console.anthropic.com/settings/keys',
  fields: [{ name: 'key', label: 'API key', placeholder: 'Add your API key', secret: true }],
  parseKey: (f) => (f.key || '').trim(),
  keyHint: (k) => `${k.slice(0, 10)}…${k.slice(-4)}`,
  verify, listModels, generate, job, complete,
  accepts: { image: true, video: false, audio: false },
};
