// fal.ai: many image and video models behind one key. Each model's inputs come from fal's own OpenAPI description,
// so any model id from fal.ai/models can be added in Settings and gets the right controls and ports.
const fs = require('fs');
const path = require('path');
const { ROOT, fetchJson, localFile, ApiError, mimeOf, b64 } = require('./common.js');

const QUEUE = 'https://queue.fal.run';
const STORAGE = 'https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3';
const PREFIX = 'fal:';
const SCHEMA_CACHE = path.join(ROOT, '.cache', 'fal-schemas.json');
const URL_CACHE = path.join(ROOT, 'uploads', '.fal-urls.json');
const DATA_URI_MAX = 8 * 1024 * 1024;

// Models offered until the user adds their own. Each must exist on fal.ai; the list is read fresh from fal's OpenAPI.
const DEFAULT_MODELS = [
  'fal-ai/nano-banana-pro', 'fal-ai/nano-banana-pro/edit', 'fal-ai/nano-banana-2', 'fal-ai/nano-banana', 'fal-ai/nano-banana/edit',
  'fal-ai/flux-pro/v1.1-ultra', 'fal-ai/flux/dev', 'fal-ai/bytedance/seedream/v4.5/text-to-image', 'fal-ai/bytedance/seedream/v4/edit',
  'fal-ai/gpt-image-1/text-to-image', 'fal-ai/ideogram/v3', 'fal-ai/recraft/v3/text-to-image', 'fal-ai/topaz/upscale/image', 'fal-ai/clarity-upscaler',
  'fal-ai/veo3.1', 'fal-ai/veo3.1/image-to-video', 'fal-ai/kling-video/v3/pro/text-to-video', 'fal-ai/kling-video/v3/pro/image-to-video',
  'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', 'fal-ai/bytedance/seedance/v1/pro/text-to-video', 'fal-ai/bytedance/seedance/v1/pro/image-to-video',
  'fal-ai/minimax/hailuo-2.3/pro/image-to-video', 'fal-ai/wan/v2.7/text-to-video', 'fal-ai/ltx-2/text-to-video', 'fal-ai/topaz/upscale/video',
];

function parse(key) {
  try { const j = JSON.parse(key); if (j && j.key) return { key: j.key, models: Array.isArray(j.models) ? j.models : [] }; } catch { /* plain key */ }
  return { key: String(key || '').trim(), models: [] };
}
const hdr = (k) => ({ Authorization: `Key ${parse(k).key}` });

// ---------- schemas from fal's OpenAPI ----------
let schemaCache = null;
function readSchemas() { if (schemaCache) return schemaCache; try { schemaCache = JSON.parse(fs.readFileSync(SCHEMA_CACHE, 'utf8')); } catch { schemaCache = {}; } return schemaCache; }
function writeSchemas() { try { fs.mkdirSync(path.dirname(SCHEMA_CACHE), { recursive: true }); fs.writeFileSync(SCHEMA_CACHE, JSON.stringify(schemaCache)); } catch { /* ignore */ } }
const SCHEMA_TTL = 7 * 24 * 3600 * 1000;

