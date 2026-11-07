// OpenAI API: GPT Image models, Sora video, and GPT models for the LLM node.
const fs = require('fs');
const path = require('path');
const { fetchJson, saveResult, localFile, b64, ApiError, P } = require('./common.js');

const BASE = 'https://api.openai.com/v1';
const hdr = (key) => ({ Authorization: `Bearer ${key}` });

const IMAGE_SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536'];
const LLM_ORDER = ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o'];

function classify(id) {
  if (/^gpt-image/.test(id)) return 'image';
  if (/^sora/.test(id)) return 'video';
  if (/^(gpt-6|gpt-5|gpt-4\.1|gpt-4o|o3|o4)/.test(id) && !/realtime|audio|transcribe|tts|search|image|embedding|codex|instruct|moderation|preview-\d{4}/.test(id)) return 'llm';
  return null;
}
const nice = (id) => id.replace(/^gpt-image-/, 'GPT Image ').replace(/^sora-/, 'Sora ').replace(/^gpt-/, 'GPT-').replace(/-(\w)/g, (m, c) => ' ' + c.toUpperCase());

function toModel(id) {
  const type = classify(id);
  if (!type) return null;
  const base = { job_type: `openai:${id}`, display_name: nice(id), type, provider: 'openai' };
  if (type === 'image') {
    return { ...base, params: [
      P('prompt', 'string', null, null, { required: true }),
      P('size', 'string', 'auto', IMAGE_SIZES),
      P('quality', 'string', 'auto', ['auto', 'low', 'medium', 'high']),
      P('background', 'string', 'auto', ['auto', 'opaque', 'transparent']),
      P('output_format', 'string', 'png', ['png', 'jpeg', 'webp']),
      P('image_urls', 'array[string]', null, null, { maxItems: 16 }),
    ], medias: [{ role: 'image', param: 'image_urls', multi: true, max: 16 }] };
  }
  if (type === 'video') {
    return { ...base, params: [
      P('prompt', 'string', null, null, { required: true }),
      P('size', 'string', '1280x720', ['1280x720', '720x1280', '1920x1080', '1080x1920']),
      P('duration', 'integer', 8, [4, 8, 12]),
      P('image_url', 'string', null),
    ], medias: [{ role: 'start_image', param: 'image_url', multi: false }] };
  }
  return { ...base, params: [
    P('prompt', 'string', null, null, { required: true }),
    P('temperature', 'number', 1, null, { min: 0, max: 2 }),
    P('image_urls', 'array[string]', null), P('audio_urls', 'array[string]', null),
  ], medias: [{ role: 'image', param: 'image_urls', multi: true }, { role: 'audio', param: 'audio_urls', multi: true }] };
}

