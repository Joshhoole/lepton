// Model catalogue helpers: curated ordering, labels, schema→control mapping.
import { api } from './api.js';

// Curated order shown first in the model pickers. Anything else the account exposes is listed after, under "More".
// Providers appear in this order in every picker; each provider's own list is already curated by the server.
export const PROVIDER_ORDER = ['anthropic', 'google', 'openai', 'higgsfield'];
export const PROVIDER_LABEL = { anthropic: 'Anthropic', google: 'Google Gemini', openai: 'OpenAI', higgsfield: 'Higgsfield' };
// Preferred defaults for new nodes, first available wins.
export const DEFAULT_MODEL = {
  image: ['google:gemini-3-pro-image', 'google:gemini-3.1-flash-image', 'openai:gpt-image-2.5-flare', 'hf:higgsfield-ai/soul/v2/standard'],
  video: ['hf:bytedance/seedance-2.0', 'hf:kling-video/v3.0/std', 'google:veo-3.1-generate-preview', 'openai:sora-2'],
  llm: ['anthropic:claude-opus-5', 'google:gemini-3.8-flash', 'google:gemini-3.1-pro-preview', 'openai:gpt-6-astra', 'openai:gpt-5.6-sol', 'openai:gpt-5.5'],
};

// Parameter keys that are UI-controlled elsewhere, or that have no sensible generic control.
export const HIDDEN_PARAMS = new Set([
  'prompt', 'negative_prompt', 'seed', 'batch_size', 'webhook_url', 'webhook', 'elements', 'colors', 'multi_prompt',
  'style_id', 'custom_reference_id', 'mask', 'model', 'temperature',
]);
export const MAIN_PARAMS = {
  image: ['aspect_ratio', 'image_size', 'size', 'resolution', 'quality', 'background'],
  video: ['aspect_ratio', 'size', 'resolution', 'quality', 'mode', 'duration'],
  llm: [],
};

const LABELS = {
  aspect_ratio: 'Aspect', resolution: 'Resolution', quality: 'Quality', mode: 'Mode', background: 'Background', duration: 'Duration',
  variant: 'Variant', genre: 'Genre', bitrate_mode: 'Bitrate', sound: 'Sound', generate_audio: 'Sound', model_type: 'Type',
  style: 'Style', camera_fixed: 'Lock camera', fps: 'FPS', steps: 'Steps', guidance: 'Guidance', enhance_prompt: 'Enhance prompt',
  prompt_extend: 'Extend prompt', prompt_optimizer: 'Optimise prompt', enable_thinking: 'Thinking', multi_shots: 'Multi-shot',
  output_format: 'Format', rendering_speed: 'Speed', camera_movement: 'Camera', aigc_watermark: 'Watermark', cfg_scale: 'CFG',
  image_weight: 'Image weight', style_strength: 'Style strength', background_color: 'Background', prompt_extend_mode: 'Extend mode',
  image_size: 'Size', size: 'Size', temperature: 'Temperature',
};
const VALUE_LABELS = {
  std: 'Standard', pro: 'Pro', fast: 'Fast', basic: 'Basic', high: 'High', medium: 'Medium', low: 'Low', ultra: 'Ultra', auto: 'Auto',
  opaque: 'Opaque', transparent: 'Transparent', standard: 'Standard', flex: 'Flex', max: 'Max', '1k': '1K', '2k': '2K', '4k': '4K',
  '1.5k': '1.5K', vector: 'Vector', on: 'On', off: 'Off', true: 'On', false: 'Off', turbo: 'Turbo', quality: 'Quality', balanced: 'Balanced',
  '512px': '0.5K', '1024x1024': '1024 × 1024 (square)', '1536x1024': '1536 × 1024 (landscape)', '1024x1536': '1024 × 1536 (portrait)',
  '1280x720': '1280 × 720', '720x1280': '720 × 1280', '1920x1080': '1920 × 1080', '1080x1920': '1080 × 1920',
};
export const labelFor = (key) => LABELS[key] || key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const valueLabel = (v) => (v in VALUE_LABELS ? VALUE_LABELS[v] : String(v));