const first = (p, k) => (p[k] !== undefined ? p[k] : (p.anyOf || p.oneOf || []).map((x) => x[k]).find((v) => v !== undefined));
const typeOf = (p) => { const t = first(p, 'type'); if (Array.isArray(t)) return t.find((x) => x !== 'null') || 'string'; if (t) return t; return first(p, 'enum') ? 'string' : 'string'; };
function convert(id, api) {
  const schemas = (api.components && api.components.schemas) || {};
  const inName = Object.keys(schemas).find((k) => /input$/i.test(k)); const outName = Object.keys(schemas).find((k) => /output$/i.test(k));
  if (!inName) throw new ApiError(`fal.ai has no input description for "${id}". Check the id on fal.ai/models.`);
  const inp = schemas[inName]; const req = new Set(inp.required || []);
  const outProps = Object.keys((schemas[outName] || {}).properties || {});
  const type = outProps.some((k) => /video/i.test(k)) ? 'video' : 'image';
  const params = [], medias = [];
  for (const [name, p] of Object.entries(inp.properties || {})) {
    const t = typeOf(p);
    if (/^(image_urls|reference_image_urls)$/.test(name) || (t === 'array' && /image/.test(name))) { medias.push({ role: 'image', param: name, multi: true, max: p.maxItems || 10, required: req.has(name) }); continue; }
    if (/^(start_image_url|first_frame_url|first_image_url)$/.test(name)) { medias.push({ role: 'start_image', param: name, multi: false, required: req.has(name) }); continue; }
    if (/^(end_image_url|tail_image_url|last_frame_url|last_image_url)$/.test(name)) { medias.push({ role: 'end_image', param: name, multi: false }); continue; }
    if (/^(image_url|input_image_url|reference_image_url)$/.test(name)) { medias.push({ role: type === 'video' ? 'start_image' : 'image', param: name, multi: false, required: req.has(name) }); continue; }
    if (/^(video_url|input_video_url)$/.test(name)) { medias.push({ role: 'video', param: name, multi: false, required: req.has(name) }); continue; }
    if (/^video_urls$/.test(name)) { medias.push({ role: 'video', param: name, multi: true, max: p.maxItems || 4 }); continue; }
    if (/^audio_url$/.test(name)) { medias.push({ role: 'audio', param: name, multi: false }); continue; }
    if (/_url$/.test(name) || t === 'object') continue; // masks, loras and the like are not something a node can feed
    const out = { name, type: t === 'array' ? 'array[string]' : t, required: req.has(name) };
    const en = first(p, 'enum'); if (en && en.length) out.enum = en;
    const d = first(p, 'default'); if (d !== undefined && d !== null) out.default = d;
    const mn = first(p, 'minimum'), mx = first(p, 'maximum'); if (mn !== undefined) out.min = mn; if (mx !== undefined) out.max = mx;
    params.push(out);
  }
  // Short, readable names: "fal-ai/kling-video/v3/pro/image-to-video" → "Kling Video v3 Pro · Image to video"
  const segs = id.replace(/^fal-ai\//, '').split('/');
  const task = /^(text|image|video|reference)-to-(image|video)$|^edit$|^upscale$/.test(segs[segs.length - 1]) ? segs.pop() : '';
  const name = segs.map((s) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bV(\d)/g, 'v$1')).join(' ') + (task ? ` · ${task.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}` : '');
  return { job_type: PREFIX + id, display_name: name, description: '', type, provider: 'fal', slug: id, params, medias, outputs: outProps };
}
async function describe(id) {
  const cache = readSchemas();
  if (cache[id] && Date.now() - cache[id].at < SCHEMA_TTL) return cache[id].model;
  const api = await fetchJson(`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(id)}`, { timeoutMs: 20000 });
  const model = convert(id, api);
  cache[id] = { at: Date.now(), model }; writeSchemas();
  return model;
}
async function listModels(key) {
  const ids = [...new Set([...DEFAULT_MODELS, ...parse(key).models])];
  const out = await Promise.all(ids.map((id) => describe(id).catch(() => null)));
  return out.filter(Boolean);
}
async function verify(key) {
  if (!parse(key).key) return { ok: false, error: 'Paste the API key from fal.ai → Keys.' };
  try { await fetchJson(`${QUEUE}/fal-ai/flux/dev/requests/00000000-0000-0000-0000-000000000000/status`, { headers: hdr(key), timeoutMs: 20000 }); return { ok: true }; }
  catch (e) {
    if (e.code === 'API_AUTH') return { ok: false, error: 'fal.ai rejected the key.' };
    if (e.code === 'NETWORK') return { ok: false, error: e.message };
    return { ok: true }; // reachable and authenticated; the probe request simply does not exist
  }
}

