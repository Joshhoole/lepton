// Kie.ai: one key for many models (Nano Banana, Seedream, GPT Image, Flux, Seedance, Kling, Grok Imagine, Wan, Hailuo,
// Topaz upscalers…). Every model goes through the same createTask / recordInfo pair; only the input fields differ,
// so the models below carry their own field map. Ids not in the table still work with a generic set of fields.
const fs = require('fs');
const path = require('path');
const { ROOT, fetchJson, localFile, ApiError, mimeOf, P, promptLimit } = require('./common.js');

const BASE = 'https://api.kie.ai/api/v1';
const UPLOAD = 'https://kieai.redpandaai.co/api/file-stream-upload';
const PREFIX = 'kie:';
const URL_CACHE = path.join(ROOT, 'uploads', '.kie-urls.json');
const UPLOAD_TTL = 20 * 3600 * 1000; // Kie keeps uploads for 24 h

const AR_IMG = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
const AR_VID = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
// in: our port roles → the model's field; multi fields take arrays. extra: parameters beyond the prompt.
// fixed: fields the API insists on receiving even though the node has no control for them. asString: numbers the API wants quoted.
const M = {
  // ---- images ----
  'nano-banana-pro': { name: 'Nano Banana Pro', type: 'image', in: { image: ['image_input', 8] }, extra: () => [P('aspect_ratio', 'string', 'auto', AR_IMG), P('resolution', 'string', '1K', ['1K', '2K', '4K']), P('output_format', 'string', 'png', ['png', 'jpg'])] },
  'nano-banana-2': { name: 'Nano Banana 2', type: 'image', in: { image: ['image_input', 8] }, extra: () => [P('aspect_ratio', 'string', 'auto', AR_IMG), P('resolution', 'string', '1K', ['1K', '2K', '4K']), P('output_format', 'string', 'png', ['png', 'jpg'])] },
  'nano-banana-2-1': { name: 'Nano Banana 2.1', type: 'image', in: { image: ['image_input', 8] }, extra: () => [P('aspect_ratio', 'string', 'auto', AR_IMG), P('resolution', 'string', '1K', ['1K', '2K', '4K']), P('output_format', 'string', 'png', ['png', 'jpg'])] },
  'seedream/4.5-text-to-image': { name: 'Seedream 4.5 · Text to image', type: 'image', in: {}, extra: () => [P('aspect_ratio', 'string', '1:1', AR_IMG.slice(1)), P('quality', 'string', 'basic', ['basic', 'high'])] },
  'seedream/4.5-edit': { name: 'Seedream 4.5 · Edit', type: 'image', in: { image: ['image_urls', 10] }, extra: () => [P('aspect_ratio', 'string', '1:1', AR_IMG.slice(1)), P('quality', 'string', 'basic', ['basic', 'high'])] },
  'seedream/5-pro-text-to-image': { name: 'Seedream 5 Pro · Text to image', type: 'image', in: {}, extra: () => [P('aspect_ratio', 'string', '1:1', AR_IMG.slice(1)), P('quality', 'string', 'basic', ['basic', 'high']), P('output_format', 'string', 'png', ['png', 'jpg'])] },
  'seedream/5-pro-image-to-image': { name: 'Seedream 5 Pro · Image to image', type: 'image', in: { image: ['image_urls', 10] }, extra: () => [P('aspect_ratio', 'string', '1:1', AR_IMG.slice(1)), P('quality', 'string', 'basic', ['basic', 'high']), P('output_format', 'string', 'png', ['png', 'jpg'])] },
  'gpt-image-2-text-to-image': { name: 'GPT Image 2 · Text to image', type: 'image', in: {}, extra: () => [P('aspect_ratio', 'string', 'auto', ['auto', '1:1', '16:9', '9:16', '3:2', '2:3'])] },
  'gpt-image-2-image-to-image': { name: 'GPT Image 2 · Image to image', type: 'image', in: { image: ['input_urls', 8] }, extra: () => [P('aspect_ratio', 'string', 'auto', ['auto', '1:1', '16:9', '9:16', '3:2', '2:3'])] },
  'flux-2/pro-text-to-image': { name: 'Flux 2 Pro · Text to image', type: 'image', in: {}, extra: () => [P('aspect_ratio', 'string', '1:1', AR_IMG.slice(1)), P('resolution', 'string', '1K', ['1K', '2K'])] },
  'flux-2/pro-image-to-image': { name: 'Flux 2 Pro · Image to image', type: 'image', in: { image: ['input_urls', 8] }, extra: () => [P('aspect_ratio', 'string', '1:1', AR_IMG.slice(1)), P('resolution', 'string', '1K', ['1K', '2K'])] },
  'topaz/image-upscale': { name: 'Topaz · Image upscale', type: 'image', noPrompt: true, in: { image: ['image_url', 1] }, extra: () => [P('upscale_factor', 'string', '2', ['2', '4'])] },
  // ---- video ----
  'bytedance/seedance-2': { name: 'Seedance 2.0', type: 'video', in: { image: ['reference_image_urls', 9], video: ['reference_video_urls', 3], audio: ['reference_audio_urls', 3] }, fixed: { return_last_frame: false, web_search: false }, extra: () => [P('aspect_ratio', 'string', '16:9', [...AR_VID, 'adaptive']), P('resolution', 'string', '720p', ['480p', '720p', '1080p']), P('duration', 'integer', 5, null, { min: 2, max: 15 }), P('generate_audio', 'boolean', false)] },
  'bytedance/seedance-2-5': { name: 'Seedance 2.5', type: 'video', in: { image: ['reference_image_urls', 9], video: ['reference_video_urls', 3], audio: ['reference_audio_urls', 3] }, fixed: { return_last_frame: false, web_search: false }, extra: () => [P('aspect_ratio', 'string', '16:9', [...AR_VID, 'adaptive']), P('resolution', 'string', '720p', ['480p', '720p', '1080p']), P('duration', 'integer', 5, null, { min: 2, max: 15 }), P('generate_audio', 'boolean', false)] },
  'bytedance/seedance-2-fast': { name: 'Seedance 2.0 Fast', type: 'video', in: { image: ['reference_image_urls', 9], video: ['reference_video_urls', 3], audio: ['reference_audio_urls', 3] }, fixed: { return_last_frame: false, web_search: false }, extra: () => [P('aspect_ratio', 'string', '16:9', [...AR_VID, 'adaptive']), P('resolution', 'string', '720p', ['480p', '720p', '1080p']), P('duration', 'integer', 5, null, { min: 2, max: 15 }), P('generate_audio', 'boolean', false)] },
  'kling-3.0/video': { name: 'Kling 3.0', type: 'video', in: { frames: ['image_urls', 2] }, fixed: { multi_shots: false }, asString: ['duration'], extra: () => [P('aspect_ratio', 'string', '16:9', ['16:9', '9:16', '1:1']), P('mode', 'string', 'std', ['std', 'pro', '4K']), P('duration', 'integer', 5, null, { min: 3, max: 15 }), P('sound', 'boolean', false)] },
  'kling-3.0-omni/text-to-video': { name: 'Kling 3.0 Omni · Text to video', type: 'video', in: {}, fixed: { customize_multi_shots: false }, extra: () => [P('aspect_ratio', 'string', '16:9', ['16:9', '9:16', '1:1']), P('resolution', 'string', '720p', ['720p', '1080p', '4K']), P('duration', 'integer', 5, null, { min: 3, max: 15 }), P('audio', 'boolean', false)] },
  'kling-3.0-omni/image-to-video': { name: 'Kling 3.0 Omni · Image to video', type: 'video', in: { frames: ['image_urls', 2] }, fixed: { customize_multi_shots: false }, extra: () => [P('aspect_ratio', 'string', 'auto', ['auto', '16:9', '9:16', '1:1']), P('resolution', 'string', '720p', ['720p', '1080p', '4K']), P('duration', 'integer', 5, null, { min: 3, max: 15 }), P('audio', 'boolean', false)] },
  'grok-imagine/text-to-video': { name: 'Grok Imagine · Text to video', type: 'video', in: {}, extra: () => [P('aspect_ratio', 'string', '16:9', ['16:9', '9:16', '1:1', '3:2', '2:3']), P('resolution', 'string', '480p', ['480p', '720p']), P('duration', 'string', '6', ['6', '10']), P('mode', 'string', 'normal', ['normal', 'fun', 'spicy'])] },
  'grok-imagine/image-to-video': { name: 'Grok Imagine · Image to video', type: 'video', in: { start: ['image_urls', 1] }, extra: () => [P('aspect_ratio', 'string', '16:9', ['16:9', '9:16', '1:1', '3:2', '2:3']), P('resolution', 'string', '480p', ['480p', '720p']), P('duration', 'string', '6', ['6', '10']), P('mode', 'string', 'normal', ['normal', 'fun', 'spicy'])] },
  'wan/2-7-text-to-video': { name: 'Wan 2.7 · Text to video', type: 'video', in: {}, extra: () => [P('ratio', 'string', '16:9', ['16:9', '9:16', '1:1']), P('resolution', 'string', '720p', ['720p', '1080p']), P('duration', 'integer', 5, [5, 10]), P('negative_prompt', 'string', null), P('seed', 'integer', null)] },
  'wan/2-7-image-to-video': { name: 'Wan 2.7 · Image to video', type: 'video', in: { start: ['first_frame_url', 1], end: ['last_frame_url', 1] }, extra: () => [P('resolution', 'string', '720p', ['720p', '1080p']), P('duration', 'integer', 5, [5, 10]), P('negative_prompt', 'string', null), P('seed', 'integer', null)] },
  'hailuo/2-3-image-to-video-pro': { name: 'Hailuo 2.3 Pro · Image to video', type: 'video', in: { start: ['image_url', 1] }, extra: () => [P('duration', 'string', '6', ['6', '10']), P('resolution', 'string', '768P', ['768P', '1080P'])] },
  'hailuo/2-3-image-to-video-standard': { name: 'Hailuo 2.3 Standard · Image to video', type: 'video', in: { start: ['image_url', 1] }, extra: () => [P('duration', 'string', '6', ['6', '10']), P('resolution', 'string', '768P', ['768P', '1080P'])] },
  'topaz/video-upscale': { name: 'Topaz · Video upscale', type: 'video', noPrompt: true, in: { video: ['video_url', 1] }, extra: () => [P('upscale_factor', 'string', '2', ['2', '4'])] },
};
// Anything else the user lists: prompt, references, and the common fields; the API says what it does not accept.
const generic = (id) => ({
  name: id.replace(/[-_/]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), type: /video|v2v|i2v|t2v|animate|motion/i.test(id) ? 'video' : 'image',
  in: { image: ['image_urls', 8] }, extra: () => (/video|v2v|i2v|t2v/i.test(id) ? [P('aspect_ratio', 'string', '16:9', AR_VID), P('resolution', 'string', '720p', ['480p', '720p', '1080p']), P('duration', 'integer', 5, null, { min: 2, max: 15 })] : [P('aspect_ratio', 'string', '1:1', AR_IMG.slice(1))]),
});


