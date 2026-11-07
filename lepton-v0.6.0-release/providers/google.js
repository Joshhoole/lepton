// Google Gemini API: Nano Banana image models, Veo video, and Gemini multimodal LLMs.
const fs = require('fs');
const { fetchJson, saveResult, localFile, b64, ApiError, P, kindOf } = require('./common.js');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const hdr = (key) => ({ 'x-goog-api-key': key });

const ASPECTS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const IMAGE_ORDER = ['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-2.5-flash-image'];
const NICE = { 'gemini-3-pro-image': 'Nano Banana Pro', 'gemini-3.1-flash-image': 'Nano Banana 2', 'gemini-3.1-flash-lite-image': 'Nano Banana 2 Lite', 'gemini-2.5-flash-image': 'Nano Banana' };

function classify(m) {
  const id = m.name.replace(/^models\//, '');
  const methods = m.supportedGenerationMethods || [];
  if (/embedding|embed|aqa|tts|transcribe|imagen|learnlm|gemma/i.test(id)) return null;
  if (/veo/i.test(id) && methods.includes('predictLongRunning')) return 'video';
  if (/image/i.test(id) && methods.includes('generateContent')) return 'image';
  if (/^gemini/i.test(id) && methods.includes('generateContent') && !/omni|live|audio|native|computer|robotics|deep-research/i.test(id)) return 'llm';
  return null;
}

function toModel(m) {
  const id = m.name.replace(/^models\//, '');
  const type = classify(m);
  if (!type) return null;
  const base = { job_type: `google:${id}`, display_name: NICE[id] || m.displayName || id, description: m.description || '', type, provider: 'google' };
  if (type === 'image') {
    const isPro = /pro/.test(id);
    return { ...base, display_name: NICE[id] || m.displayName, params: [
      P('prompt', 'string', null, null, { required: true }),
      P('aspect_ratio', 'string', '1:1', ASPECTS),
      P('image_size', 'string', '1K', isPro ? ['1K', '2K', '4K'] : ['512px', '1K', '2K', '4K']),
      P('image_urls', 'array[string]', null, null, { maxItems: isPro ? 6 : 14 }),
    ], medias: [{ role: 'image', param: 'image_urls', multi: true, max: isPro ? 6 : 14 }] };
  }
  if (type === 'video') {
    return { ...base, params: [
      P('prompt', 'string', null, null, { required: true }),
      P('aspect_ratio', 'string', '16:9', ['16:9', '9:16']),
      P('duration', 'integer', 8, [4, 6, 8]),
      P('resolution', 'string', '720p', /lite/.test(id) ? ['720p', '1080p'] : ['720p', '1080p', '4k']),
      P('negative_prompt', 'string', null),
      P('image_url', 'string', null),
    ], medias: [{ role: 'start_image', param: 'image_url', multi: false }] };
  }
  return { ...base, params: [
    P('prompt', 'string', null, null, { required: true }),
    P('temperature', 'number', 1, null, { min: 0, max: 2 }),
    P('image_urls', 'array[string]', null), P('video_urls', 'array[string]', null), P('audio_urls', 'array[string]', null),
  ], medias: [
    { role: 'image', param: 'image_urls', multi: true }, { role: 'video', param: 'video_urls', multi: true }, { role: 'audio', param: 'audio_urls', multi: true },
  ], inputTokenLimit: m.inputTokenLimit };
}

async function listModels(key) {
  const out = [];
  let token = null;
  do {
    const r = await fetchJson(`${BASE}/models?pageSize=1000${token ? `&pageToken=${token}` : ''}`, { headers: hdr(key), timeoutMs: 30000 });
    for (const m of r.models || []) { const x = toModel(m); if (x) out.push(x); }
    token = r.nextPageToken;
  } while (token);
  // A "-preview" id that also exists without the suffix is an alias: keep one.
  const ids = new Set(out.map((m) => m.job_type));
  for (let i = out.length - 1; i >= 0; i--) {
    const id = out[i].job_type;
    if (/-preview$/.test(id) && ids.has(id.replace(/-preview$/, ''))) out.splice(i, 1);
  }
  // Curated order: Nano Banana Pro first, then 2, then lite; LLMs newest-looking first.
  const rank = (m) => { const id = m.job_type.slice(7); const i = IMAGE_ORDER.indexOf(id); return i >= 0 ? i : 100; };
  out.sort((a, b) => rank(a) - rank(b) || b.job_type.localeCompare(a.job_type, undefined, { numeric: true }));
  return out;
}

async function verify(key) {
  try { await fetchJson(`${BASE}/models?pageSize=1`, { headers: hdr(key), timeoutMs: 20000 }); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// Build inline parts for media inputs. Gemini reads images, video and audio natively.
async function mediaParts(medias) {
  const parts = [];
  for (const m of medias) {
    const f = await localFile(m);
    const size = fs.statSync(f.abs).size;
    if (size > 19 * 1024 * 1024) throw new ApiError(`"${require('path').basename(f.abs)}" is ${Math.round(size / 1048576)} MB; inline media must stay under 20 MB.`);
    if (m.label) parts.push({ text: `${m.label}:` }); // lets "image 2" in the prompt point at the right attachment
    parts.push({ inline_data: { mime_type: f.mime, data: b64(f.abs) } });
  }
  return parts;
}

async function generate(key, model, params, medias, count) {
  const id = model.replace(/^google:/, '');
  if (/veo/.test(id)) return generateVideo(key, id, params, medias, count);
  const parts = [{ text: params.prompt || '' }, ...(await mediaParts(medias.filter((m) => m.role === 'image')))];
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: params.aspect_ratio || '1:1', imageSize: params.image_size || '1K' },
    },
  };
  const runs = await Promise.allSettled(Array.from({ length: count }, () => fetchJson(`${BASE}/models/${id}:generateContent`, { method: 'POST', headers: hdr(key), body, timeoutMs: 180000 })));
  const jobs = [], errors = [];
  for (const r of runs) {
    if (r.status === 'rejected') { errors.push(r.reason.message); continue; }
    const cparts = r.value.candidates?.[0]?.content?.parts || [];
    const img = cparts.find((p) => p.inlineData || p.inline_data);
    if (!img) { errors.push(r.value.candidates?.[0]?.finishReason ? `Blocked: ${r.value.candidates[0].finishReason}` : (cparts.find((p) => p.text)?.text || 'No image returned')); continue; }
    const d = img.inlineData || img.inline_data;
    const url = saveResult(Buffer.from(d.data, 'base64'), d.mimeType || d.mime_type || 'image/png', 'nano');
    jobs.push({ id: `google:done:${url}`, status: 'completed', result_url: url });
  }
  return { jobs, errors };
}

async function generateVideo(key, id, params, medias, count) {
  const inst = { prompt: params.prompt || '' };
  const start = medias.find((m) => m.role === 'start_image' || m.role === 'image');
  if (start) { const f = await localFile(start); inst.image = { inlineData: { mimeType: f.mime, data: b64(f.abs) } }; }
  const parameters = {
    aspectRatio: params.aspect_ratio || '16:9',
    durationSeconds: String(params.duration || 8),
    resolution: params.resolution || '720p',
    personGeneration: start ? 'allow_adult' : 'allow_all',
  };
  if (params.negative_prompt) parameters.negativePrompt = params.negative_prompt;
  const runs = await Promise.allSettled(Array.from({ length: count }, () => fetchJson(`${BASE}/models/${id}:predictLongRunning`, { method: 'POST', headers: hdr(key), body: { instances: [inst], parameters }, timeoutMs: 60000 })));
  const jobs = [], errors = [];
  for (const r of runs) {
    if (r.status === 'rejected') errors.push(r.reason.message);
    else if (r.value && r.value.name) jobs.push({ id: `google:${r.value.name}`, status: 'queued' });
    else errors.push('No operation returned');
  }
  return { jobs, errors };
}

async function job(key, id) {
  const op = id.replace(/^google:/, '');
  if (op.startsWith('done:')) return { id, status: 'completed', result_url: op.slice(5) };
  const r = await fetchJson(`${BASE}/${op}`, { headers: hdr(key), timeoutMs: 30000 });
  if (r.error) return { id, status: 'failed', error: r.error.message || JSON.stringify(r.error) };
  if (!r.done) return { id, status: 'in_progress' };
  const resp = r.response || {};
  const samples = resp.generateVideoResponse?.generatedSamples || resp.generatedSamples || [];
  const uri = samples[0]?.video?.uri;
  if (!uri) {
    const reason = resp.generateVideoResponse?.raiMediaFilteredReasons?.[0] || resp.raiMediaFilteredReasons?.[0];
    return { id, status: 'failed', error: reason || 'No video returned' };
  }
  // Download needs the key header, so fetch server-side and serve locally.
  const f = await localFile({ url: uri }, hdr(key));
  const rel = `/uploads/${require('path').basename(f.abs)}`;
  return { id, status: 'completed', result_url: rel, extra_urls: [] };
}

// LLM: instruction + upstream prompt text + any media → text.
async function complete(key, model, { system, instructions, prompt, medias = [], params = {} }) {
  const id = model.replace(/^google:/, '');
  const parts = [];
  if (prompt) parts.push({ text: prompt });
  parts.push(...(await mediaParts(medias)));
  if (instructions) parts.push({ text: instructions });
  if (!parts.length) parts.push({ text: 'Describe the input.' });
  const body = { contents: [{ role: 'user', parts }], generationConfig: {} };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (params.temperature !== undefined) body.generationConfig.temperature = Number(params.temperature);
  const r = await fetchJson(`${BASE}/models/${id}:generateContent`, { method: 'POST', headers: hdr(key), body, timeoutMs: 300000 });
  const text = (r.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new ApiError(r.candidates?.[0]?.finishReason ? `The model returned nothing (${r.candidates[0].finishReason}).` : 'The model returned nothing.');
  return { text };
}

module.exports = {
  id: 'google', name: 'Google Gemini', short: 'Google',
  blurb: 'Nano Banana image models, Veo video and Gemini models for the LLM node.',
  consoleUrl: 'https://aistudio.google.com/apikey',
  fields: [{ name: 'key', label: 'API key', placeholder: 'Add your API key', secret: true }],
  parseKey: (f) => (f.key || '').trim(),
  keyHint: (k) => `${k.slice(0, 6)}…${k.slice(-4)}`,
  verify, listModels, generate, job, complete,
  accepts: { image: true, video: true, audio: true },
};