// ---------- live catalogue ----------
let modelList = [];
const schemas = new Map();
const LS_MODELS = 'lepton.models.v1', LS_SCHEMAS = 'lepton.schemas.v2'; // v2: schemas re-read after the Higgsfield doc fix
try { localStorage.removeItem('lepton.schemas.v1'); } catch { /* ignore */ }

try { const m = JSON.parse(localStorage.getItem(LS_MODELS) || 'null'); if (Array.isArray(m)) modelList = m; } catch { /* ignore */ }
try { const s = JSON.parse(localStorage.getItem(LS_SCHEMAS) || '{}'); for (const [k, v] of Object.entries(s)) schemas.set(k, v); } catch { /* ignore */ }

export let modelSource = null;
export async function loadModels(refresh = false) {
  const r = await api.models(refresh);
  const list = (r && r.models) || [];
  modelSource = r && r.source;
  modelList = list;
  if (refresh) schemas.clear();
  try { localStorage.setItem(LS_MODELS, JSON.stringify(list)); if (refresh) localStorage.removeItem(LS_SCHEMAS); } catch { /* ignore */ }
  return modelList;
}
export function clearModels() {
  modelList = []; schemas.clear(); modelSource = null;
  try { localStorage.removeItem(LS_MODELS); localStorage.removeItem(LS_SCHEMAS); } catch { /* ignore */ }
}

export function modelsFor(kind) {
  const list = modelList.filter((m) => m.type === kind);
  const groups = [];
  for (const pid of PROVIDER_ORDER) {
    const ms = list.filter((m) => m.provider === pid);
    if (ms.length) groups.push({ label: PROVIDER_LABEL[pid] || pid, models: ms });
  }
  const other = list.filter((m) => !PROVIDER_ORDER.includes(m.provider));
  if (other.length) groups.push({ label: 'Other', models: other });
  return { all: list, groups };
}
export function defaultModelFor(kind) {
  const { all } = modelsFor(kind);
  return (DEFAULT_MODEL[kind] || []).map((id) => all.find((m) => m.job_type === id)).find(Boolean) || all[0] || null;
}

export function modelName(jobType) {
  const m = modelList.find((x) => x.job_type === jobType);
  return m ? m.display_name : jobType;
}

export async function loadSchema(jobType) {
  if (schemas.has(jobType)) return schemas.get(jobType);
  const s = await api.schema(jobType);
  schemas.set(jobType, s);
  try {
    const all = JSON.parse(localStorage.getItem(LS_SCHEMAS) || '{}'); all[jobType] = s;
    localStorage.setItem(LS_SCHEMAS, JSON.stringify(all));
  } catch { /* ignore */ }
  return s;
}
export const cachedSchema = (jobType) => schemas.get(jobType) || null;

export function schemaParam(schema, name) {
  return ((schema && schema.params) || []).find((p) => p.name === name) || null;
}
export function schemaHas(schema, name) { return !!schemaParam(schema, name); }
export const isMediaParam = (schema, name) => Array.isArray(schema && schema.medias) && schema.medias.some((m) => m.param === name);

// Which input ports a generator node should expose for this schema.
export function portsFromSchema(kind, schema) {
  if (kind === 'llm') return {};
  if (!schema || !Array.isArray(schema.medias)) return kind === 'image' ? { refs: true } : { start: true, end: true, refs: true };
  const has = (role) => schema.medias.some((m) => m.role === role);
  return { refs: has('image'), start: has('start_image'), end: has('end_image'), vrefs: has('video') };
}

// The "sound" toggle maps to whichever param the model exposes.
export function soundParam(schema) {
  if (schemaHas(schema, 'generate_audio')) return { key: 'generate_audio', on: true, off: false };
  if (schemaHas(schema, 'sound')) return { key: 'sound', on: 'on', off: 'off' };
  if (schemaHas(schema, 'audio')) return { key: 'audio', on: true, off: false };
  return null;
}

export function durationRange(jobType, param) {
  if (param && param.enum) return null;
  if (param && param.min !== undefined && param.max !== undefined) return [param.min, param.max];
  return [2, 15];
}