// ---------- files ----------
function readUrls() { try { return JSON.parse(fs.readFileSync(URL_CACHE, 'utf8')); } catch { return {}; } }
async function publicUrl(key, m) {
  if (m.url && /^https?:\/\//.test(m.url) && !/localhost|127\.0\.0\.1/.test(m.url)) return m.url;
  const f = await localFile(m);
  const size = fs.statSync(f.abs).size; const mime = mimeOf(f.abs);
  const cache = readUrls(); const ck = `${path.basename(f.abs)}:${size}`;
  if (cache[ck]) return cache[ck];
  try {
    // fal's storage: ask for an upload slot, PUT the bytes, use the returned address.
    const slot = await fetchJson(STORAGE, { method: 'POST', headers: hdr(key), body: { content_type: mime, file_name: path.basename(f.abs) }, timeoutMs: 30000 });
    if (!slot || !slot.upload_url || !slot.file_url) throw new ApiError('No upload slot');
    const put = await fetch(slot.upload_url, { method: 'PUT', body: fs.readFileSync(f.abs), headers: { 'Content-Type': mime } });
    if (!put.ok) throw new ApiError(`Upload failed (HTTP ${put.status})`);
    cache[ck] = slot.file_url; try { fs.writeFileSync(URL_CACHE, JSON.stringify(cache, null, 1)); } catch { /* ignore */ }
    return slot.file_url;
  } catch (e) {
    if (size <= DATA_URI_MAX) return `data:${mime};base64,${b64(f.abs)}`; // small files can ride inside the request
    throw new ApiError(`Could not upload "${path.basename(f.abs)}" to fal.ai (${e.message}).`);
  }
}

// ---------- generation ----------
async function generate(key, model, params, medias, count) {
  const id = model.replace(PREFIX, '');
  const spec = await describe(id);
  const input = {};
  const known = new Set(spec.params.map((p) => p.name));
  for (const [k, v] of Object.entries(params)) if (known.has(k) && v !== undefined && v !== null && v !== '') { const p = spec.params.find((x) => x.name === k); input[k] = p.type === 'integer' || p.type === 'number' ? Number(v) : v; }
  const byRole = {}; for (const m of medias) (byRole[m.role] ||= []).push(m);
  for (const [role, items] of Object.entries(byRole)) {
    let slot = spec.medias.find((s) => s.role === role);
    if (!slot && role === 'image' && spec.type === 'video') slot = spec.medias.find((s) => s.role === 'start_image' && !byRole.start_image);
    if (!slot) throw new ApiError(`${spec.display_name} doesn't take ${role === 'image' ? 'an image' : `a ${role.replace('_', ' ')}`} input.`);
    const urls = []; for (const it of items.slice(0, slot.multi ? slot.max || 10 : 1)) urls.push(await publicUrl(key, it));
    input[slot.param] = slot.multi ? urls : urls[0];
  }
  for (const s of spec.medias) if (s.required && input[s.param] === undefined) throw new ApiError(`${spec.display_name} needs ${s.role === 'image' ? 'an image' : `a ${s.role.replace('_', ' ')}`} connected.`);
  const runs = await Promise.allSettled(Array.from({ length: count }, () => fetchJson(`${QUEUE}/${id}`, { method: 'POST', headers: hdr(key), body: input, timeoutMs: 60000 })));
  const jobs = [], errors = [];
  for (const r of runs) {
    if (r.status === 'rejected') errors.push(r.reason.message);
    else if (r.value && r.value.response_url) jobs.push({ id: PREFIX + Buffer.from(r.value.response_url).toString('base64url'), status: 'queued' });
    else errors.push('fal.ai did not return a request id');
  }
  return { jobs, errors };
}

async function job(key, id) {
  const responseUrl = Buffer.from(id.replace(PREFIX, ''), 'base64url').toString('utf8');
  const st = await fetchJson(`${responseUrl}/status`, { headers: hdr(key), timeoutMs: 30000 });
  const status = String(st.status || 'IN_QUEUE').toUpperCase();
  if (status === 'IN_QUEUE') return { id, status: 'queued' };
  if (status === 'IN_PROGRESS') return { id, status: 'in_progress' };
  if (status !== 'COMPLETED') return { id, status: 'failed', error: st.error || `Request ${status.toLowerCase()}` };
  const out = await fetchJson(responseUrl, { headers: hdr(key), timeoutMs: 60000 });
  const urls = [];
  const take = (x) => { if (!x) return; if (typeof x === 'string') urls.push(x); else if (Array.isArray(x)) x.forEach(take); else if (x.url) urls.push(x.url); };
  take(out.images); take(out.image); take(out.video); take(out.videos); take(out.output);
  if (!urls.length) return { id, status: 'failed', error: out.detail || 'No result returned' };
  const local = [];
  for (const u of urls) { try { const f = await localFile({ url: u }); local.push(`/uploads/${path.basename(f.abs)}`); } catch { local.push(u); } }
  return { id, status: 'completed', result_url: local[0], extra_urls: local.slice(1) };
}

module.exports = {
  id: 'fal', name: 'fal.ai', short: 'fal',
  blurb: 'Nano Banana, Flux, Seedream, Veo, Kling, Seedance, Hailuo, Wan, LTX, Topaz upscaling and any other model id from fal.ai.',
  consoleUrl: 'https://fal.ai/dashboard/keys',
  fields: [
    { name: 'key', label: 'API key', placeholder: 'Add your API key', secret: true },
    { name: 'models', label: 'More models', placeholder: 'Optional: extra model ids, e.g. fal-ai/flux/schnell, comma separated' },
  ],
  parseKey: (f) => {
    const key = (f.key || '').trim();
    if (!key) throw new ApiError('Paste the API key from fal.ai.', { code: 'BAD_KEY' });
    const models = String(f.models || '').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    return JSON.stringify({ key, models });
  },
  keyHint: (k) => { const p = parse(k); return `${p.key.slice(0, 6)}…${p.key.slice(-4)}`; },
  verify, listModels, generate, job,
  accepts: { image: true, video: true, audio: true },
};