async function listModels(key) {
  const r = await fetchJson(`${BASE}/models`, { headers: hdr(key), timeoutMs: 30000 });
  const ids = (r.data || []).map((m) => m.id);
  const out = ids.map(toModel).filter(Boolean);
  const rank = (m) => { const id = m.job_type.slice(7); const i = LLM_ORDER.indexOf(id); return i >= 0 ? i : 100; };
  out.sort((a, b) => rank(a) - rank(b) || b.job_type.localeCompare(a.job_type, undefined, { numeric: true }));
  return out;
}
async function verify(key) {
  try { await fetchJson(`${BASE}/models`, { headers: hdr(key), timeoutMs: 20000 }); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

async function generate(key, model, params, medias, count) {
  const id = model.replace(/^openai:/, '');
  if (/^sora/.test(id)) return generateVideo(key, id, params, medias, count);
  const refs = medias.filter((m) => m.role === 'image');
  const common = { model: id, prompt: params.prompt || '', n: 1 };
  for (const k of ['size', 'quality', 'background', 'output_format']) if (params[k] && params[k] !== 'auto') common[k] = params[k];
  if (params.size === 'auto' || !params.size) delete common.size;
  const call = async () => {
    if (refs.length) {
      const form = new FormData();
      for (const [k, v] of Object.entries(common)) form.append(k, String(v));
      for (const m of refs) { const f = await localFile(m); form.append('image[]', new Blob([fs.readFileSync(f.abs)], { type: f.mime }), path.basename(f.abs)); }
      return fetchJson(`${BASE}/images/edits`, { method: 'POST', headers: hdr(key), form, timeoutMs: 300000 });
    }
    return fetchJson(`${BASE}/images/generations`, { method: 'POST', headers: hdr(key), body: common, timeoutMs: 300000 });
  };
  const runs = await Promise.allSettled(Array.from({ length: count }, call));
  const jobs = [], errors = [];
  for (const r of runs) {
    if (r.status === 'rejected') { errors.push(r.reason.message); continue; }
    for (const d of r.value.data || []) {
      if (!d.b64_json) continue;
      const fmt = params.output_format || 'png';
      const url = saveResult(Buffer.from(d.b64_json, 'base64'), fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png', 'gptimage');
      jobs.push({ id: `openai:done:${url}`, status: 'completed', result_url: url });
    }
  }
  if (!jobs.length && !errors.length) errors.push('No image returned');
  return { jobs, errors };
}

async function generateVideo(key, id, params, medias, count) {
  const start = medias.find((m) => m.role === 'start_image' || m.role === 'image');
  const call = async () => {
    const form = new FormData();
    form.append('model', id); form.append('prompt', params.prompt || '');
    if (params.size) form.append('size', params.size);
    if (params.duration) form.append('seconds', String(params.duration));
    if (start) { const f = await localFile(start); form.append('input_reference', new Blob([fs.readFileSync(f.abs)], { type: f.mime }), path.basename(f.abs)); }
    return fetchJson(`${BASE}/videos`, { method: 'POST', headers: hdr(key), form, timeoutMs: 60000 });
  };
  const runs = await Promise.allSettled(Array.from({ length: count }, call));
  const jobs = [], errors = [];
  for (const r of runs) {
    if (r.status === 'rejected') errors.push(r.reason.message);
    else if (r.value && r.value.id) jobs.push({ id: `openai:${r.value.id}`, status: String(r.value.status || 'queued') });
    else errors.push('No video job returned');
  }
  return { jobs, errors };
}

async function job(key, id) {
  const vid = id.replace(/^openai:/, '');
  if (vid.startsWith('done:')) return { id, status: 'completed', result_url: vid.slice(5) };
  const r = await fetchJson(`${BASE}/videos/${vid}`, { headers: hdr(key), timeoutMs: 30000 });
  const status = String(r.status || 'queued');
  if (status === 'failed') return { id, status: 'failed', error: r.error?.message || 'Video generation failed' };
  if (status !== 'completed') return { id, status: status === 'in_progress' ? 'in_progress' : 'queued' };
  const res = await fetchJson(`${BASE}/videos/${vid}/content`, { headers: hdr(key), raw: true, timeoutMs: 300000 });
  const url = saveResult(Buffer.from(await res.arrayBuffer()), 'video/mp4', 'sora');
  return { id, status: 'completed', result_url: url, extra_urls: [] };
}

async function transcribe(key, f) {
  const form = new FormData();
  form.append('model', 'gpt-4o-transcribe');
  form.append('file', new Blob([fs.readFileSync(f.abs)], { type: f.mime }), path.basename(f.abs));
  const r = await fetchJson(`${BASE}/audio/transcriptions`, { method: 'POST', headers: hdr(key), form, timeoutMs: 300000 });
  return r.text || '';
}

async function complete(key, model, { system, instructions, prompt, medias = [], params = {} }) {
  const id = model.replace(/^openai:/, '');
  const content = [];
  if (prompt) content.push({ type: 'input_text', text: prompt });
  for (const m of medias) {
    const f = await localFile(m);
    if (m.label && f.mime.startsWith('image/')) content.push({ type: 'input_text', text: `${m.label}:` });
    if (f.mime.startsWith('image/')) content.push({ type: 'input_image', image_url: `data:${f.mime};base64,${b64(f.abs)}`, detail: 'auto' });
    else if (f.mime.startsWith('audio/')) content.push({ type: 'input_text', text: `[${m.label ? `${m.label}: transcript` : 'Transcript'} of ${path.basename(f.abs)}]\n${await transcribe(key, f)}` });
    else throw new ApiError('OpenAI text models cannot read video. Use a Gemini model for video input, or connect an image.');
  }
  if (instructions) content.push({ type: 'input_text', text: instructions });
  if (!content.length) content.push({ type: 'input_text', text: 'Describe the input.' });
  const body = { model: id, input: [{ role: 'user', content }] };
  if (system) body.instructions = system;
  if (params.temperature !== undefined && !/^o\d|gpt-5/.test(id)) body.temperature = Number(params.temperature);
  const r = await fetchJson(`${BASE}/responses`, { method: 'POST', headers: hdr(key), body, timeoutMs: 300000 });
  let text = r.output_text;
  if (!text) text = (r.output || []).flatMap((o) => o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('').trim();
  if (!text) throw new ApiError('The model returned nothing.');
  return { text };
}

module.exports = {
  id: 'openai', name: 'OpenAI', short: 'OpenAI',
  blurb: 'GPT Image models, Sora video and GPT models for the LLM node (audio is transcribed; video input not supported).',
  consoleUrl: 'https://platform.openai.com/api-keys',
  fields: [{ name: 'key', label: 'API key', placeholder: 'Add your API key', secret: true }],
  parseKey: (f) => (f.key || '').trim(),
  keyHint: (k) => `${k.slice(0, 7)}…${k.slice(-4)}`,
  verify, listModels, generate, job, complete,
  accepts: { image: true, video: false, audio: true },
};
