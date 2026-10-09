// Higgsfield API: Seedance, Kling, Wan, Soul and the rest of the Higgsfield catalogue.
const fs = require('fs');
const path = require('path');
const { ROOT, UPLOADS, fetchJson, localFile, ApiError, mimeOf } = require('./common.js');

const BASE = (process.env.HIGGSFIELD_API || 'https://api.higgsfield.ai').replace(/\/$/, '');
const CATALOG_PATH = path.join(ROOT, 'public', 'catalog-api.json');
const DOCS_CACHE = path.join(ROOT, '.cache', 'model-docs.json');
const URL_CACHE = path.join(UPLOADS, '.api-urls.json');
const hdr = (key) => ({ Authorization: `Key ${key}` });
const PREFIX = 'hf:';

// ---------- schema helpers ----------
function mediaRolesFor(params, type = 'image') {
  const roles = [];
  for (const p of params) {
    const n = p.name; const isArr = String(p.type).startsWith('array');
    if (/^(first_frame|start_image|start_frame|image_start|init_image|first_image)/.test(n)) roles.push({ role: 'start_image', param: n, multi: false, required: !!p.required });
    else if (/^(last_frame|end_image|end_frame|image_end|tail_image|last_image)/.test(n)) roles.push({ role: 'end_image', param: n, multi: false });
    else if (n === 'image_urls' || n === 'reference_image_urls' || n === 'reference_images' || n === 'images' || (isArr && /image/.test(n))) roles.push({ role: 'image', param: n, multi: true, max: p.maxItems, required: !!p.required });
    else if (n === 'image_url' || n === 'image' || n === 'reference_image_url' || n === 'input_image' || /image_url$/.test(n)) roles.push({ role: type === 'video' ? 'start_image' : 'image', param: n, multi: false, required: !!p.required });
    else if (n === 'video_urls' || (isArr && /video/.test(n))) roles.push({ role: 'video', param: n, multi: true, max: p.maxItems });
    else if (n === 'video_url' || n === 'video') roles.push({ role: 'video', param: n, multi: false, required: !!p.required });
    else if (n === 'audio_urls') roles.push({ role: 'audio', param: n, multi: true });
    else if (n === 'audio_url' || n === 'audio') roles.push({ role: 'audio', param: n, multi: false });
  }
  return roles;
}
function paramsFromJsonSchema(schema) {
  if (!schema || typeof schema !== 'object') return [];
  const required = new Set(schema.required || []);
  return Object.entries(schema.properties || {}).map(([name, p]) => {
    let type = p.type;
    if (!type && Array.isArray(p.anyOf)) type = p.anyOf.map((t) => t.type).filter(Boolean).join('|');
    if (Array.isArray(type)) type = type.join('|');
    if (type === 'array' && p.items && p.items.type) type = `array[${p.items.type}]`;
    const out = { name, type: type || 'string', required: required.has(name) };
    const en = p.enum || (p.anyOf || []).flatMap((t) => t.enum || []);
    if (en && en.length) out.enum = en;
    if (p.default !== undefined) out.default = p.default;
    if (p.minimum !== undefined) out.min = p.minimum;
    if (p.maximum !== undefined) out.max = p.maximum;
    if (p.maxItems !== undefined) out.maxItems = p.maxItems;
    return out;
  });
}
let bundled = null;
function bundledCatalogue() {
  if (bundled) return bundled;
  try { bundled = new Map((JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')).models || []).map((m) => [m.endpoint, m])); } catch { bundled = new Map(); }
  return bundled;
}
let docsCache = null;
function readDocsCache() { if (docsCache) return docsCache; try { docsCache = JSON.parse(fs.readFileSync(DOCS_CACHE, 'utf8')); } catch { docsCache = {}; } return docsCache; }
function writeDocsCache() { try { fs.mkdirSync(path.dirname(DOCS_CACHE), { recursive: true }); fs.writeFileSync(DOCS_CACHE, JSON.stringify(docsCache)); } catch { /* ignore */ } }

// Parameter tables embedded in the public model pages.
function parseParamTable(text) {
  const t = text.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&').replace(/\\"/g, '"').replace(/\\n/g, '\n');
  const re = /^\| `([a-z_0-9]+)` \| `([^`]+)` \| (Yes|No) \| (`[^`]*`|—|-|) ?\| ([^\n]*?) ?\|$/gm;
  const seen = new Set(); const params = [];
  let m;
  while ((m = re.exec(t))) {
    const [, name, type, req, def, notes] = m;
    if (seen.has(name)) continue; seen.add(name);
    const p = { name, type, required: req === 'Yes' };
    const d = def.replace(/`/g, '').trim();
    if (d && d !== '—' && d !== '-') { try { p.default = JSON.parse(d); } catch { p.default = d; } }
    const opt = /Options: ([^.|]+)/.exec(notes);
    if (opt) { let vals = opt[1].split(',').map((v) => v.trim()).filter(Boolean); if (/^(integer|number)/.test(type)) vals = vals.map((v) => (isNaN(Number(v)) ? v : Number(v))); p.enum = vals; }
    const mn = /Minimum: ([\-0-9.]+)/.exec(notes), mx = /Maximum: ([\-0-9.]+)/.exec(notes);
    if (mn) p.min = Number(mn[1]); if (mx) p.max = Number(mx[1]);
    const mi = /Maximum (?:length|items): (\d+)/.exec(notes);
    if (mi && type.startsWith('array')) p.maxItems = Number(mi[1]);
    params.push(p);
  }
  return params;
}
// The parameter table on some model pages leaves out the file inputs (Soul 2 image-to-image lists everything but
// image_url). The page's code sample does show them, so its input keys fill the gaps.
function parseSampleInputs(html) {
  const text = html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/\\u0022|\\"/g, '"');
  const i = text.indexOf('input:'); if (i < 0) return [];
  const block = text.slice(i, i + 4000);
  const end = block.search(/withPolling|\n\s*\}\s*,?\s*\n\s*\)/); const scope = end > 0 ? block.slice(0, end) : block;
  return [...new Set([...scope.matchAll(/"([a-z_][a-z0-9_]*)"\s*:/gi)].map((m) => m[1]))];
}
const MEDIA_KEY = /(image|video|audio|frame|mask)/i;
function addSampleMedia(params, sampleKeys, slug) {
  const names = new Set(params.map((p) => p.name));
  for (const k of sampleKeys) {
    if (names.has(k) || !MEDIA_KEY.test(k) || /strength|weight|size|count|resolution|duration|ratio|fps|seed/i.test(k)) continue;
    params.push({ name: k, type: /s$/.test(k) ? 'array[string]' : 'string', required: /image-to-|reference-to-|video-edit|video-extend|motion|-to-video|image2|edit$/.test(slug), fromSample: true });
  }
  return params;
}
const DOCS_VERSION = 2; // bump when the way pages are read changes, so cached entries are refreshed
async function fetchModelDocs(slug) {
  const cache = readDocsCache();
  if (cache[slug] && cache[slug].v === DOCS_VERSION) return cache[slug].params;
  try {
    const r = await fetch(`https://open.higgsfield.ai/models/${slug}/playground`, { headers: { 'User-Agent': 'Mozilla/5.0 Lepton' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return cache[slug] ? cache[slug].params : null;
    const html = await r.text();
    const params = addSampleMedia(parseParamTable(html), parseSampleInputs(html), slug);
    if (params.length) { cache[slug] = { params, at: Date.now(), v: DOCS_VERSION }; writeDocsCache(); return params; }
  } catch { /* offline or page changed */ }
  return cache[slug] ? cache[slug].params : null;
}
function genericParams(m) {
  const ops = m.operation_type || [];
  const params = [{ name: 'prompt', type: 'string', required: true }];
  if (ops.includes('image2video')) params.push({ name: 'image_url', type: 'string', required: true });
  if (ops.includes('image_edit')) params.push({ name: 'image_urls', type: 'array[string]', required: true });
  if (ops.includes('video2video')) params.push({ name: 'video_url', type: 'string', required: true });
  return params;
}
const guessType = (m) => { const t = String(m.output_type || m.type || '').toLowerCase(); return /video/.test(t) ? 'video' : /audio/.test(t) ? 'audio' : 'image'; };

function normalizeModel(m, paramsOverride) {
  const slug = m.slug || m.endpoint;
  const type = guessType(m);
  let params = paramsOverride || (Array.isArray(m.params) ? m.params : paramsFromJsonSchema(m.inputSchema || m.input_schema));
  let schemaSource = paramsOverride ? 'docs' : 'live';
  if (!params.length) {
    const b = bundledCatalogue().get(slug);
    if (b) { params = b.params; schemaSource = 'catalog'; } else { params = genericParams(m); schemaSource = 'generic'; }
  }
  return {
    job_type: PREFIX + slug, display_name: m.title || m.name || slug, description: m.description || '', type, provider: 'higgsfield',
    operation_type: m.operation_type || [], credits: Number(m.base_credits || 0) || 0, params, medias: mediaRolesFor(params, type), schemaSource, slug,
  };
}
const isUsable = (m) => !m.is_workflow && !(m.operation_type || []).includes('character') && m.slug !== 'soul-id';

const CURATED = [
  'bytedance/seedance-2.0', 'bytedance/seedance-2.5', 'kling-video/v3.0/std', 'kling-video/v3.0/pro', 'kling-video/o3', 'kling-video/omni',
  'higgsfield-ai/soul/v2/standard', 'xai/grok-imagine-image-2.0', 'ideogram/v4.0', 'alibaba/qwen-image-3',
];

// ---------- one entry per model: merge input-mode variants ----------
// Higgsfield publishes "Seedance 2.0" as text-to-video, image-to-video and reference-to-video endpoints.
// These differ only by which inputs they take, so they become one model whose ports are the union; the
// endpoint is chosen at run time from what is connected. Distinct tasks (motion control, edit, extend) stay separate.
const MODE_SEGMENTS = new Set(['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame', 'image-reference', 'video-reference', 'text-to-image', 'edit']);
const familyOf = (slug) => slug.split('/').filter((seg) => !MODE_SEGMENTS.has(seg)).join('/');
const isModeVariant = (slug) => slug.split('/').some((seg) => MODE_SEGMENTS.has(seg));
const humanize = (s) => s.replace(/-/g, ' ').replace(/\b(std|pro|4k|v\d)\b/gi, (m) => ({ std: 'Standard', pro: 'Pro', '4k': '4K' }[m.toLowerCase()] || m.toUpperCase())).replace(/^\w/, (c) => c.toUpperCase());

function unionOf(variants) {
  const params = []; const seen = new Set();
  for (const v of variants) for (const p of v.params) if (!seen.has(p.name)) { seen.add(p.name); params.push(p); }
  const medias = []; const roles = new Set();
  for (const v of variants) for (const m of v.medias) if (!roles.has(m.role)) { roles.add(m.role); medias.push(m); }
  return { params, medias };
}
function mergeFamilies(list) {
  const groups = new Map();
  for (const m of list) {
    const key = isModeVariant(m.slug) ? `${m.type}|${familyOf(m.slug)}` : `${m.type}|${m.slug}`;
    (groups.get(key) || groups.set(key, []).get(key)).push(m);
  }
  const out = [];
  for (const [key, ms] of groups) {
    if (ms.length === 1 && !isModeVariant(ms[0].slug)) { out.push(ms[0]); continue; }
    const family = key.split('|')[1];
    const u = unionOf(ms);
    const title = ms.map((m) => m.display_name.replace(/\s*(text|image|reference)[\s-]to[\s-](video|image)\s*$/i, '').trim()).sort((a, b) => a.length - b.length)[0];
    out.push({
      job_type: PREFIX + family, slug: family, display_name: title, description: ms[0].description, type: ms[0].type, provider: 'higgsfield',
      operation_type: [...new Set(ms.flatMap((m) => m.operation_type))], credits: Math.max(...ms.map((m) => m.credits)),
      params: u.params, medias: u.medias, schemaSource: 'merged', variants: ms,
    });
  }
  // Titles that still collide (different tasks) get the distinguishing part of their path appended.
  const byName = new Map();
  for (const m of out) { const k = `${m.type}|${m.display_name}`; (byName.get(k) || byName.set(k, []).get(k)).push(m); }
  for (const ms of byName.values()) {
    if (ms.length < 2) continue;
    const segs = ms.map((m) => m.slug.split('/'));
    const common = new Set(segs[0].filter((seg) => segs.every((x) => x.includes(seg))));
    const TASK = new Set(['motion-control', 'video-edit', 'video-extend', 'object-swap', 'motion-transfer']);
    for (const m of ms) {
      const distinct = m.slug.split('/').filter((seg) => (!common.has(seg) || TASK.has(seg)) && !/^v\d/.test(seg));
      if (distinct.length) m.display_name = `${m.display_name} · ${distinct.map(humanize).join(' ')}`;
    }
  }
  return out;
}

let docsFill = null;
async function listModels(key) {
  const r = await fetchJson(`${BASE}/models`, { headers: hdr(key), timeoutMs: 30000 });
  const arr = Array.isArray(r) ? r : (r && (r.items || r.models)) || [];
  const cache = readDocsCache();
  let raw;
  // Only current cache entries are trusted here; older ones are re-read from the model pages on first use.
  if (arr.length) raw = arr.filter(isUsable).map((m) => normalizeModel(m, m.slug && cache[m.slug] && cache[m.slug].v === DOCS_VERSION ? cache[m.slug].params : undefined));
  else raw = [...bundledCatalogue().values()].map((m) => normalizeModel(m));
  const list = mergeFamilies(raw);
  const rank = (m) => { const i = CURATED.indexOf(m.slug); return i >= 0 ? i : 100; };
  list.sort((a, b) => rank(a) - rank(b) || a.display_name.localeCompare(b.display_name));
  fillDocs(raw);
  return list;
}
function fillDocs(list) {
  if (docsFill) return docsFill;
  const queue = list.filter((m) => m.schemaSource !== 'live' && m.schemaSource !== 'docs');
  docsFill = (async () => {
    const worker = async () => { while (queue.length) { const m = queue.shift(); const p = await fetchModelDocs(m.slug); if (p && p.length) { m.params = p; m.medias = mediaRolesFor(p, m.type); m.schemaSource = 'docs'; } } };
    await Promise.all(Array.from({ length: 4 }, worker));
    docsFill = null;
  })();
  return docsFill;
}
async function ensureDocs(m) {
  if (m.schemaSource !== 'live' && m.schemaSource !== 'docs') {
    const p = await fetchModelDocs(m.slug);
    if (p && p.length) { m.params = p; m.medias = mediaRolesFor(p, m.type); m.schemaSource = 'docs'; }
  }
}
async function schema(key, model) {
  if (model.variants) {
    await Promise.all(model.variants.map(ensureDocs));
    const u = unionOf(model.variants);
    model.params = u.params; model.medias = u.medias;
    return { ...model, variants: model.variants.map((v) => ({ slug: v.slug, medias: v.medias })) };
  }
  await ensureDocs(model);
  return model;
}
// For a merged model, pick the endpoint that accepts every connected input, closest fit first.
function pickVariant(model, medias) {
  const supplied = new Set(medias.map((m) => m.role));
  const fits = model.variants.filter((v) => [...supplied].every((r) => v.medias.some((s) => s.role === r || (r === 'image' && s.role === 'start_image' && !supplied.has('start_image')))));
  if (!fits.length) {
    const accepted = [...new Set(model.variants.flatMap((v) => v.medias.map((s) => s.role.replace('_', ' '))))];
    throw new ApiError(`${model.display_name} has no mode that takes ${[...supplied].join(' + ').replace(/_/g, ' ')} together. It accepts: ${accepted.join(', ') || 'a prompt only'}.`);
  }
  const requiredMissing = (v) => v.medias.filter((s) => s.required && !supplied.has(s.role)).length;
  fits.sort((a, b) => requiredMissing(a) - requiredMissing(b) || (a.medias.length - supplied.size) - (b.medias.length - supplied.size));
  return fits[0];
}
async function verify(key) {
  try { await fetchJson(`${BASE}/models`, { headers: hdr(key), timeoutMs: 30000 }); return { ok: true }; }
  catch (e) {
    if (e.code === 'API_AUTH' || e.code === 'NETWORK') return { ok: false, error: e.message };
    try { await fetchJson(`${BASE}/requests/00000000-0000-0000-0000-000000000000/status`, { headers: hdr(key), timeoutMs: 30000 }); return { ok: true }; }
    catch (e2) { return e2.code === 'API_AUTH' || e2.code === 'NETWORK' ? { ok: false, error: e2.message } : { ok: true }; }
  }
}

// ---------- uploads → public URLs (presigned) ----------
function readUrlCache() { try { return JSON.parse(fs.readFileSync(URL_CACHE, 'utf8')); } catch { return {}; } }
async function publicUrl(key, m) {
  if (m.url && /^https?:\/\//.test(m.url) && !/localhost|127\.0\.0\.1/.test(m.url)) return m.url;
  const f = await localFile(m);
  const cache = readUrlCache();
  const ck = `${path.basename(f.abs)}:${fs.statSync(f.abs).size}`;
  if (cache[ck]) return cache[ck];
  const ct = mimeOf(f.abs);
  const slot = await fetchJson(`${BASE}/files/generate-upload-url`, { method: 'POST', headers: hdr(key), body: { content_type: ct } });
  if (!slot || !slot.upload_url || !slot.public_url) throw new ApiError('Higgsfield did not return an upload slot.');
  const put = await fetch(slot.upload_url, { method: 'PUT', body: fs.readFileSync(f.abs), headers: { 'Content-Type': ct, ...(slot.upload_headers || {}) } });
  if (!put.ok) throw new ApiError(`Upload to Higgsfield storage failed (HTTP ${put.status}).`);
  cache[ck] = slot.public_url; fs.writeFileSync(URL_CACHE, JSON.stringify(cache, null, 1));
  return slot.public_url;
}

async function generate(key, model, params, medias, count, schemaModel) {
  if (schemaModel && schemaModel.variants) {
    await Promise.all(schemaModel.variants.map(ensureDocs));
    schemaModel = pickVariant(schemaModel, medias);
  }
  const slug = schemaModel ? schemaModel.slug : model.replace(PREFIX, '');
  const body = {};
  const known = schemaModel ? new Set(schemaModel.params.map((p) => p.name)) : null;
  for (const [k, v] of Object.entries(params)) if (!known || known.has(k)) body[k] = v;
  if (schemaModel) for (const r of schemaModel.medias) delete body[r.param];
  const byRole = {};
  for (const m of medias) (byRole[m.role] ||= []).push(m);
  for (const [role, items] of Object.entries(byRole)) {
    const slots = schemaModel ? schemaModel.medias.filter((r) => r.role === role) : [];
    if (!slots.length) {
      if (role === 'image' && schemaModel && schemaModel.medias.some((r) => r.role === 'start_image')) slots.push(schemaModel.medias.find((r) => r.role === 'start_image'));
      else throw new ApiError(`${schemaModel ? schemaModel.display_name : slug} doesn't accept a ${role.replace('_', ' ')} input.`);
    }
    const urls = [];
    for (const it of items) urls.push(await publicUrl(key, it));
    const slot = slots.find((s) => s.multi) || slots[0];
    body[slot.param] = slot.multi ? (slot.max ? urls.slice(0, slot.max) : urls) : urls[0];
  }
  const runs = await Promise.allSettled(Array.from({ length: count }, () => fetchJson(`${BASE}/${slug}`, { method: 'POST', headers: hdr(key), body, timeoutMs: 120000 })));
  const jobs = [], errors = [];
  for (const r of runs) {
    if (r.status === 'fulfilled' && r.value && (r.value.request_id || r.value.id)) jobs.push({ id: PREFIX + (r.value.request_id || r.value.id), status: String(r.value.status || 'queued').toLowerCase() });
    else errors.push(r.status === 'rejected' ? r.reason.message : 'No request id returned');
  }
  return { jobs, errors };
}
async function job(key, id) {
  const rid = id.replace(PREFIX, '');
  const j = await fetchJson(`${BASE}/requests/${encodeURIComponent(rid)}/status`, { headers: hdr(key), timeoutMs: 30000 });
  const images = Array.isArray(j.images) ? j.images.map((x) => (typeof x === 'string' ? x : x && x.url)).filter(Boolean) : [];
  const video = j.video && (typeof j.video === 'string' ? j.video : j.video.url);
  const audio = j.audio && (typeof j.audio === 'string' ? j.audio : j.audio.url);
  const url = images[0] || video || audio || null;
  let status = String(j.status || 'queued').toLowerCase();
  if (status === 'completed' && !url) status = 'in_progress';
  return { id, status, result_url: url, extra_urls: images.slice(1), error: j.error || null };
}

module.exports = {
  id: 'higgsfield', name: 'Higgsfield', short: 'Higgsfield',
  blurb: 'Seedance, Kling, Wan, Soul, Grok Imagine and the rest of the Higgsfield catalogue.',
  consoleUrl: 'https://console.higgsfield.ai',
  fields: [{ name: 'id', label: 'Key ID', placeholder: 'e.g. 3f9c2a1e-…' }, { name: 'secret', label: 'Secret', placeholder: 'Paste the secret', secret: true }],
  parseKey: (f) => {
    let id = (f.id || '').trim().replace(/^Key\s+/i, ''), secret = (f.secret || '').trim();
    if (!secret && id.includes(':')) [id, secret] = id.split(/:(.+)/);
    if (!id && secret.includes(':')) [id, secret] = secret.split(/:(.+)/);
    if (!id || !secret) throw new ApiError(!id && !secret ? 'Paste your Key ID and Secret from the Higgsfield console.' : !id ? 'The Key ID is missing.' : 'The Secret is missing. The console shows it next to the Key ID.', { code: 'BAD_KEY' });
    if (/[\s:]/.test(id) || /[\s:]/.test(secret)) throw new ApiError('The ID and Secret must not contain spaces or colons.', { code: 'BAD_KEY' });
    return `${id}:${secret}`;
  },
  keyHint: (k) => `${k.slice(0, 6)}…${k.slice(-4)}`,
  verify, listModels, schema, generate, job,
  accepts: { image: true, video: true, audio: true },
  _test: { mergeFamilies, pickVariant, familyOf },
};