// ---------- the whole Kie.ai catalogue, read from its documentation ----------
// Kie publishes one page per model with an example request. Those pages are read once a day and turned into models,
// so everything Kie offers appears in the dropdowns, not just the curated table above. Text, speech and music models
// are left out: this app generates images and video.
const DOCS = 'https://docs.kie.ai';
const CATALOG_CACHE = path.join(ROOT, '.cache', 'kie-catalog.json');
const CATALOG_TTL = 24 * 3600 * 1000;
const SKIP_CATEGORY = /^(quickstart|common|chat|claude|gemini|grok|codex|kimi|deepseek[-\w]*|elevenlabs|gemini-omni-audio|gemini-omni-character)$/;
const SKIP_PATH = /-tts$|text-to-speech|text-to-dialogue|audio-isolation|-openai$|human-identification|subject-detection|segment-map|layer-decomposition|video-to-video-lip-sync/;
const VIDEO_HINT = /video|animate|motion|extend|transition|omnihuman|infinitalk|lip-sync|avatar|r2v|i2v|t2v|v2v|seedance|kling|hailuo|happyhorse|pixverse|vidu|minimax-h3|wan\/|ltx/i;
const ENUMS = {
  aspect_ratio: AR_IMG, ratio: AR_VID, resolution: ['480p', '720p', '1080p', '2K', '4K'], quality: ['basic', 'high'],
  mode: ['std', 'pro', 'normal', 'fun', 'spicy'], output_format: ['png', 'jpg', 'jpeg', 'webp'], upscale_factor: ['2', '4'],
};
const FIXED_FALSE = new Set(['multi_shots', 'customize_multi_shots', 'return_last_frame', 'web_search', 'nsfw_checker']);
const ROLE_OF = {
  image_urls: ['image', true], image_input: ['image', true], input_urls: ['image', true], reference_image_urls: ['image', true], images: ['image', true],
  keyframe_urls: ['image', true], image_url: ['image', false], input_image_url: ['image', false], first_frame_url: ['start', false], start_image_url: ['start', false],
  last_frame_url: ['end', false], end_image_url: ['end', false], tail_image_url: ['end', false],
  video_url: ['video', false], input_video_url: ['video', false], video_urls: ['video', true], reference_video_urls: ['video', true],
  audio_url: ['audio', false], reference_audio_urls: ['audio', true], element_input_audio_urls: ['audio', true],
};
// "Seedream4.5 - Text to Image" → "Seedream 4.5 · Text to image"; "Flux-2 - Pro Image to Image" → "Flux 2 · Pro image to image".
const tidyName = (t) => {
  let n = t.replace(/\s+/g, ' ').trim();
  n = n.replace(/([A-Za-z])-(\d)/g, '$1 $2').replace(/([A-Za-z]{3,})(\d+(?:\.\d+)?)/g, '$1 $2').replace(/(\s\d+)-(\d+)\b/g, '$1.$2');
  n = n.replace(/\s+-\s+/g, ' · ');
  // task phrases read better in sentence case
  n = n.replace(/\b(Text|Image|Video|Reference|Keyframe|Audio|Speech)\s+[Tt]o\s+(Image|Video|Audio)\b/g, (m, a, b) => `${a} to ${b.toLowerCase()}`);
  n = n.replace(/·\s*([a-z])/g, (m, c) => `· ${c.toUpperCase()}`).replace(/\s+/g, ' ').trim();
  return n;
};
let catalog = null, scraping = null;
function readCatalog() { if (catalog) return catalog; try { catalog = JSON.parse(fs.readFileSync(CATALOG_CACHE, 'utf8')); } catch { catalog = { at: 0, models: {} }; } return catalog; }
function writeCatalog() { try { fs.mkdirSync(path.dirname(CATALOG_CACHE), { recursive: true }); fs.writeFileSync(CATALOG_CACHE, JSON.stringify(catalog)); } catch { /* ignore */ } }
const strip = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
async function text(url) { const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Lepton' }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }
// The pages Kie lists, with their titles.
async function listPages() {
  const html = await text(`${DOCS}/`);
  const out = new Map();
  for (const m of html.matchAll(/<a[^>]+href="(\/market\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const href = m[1], title = strip(m[2]).trim();
    const cat = href.split('/')[2] || '';
    if (!title || out.has(href) || SKIP_CATEGORY.test(cat) || SKIP_PATH.test(href)) continue;
    out.set(href, title);
  }
  return out;
}
// One page → { id, input example }.
async function readPage(href) {
  const t = strip(await text(`${DOCS}${href}`));
  const m = /--data(?:-raw)? '(\{.*?\})'\s+Response/.exec(t); if (!m) return null;
  let body = m[1].replace(/' \\ '' s/g, "'s");
  let j = null;
  try { j = JSON.parse(body); } catch { /* fall back to a rough read */ }
  if (j) return { id: j.model, input: j.input || {} };
  const id = (/"model":\s*"([^"]+)"/.exec(body) || [])[1]; if (!id) return null;
  const inner = body.split('"input"')[1] || '';
  const input = {}; for (const k of inner.matchAll(/"([a-z_]+)":\s*("([^"]*)"|true|false|-?\d+(?:\.\d+)?|\[)/g)) input[k[1]] = k[3] !== undefined ? k[3] : k[2] === 'true' ? true : k[2] === 'false' ? false : k[2] === '[' ? [] : Number(k[2]);
  return { id, input };
}
// Turn an example request into a model entry: ports from the file fields, controls from the rest.
function fromExample(id, title, input, href) {
  const type = VIDEO_HINT.test(`${id} ${href}`) && !/image-to-image|text-to-image|image-edit|edit$|upscale\/image|image-upscale/.test(`${id} ${href}`) ? 'video' : 'image';
  const spec = { name: tidyName(title), type, in: {}, fixed: {}, asString: [], params: [] };
  for (const [k, v] of Object.entries(input)) {
    if (k === 'prompt' || k === 'callBackUrl') continue;
    if (ROLE_OF[k]) { const [role, multi] = ROLE_OF[k]; spec.in[role] = [k, multi ? 10 : 1]; continue; }
    if (FIXED_FALSE.has(k)) { spec.fixed[k] = false; continue; }
    if (typeof v === 'boolean') spec.params.push(P(k, 'boolean', v));
    else if (typeof v === 'number') spec.params.push(P(k, 'integer', v, null, k === 'duration' ? { min: 2, max: 15 } : { min: 0, max: 100 }));
    else if (typeof v === 'string') {
      if (k === 'negative_prompt' || k === 'seed') continue;
      if (ENUMS[k]) spec.params.push(P(k, 'string', v, [...new Set([...ENUMS[k], v])]));
      else if (k === 'duration') { spec.params.push(P(k, 'string', v, [...new Set(['3', '4', '5', '6', '8', '10', '12', v])])); spec.asString.push(k); }
      else if (/^\d+$/.test(v)) spec.params.push(P(k, 'string', v, [v]));
      else if (/size|style|preset|model_type|variant|format/.test(k)) spec.params.push(P(k, 'string', v, [v]));
      // other free-text fields have no sensible control; they are left out and the API applies its default
    }
    // arrays that are not files (multi_prompt, elements…) are advanced features the node does not expose
  }
  spec.noPrompt = !('prompt' in input);
  spec.extra = () => spec.params;
  return spec;
}
async function scrapeCatalogue() {
  const pages = await listPages();
  const models = {};
  const hrefs = [...pages.keys()];
  const worker = async () => { while (hrefs.length) { const href = hrefs.shift(); try { const r = await readPage(href); if (r && r.id) models[r.id] = { title: pages.get(href), href, input: r.input }; } catch { /* page unavailable */ } } };
  await Promise.all(Array.from({ length: 10 }, worker));
  if (!Object.keys(models).length) throw new Error('No model pages could be read');
  catalog = { at: Date.now(), models }; writeCatalog();
  return catalog;
}
// The catalogue as specs keyed by id, refreshed in the background when it is a day old. First use waits a little.
async function catalogueSpecs() {
  const c = readCatalog();
  const stale = Date.now() - (c.at || 0) > CATALOG_TTL || !Object.keys(c.models || {}).length;
  if (stale && !scraping) scraping = scrapeCatalogue().catch(() => null).finally(() => { scraping = null; });
  if (scraping && !Object.keys(c.models || {}).length) await Promise.race([scraping, new Promise((r) => setTimeout(r, 15000))]);
  const out = {};
  for (const [id, m] of Object.entries(readCatalog().models || {})) { try { out[id] = fromExample(id, m.title, m.input || {}, m.href || ''); } catch { /* skip odd page */ } }
  return out;
}
let specCache = {};
function specFor(id) { return M[id] || specCache[id] || generic(id); }

function parse(key) {
  try { const j = JSON.parse(key); if (j && j.key) return { key: j.key, models: Array.isArray(j.models) ? j.models : [] }; } catch { /* plain key */ }
  return { key: String(key || '').trim(), models: [] };
}
const hdr = (k) => ({ Authorization: `Bearer ${parse(k).key}` });
// Kie answers HTTP 200 with its own code; anything but 200 there is an error.
async function call(key, url, opts = {}) {
  const r = await fetchJson(url, { headers: hdr(key), ...opts });
  if (r && typeof r === 'object' && 'code' in r && Number(r.code) !== 200) throw new ApiError(r.msg || `Kie.ai error ${r.code}`, { code: Number(r.code) === 401 ? 'API_AUTH' : Number(r.code) === 402 ? 'API_CREDITS' : 'API_ERROR' });
  return r;
}

function mediasFor(spec) {
  const out = [];
  for (const [role, [param, max]] of Object.entries(spec.in)) {
    if (role === 'frames') { out.push({ role: 'start_image', param, multi: false }, { role: 'end_image', param, multi: false }); continue; }
    const r = role === 'start' ? 'start_image' : role === 'end' ? 'end_image' : role;
    out.push({ role: r, param, multi: max > 1, max });
  }
  return out;
}
function toModel(id) {
  const spec = specFor(id);
  const params = [...(spec.noPrompt ? [] : [P('prompt', 'string', null, null, { required: true })]), ...spec.extra()];
  return { job_type: PREFIX + id, display_name: spec.name, description: '', type: spec.type, provider: 'kie', slug: id, params, medias: mediasFor(spec) };
}
async function listModels(key) {
  specCache = await catalogueSpecs();
  const ids = [...new Set([...Object.keys(M), ...Object.keys(specCache), ...parse(key).models])];
  return ids.map(toModel);
}
async function verify(key) {
  if (!parse(key).key) return { ok: false, error: 'Paste the API key from kie.ai → API Key Management.' };
  try { const r = await call(key, `${BASE}/chat/credit`, { timeoutMs: 20000 }); return { ok: true, credits: r && r.data }; }
  catch (e) { return { ok: false, error: e.code === 'API_AUTH' ? 'Kie.ai rejected the key.' : e.message }; }
}

// Local files must be reachable by Kie: they go up once through its upload service, which keeps them for a day.
function readCache() { try { return JSON.parse(fs.readFileSync(URL_CACHE, 'utf8')); } catch { return {}; } }
async function publicUrl(key, m) {
  if (m.url && /^https?:\/\//.test(m.url) && !/localhost|127\.0\.0\.1/.test(m.url)) return m.url;
  const f = await localFile(m);
  const cache = readCache(); const ck = `${path.basename(f.abs)}:${fs.statSync(f.abs).size}`;
  if (cache[ck] && Date.now() - cache[ck].at < UPLOAD_TTL) return cache[ck].url;
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(f.abs)], { type: mimeOf(f.abs) }), path.basename(f.abs));
  form.append('uploadPath', 'lepton');
  const r = await fetchJson(UPLOAD, { method: 'POST', headers: hdr(key), form, timeoutMs: 300000 });
  const url = r && r.data && (r.data.downloadUrl || r.data.fileUrl);
  if (!url) throw new ApiError('Kie.ai did not return a link for the uploaded file.');
  cache[ck] = { url, at: Date.now() };
  try { fs.writeFileSync(URL_CACHE, JSON.stringify(cache, null, 1)); } catch { /* ignore */ }
  return url;
}

async function generate(key, model, params, medias, count) {
  const id = model.replace(PREFIX, '');
  const spec = specFor(id);
  const input = { ...(spec.fixed || {}) };
  if (!spec.noPrompt && params.prompt) input.prompt = params.prompt;
  for (const p of spec.extra()) { const v = params[p.name]; if (v !== undefined && v !== null && v !== '') input[p.name] = (spec.asString || []).includes(p.name) ? String(v) : p.type === 'integer' ? Number(v) : v; }
  // Media by role, in the order connected.
  const byRole = {}; for (const m of medias) (byRole[m.role] ||= []).push(m);
  for (const [role, [param, max]] of Object.entries(spec.in)) {
    if (role === 'frames') {
      const urls = []; for (const r of ['start_image', 'end_image']) for (const m of byRole[r] || []) urls.push(await publicUrl(key, m));
      if (urls.length) input[param] = urls.slice(0, max);
      continue;
    }
    const r = role === 'start' ? 'start_image' : role === 'end' ? 'end_image' : role;
    const items = byRole[r] || []; if (!items.length) continue;
    const urls = []; for (const m of items.slice(0, max)) urls.push(await publicUrl(key, m));
    input[param] = max > 1 ? urls : urls[0];
  }
  const unused = medias.filter((m) => !Object.keys(spec.in).some((role) => (role === 'frames' ? ['start_image', 'end_image'] : [role === 'start' ? 'start_image' : role === 'end' ? 'end_image' : role]).includes(m.role)));
  if (unused.length) { const what = unused[0].role.replace('_', ' '); throw new ApiError(`${spec.name} doesn't take ${/^[aeiou]/.test(what) ? 'an' : 'a'} ${what} input.`); }
  const tooLong = (msg) => {
    if (!/text length|maximum limit|too long/i.test(msg)) return msg;
    const len = String(input.prompt || '').length; const lim = promptLimit(id);
    return `${spec.name} rejected the prompt as too long: ${len.toLocaleString()} characters${lim ? `, ${Math.max(0, len - lim).toLocaleString()} over its ${lim.toLocaleString()} limit. Shorten it by ${Math.max(0, len - lim).toLocaleString()} characters` : ''}.`;
  };
  const runs = await Promise.allSettled(Array.from({ length: count }, () => call(key, `${BASE}/jobs/createTask`, { method: 'POST', body: { model: id, input }, timeoutMs: 60000 })));
  const jobs = [], errors = [];
  for (const r of runs) {
    if (r.status === 'rejected') errors.push(tooLong(r.reason.message));
    else if (r.value && r.value.data && r.value.data.taskId) jobs.push({ id: PREFIX + r.value.data.taskId, status: 'queued' });
    else errors.push('No task id returned');
  }
  return { jobs, errors };
}

async function job(key, id) {
  const tid = id.replace(PREFIX, '');
  const r = await call(key, `${BASE}/jobs/recordInfo?taskId=${encodeURIComponent(tid)}`, { timeoutMs: 30000 });
  const d = (r && r.data) || {};
  const state = String(d.state || 'waiting').toLowerCase();
  if (state === 'fail') return { id, status: 'failed', error: d.failMsg || d.failCode || 'Generation failed' };
  if (state !== 'success') return { id, status: state === 'generating' ? 'in_progress' : 'queued' };
  let urls = [];
  try { const j = typeof d.resultJson === 'string' ? JSON.parse(d.resultJson) : d.resultJson || {}; urls = j.resultUrls || j.result_urls || []; } catch { /* no result list */ }
  if (!urls.length) return { id, status: 'failed', error: 'No result returned' };
  // Kie keeps results for two weeks; they are copied here so they last.
  const local = [];
  for (const u of urls) { try { const f = await localFile({ url: u }); local.push(`/uploads/${path.basename(f.abs)}`); } catch { local.push(u); } }
  return { id, status: 'completed', result_url: local[0], extra_urls: local.slice(1) };
}

module.exports = {
  id: 'kie', name: 'Kie.ai', short: 'Kie',
  blurb: 'One key for Nano Banana, Seedream, GPT Image, Flux, Seedance, Kling, Grok Imagine, Wan, Hailuo and Topaz upscaling.',
  consoleUrl: 'https://kie.ai/api-key',
  fields: [
    { name: 'key', label: 'API key', placeholder: 'Add your API key', secret: true },
    { name: 'models', label: 'More models', placeholder: 'Optional: extra model ids from docs.kie.ai, comma separated' },
  ],
  parseKey: (f) => {
    const key = (f.key || '').trim();
    if (!key) throw new ApiError('Paste the API key from kie.ai.', { code: 'BAD_KEY' });
    const models = String(f.models || '').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    return JSON.stringify({ key, models });
  },
  keyHint: (k) => { const p = parse(k); return `${p.key.slice(0, 6)}…${p.key.slice(-4)}`; },
  verify, listModels, generate, job,
  accepts: { image: true, video: true, audio: true },
  _test: { listPages, readPage, scrapeCatalogue, fromExample },
};