// ---------- "Auto" aspect ratio: inferred from the prompt (or a connected image) at run time ----------
export const AUTO = '__auto__';
export const isAspectParam = (name) => name === 'aspect_ratio' || name === 'size';

const CUES = [
  [/\b(ultra[- ]?wide|anamorphic|cinemascope|21\s*[:x]\s*9|panorama|panoramic|banner)\b/i, 21 / 9],
  [/\b(portrait|vertical|tall|upright|9\s*[:x]\s*16|story|stories|reel|reels|tiktok|shorts|phone screen|mobile)\b/i, 9 / 16],
  [/\b(poster|book cover|magazine cover|2\s*[:x]\s*3)\b/i, 2 / 3],
  [/\b(square|1\s*[:x]\s*1|album cover|profile picture|avatar|icon)\b/i, 1],
  [/\b(landscape|widescreen|wide shot|horizontal|cinematic|16\s*[:x]\s*9|establishing shot|film still|movie still)\b/i, 16 / 9],
];
// Ratio hinted by the prompt text, or null.
export function inferAspectFromPrompt(text) {
  const t = String(text || '');
  const m = /\b(\d{1,4})\s*[:x×]\s*(\d{1,4})\b/.exec(t);
  if (m) { const a = Number(m[1]), b = Number(m[2]); if (a > 0 && b > 0 && a / b > 0.2 && a / b < 5 && !/mm\b/i.test(t.slice(m.index + m[0].length, m.index + m[0].length + 3))) return a / b; }
  for (const [re, r] of CUES) if (re.test(t)) return r;
  return null;
}
const ratioOfValue = (v) => {
  const m = /^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/.exec(String(v).trim());
  return m ? Number(m[1]) / Number(m[2]) : null;
};
// Pick the allowed enum value whose ratio is closest to `ratio` (log-distance so 2:1 and 1:2 are symmetric).
export function closestAspect(values, ratio) {
  let best = null, bestD = Infinity;
  for (const v of values) {
    const r = ratioOfValue(v); if (!r) continue;
    const d = Math.abs(Math.log(r) - Math.log(ratio));
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}
// An explicit statement in the prompt: a numeric ratio / size, or a plain shape word. Only these override a connected image.
const STRONG = [
  [/\b(ultra[- ]?wide|anamorphic|panoramic|panorama)\b/i, 21 / 9],
  [/\b(portrait|vertical)\b/i, 9 / 16],
  [/\b(square)\b/i, 1],
  [/\b(landscape|widescreen|horizontal)\b/i, 16 / 9],
];
export function explicitAspectFromPrompt(text) {
  const t = String(text || '');
  const m = /\b(\d{1,4})\s*[:x×]\s*(\d{1,4})\b/.exec(t);
  if (m) { const a = Number(m[1]), b = Number(m[2]); if (a > 0 && b > 0 && a / b > 0.2 && a / b < 5 && !/mm\b/i.test(t.slice(m.index + m[0].length, m.index + m[0].length + 3))) return a / b; }
  for (const [re, r] of STRONG) if (re.test(t)) return r;
  return null;
}
// Resolve AUTO for one param. The prompt comes first: a stated ratio or shape word ("9:16", "portrait", "widescreen")
// decides. Otherwise a connected image sets the shape. With neither, softer prompt cues ("cinematic", "reel") are used,
// and failing that the model's own default applies.
export function resolveAuto(param, { prompt, imageRatio }) {
  const values = (param.enum || []).filter((v) => String(v).toLowerCase() !== 'auto');
  let ratio = null, from = null;
  const explicit = explicitAspectFromPrompt(prompt);
  if (explicit) { ratio = explicit; from = 'prompt'; }
  else if (imageRatio) { ratio = imageRatio; from = 'image'; }
  else { const cue = inferAspectFromPrompt(prompt); if (cue) { ratio = cue; from = 'prompt'; } }
  if (ratio) { const v = closestAspect(values, ratio); if (v) return { value: v, from }; }
  const native = (param.enum || []).find((v) => String(v).toLowerCase() === 'auto');
  if (native) return { value: native, from: 'model' };
  return { value: undefined, from: 'default' };
}
