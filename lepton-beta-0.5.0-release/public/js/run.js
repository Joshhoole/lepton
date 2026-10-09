// Execution engine: resolves a generator node's inputs, submits jobs, polls them, and cascades upstream.
import { state, bus, incoming, outgoing, isGen, isLLM, isRunnable, save } from './state.js';
import { api } from './api.js';
import { loadSchema, schemaParam, soundParam, AUTO, isAspectParam, resolveAuto } from './models.js';
import { splitPrompts } from './split.js';
import { resolveMentions } from './mentions.js';

const inflight = new Map(); // nodeId → Promise
const TERMINAL = new Set(['completed', 'failed', 'nsfw', 'cancelled', 'canceled', 'error']);
const POLL_MS = 3000;

export function isRunning(id) { return inflight.has(id); }

export async function runNode(id, { cascade = true } = {}) {
  if (inflight.has(id)) return inflight.get(id);
  const node = state.nodes[id];
  if (!node || !isRunnable(node)) return;
  const p = (async () => {
    try { await (node.type === 'template' ? executeTemplate(node, cascade) : isLLM(node) ? executeLLM(node, cascade) : execute(node, cascade)); }
    catch (e) {
      node.data.status = 'error'; node.data.error = e.message || String(e);
      // Placeholders that never became jobs must not sit there spinning.
      if (Array.isArray(node.data.results)) node.data.results = node.data.results.filter((r) => r.jobId);
      bus.emit('status', id); bus.emit('results', id);
      bus.emit('toast', { msg: e.message || String(e), kind: 'err' });
    } finally { inflight.delete(id); }
  })();
  inflight.set(id, p);
  return p;
}

export async function runAll() {
  const gens = Object.values(state.nodes).filter(isRunnable);
  if (!gens.length) { bus.emit('toast', { msg: 'Add an Image, Video or LLM node first.' }); return; }
  // Run the sinks: nodes that don't feed another runnable node. Cascade takes care of the rest.
  const sinks = gens.filter((n) => !outgoing(n.id).some((e) => isRunnable(state.nodes[e.to])));
  await Promise.all(sinks.map((n) => runNode(n.id, { cascade: true })));
}

export async function runDownstream(promptId) {
  const targets = outgoing(promptId).map((e) => state.nodes[e.to]).filter(isRunnable);
  if (!targets.length) { bus.emit('toast', { msg: 'Connect this prompt to an Image, Video or LLM node first.' }); return; }
  await Promise.all(targets.map((n) => runNode(n.id)));
}

// Resolve a media reference for an upstream node: a local upload path or a result URL.
async function mediaRef(src, cascade) {
  if (src.type === 'media') {
    if (src.data.pending) throw new Error(`"${src.data.name || 'Media'}" is still uploading.`);
    return { ref: src.data.url, url: /^https?:\/\//.test(src.data.url || '') ? src.data.url : null, kind: src.data.kind || 'image' };
  }
  if (isGen(src)) {
    const pick = () => {
      const res = src.data.results || [];
      const sel = res[src.data.selected] && res[src.data.selected].status === 'completed' ? res[src.data.selected] : res.find((r) => r.status === 'completed');
      return sel ? { ref: sel.url, url: /^https?:\/\//.test(sel.url || '') ? sel.url : null, kind: src.type } : null;
    };
    if (inflight.has(src.id)) { await inflight.get(src.id); return pick(); }
    let ref = pick();
    if (!ref && cascade) { await runNode(src.id, { cascade }); ref = pick(); }
    if (!ref) throw new Error(`"${src.data.title || (src.type === 'image' ? 'Image' : 'Video')}" has no result to use yet.`);
    return ref;
  }
  return null;
}

// Move the node's current results into its history (newest first) so a new run never overwrites them.
export const HISTORY_MAX = 30;
export function archiveActiveRun(node) {
  const done = (node.data.results || []).filter((r) => r.status === 'completed' && r.url);
  if (!done.length) return;
  const meta = node.data.runMeta || {};
  node.data.history = [{ id: Math.random().toString(36).slice(2, 10), at: meta.at || Date.now(), model: meta.model || node.data.model, prompt: meta.prompt || '', params: meta.params || {}, results: done.map((r) => ({ jobId: r.jobId, status: 'completed', url: r.url, thumb: r.thumb || null })) }, ...(node.data.history || [])].slice(0, HISTORY_MAX);
}
// Make a past run the active one; the current active run goes back into history.
export function restoreRun(node, runId) {
  const i = (node.data.history || []).findIndex((h) => h.id === runId); if (i < 0) return;
  const run = node.data.history[i];
  node.data.history.splice(i, 1);
  archiveActiveRun(node);
  node.data.results = run.results.map((r) => ({ ...r }));
  node.data.runMeta = { at: run.at, model: run.model, prompt: run.prompt, params: run.params };
  node.data.selected = 0; node.data.status = 'done'; node.data.error = null;
  save(true); bus.emit('status', node.id); bus.emit('results', node.id); bus.emit('history', node.id);
}
export function deleteRun(node, runId) {
  node.data.history = (node.data.history || []).filter((h) => h.id !== runId);
  save(true); bus.emit('history', node.id);
}
export function deleteResult(node, runId, index) {
  if (runId) { const run = (node.data.history || []).find((h) => h.id === runId); if (!run) return; run.results.splice(index, 1); if (!run.results.length) node.data.history = node.data.history.filter((h) => h !== run); }
  else { node.data.results.splice(index, 1); if (node.data.selected >= node.data.results.length) node.data.selected = Math.max(0, node.data.results.length - 1); }
  save(true); bus.emit('results', node.id); bus.emit('history', node.id);
}

// Width/height ratio of the first image feeding this node's frame or reference ports: uploads carry their size,
// generated results are measured by loading the file.
const ratioCache = new Map();
function measureRatio(url) {
  if (ratioCache.has(url)) return ratioCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image(); const done = (v) => resolve(v);
    img.onload = () => done(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : null);
    img.onerror = () => done(null); setTimeout(() => done(null), 8000);
    img.src = url;
  });
  ratioCache.set(url, p);
  return p;
}
async function connectedImageRatio(node) {
  for (const port of ['start', 'refs', 'end']) {
    for (const e of incoming(node.id, port)) {
      const src = state.nodes[e.from]; if (!src) continue;
      if (src.type === 'media') { if (src.data.w && src.data.h) return src.data.w / src.data.h; if (src.data.kind === 'image' && src.data.url) { const r = await measureRatio(src.data.url); if (r) return r; } }
      else if (isGen(src) && src.type === 'image') {
        const res = src.data.results || []; const sel = res[src.data.selected]?.status === 'completed' ? res[src.data.selected] : res.find((r) => r.status === 'completed');
        if (sel?.url) { const r = await measureRatio(sel.url); if (r) return r; }
      }
    }
  }
  return null;
}

// Text arriving on a node's prompt port: Prompt nodes give their text, LLM nodes give their output (running first if needed).
async function promptText(node, cascade, portKey = 'prompt') {
  const links = incoming(node.id, portKey);
  const parts = [];
  for (const e of links) {
    const src = state.nodes[e.from]; if (!src) continue;
    if (src.type === 'prompt') parts.push((src.data.text || '').trim());
    else if (isLLM(src)) {
      if (inflight.has(src.id)) await inflight.get(src.id);
      else if (!(src.data.output || '').trim() && cascade) await runNode(src.id, { cascade });
      if (src.data.status === 'error') throw new Error(`"${src.data.title || 'LLM'}" failed: ${src.data.error}`);
      parts.push((src.data.output || '').trim());
    }
    else if (src.type === 'batch') {
      const items = await batchItems(src, cascade);
      const i = Number(String(e.fromPort).replace('out', '')) || 0;
      if (!items[i]) throw new Error(`"${src.data.title || 'Prompt batch'}" has no prompt ${i + 1} yet.`);
      parts.push(items[i]);
    }
  }
  return { linked: links.length > 0, text: parts.filter(Boolean).join('\n\n') };
}
// A batch node's prompts, resolving (and if needed running) whatever feeds it.
export async function batchItems(node, cascade) {
  const { text } = await promptText(node, cascade);
  const items = splitPrompts(text, node.data.mode, node.data.separator);
  const changed = JSON.stringify(items) !== JSON.stringify(node.data.items || []);
  node.data.items = items;
  if (changed) { save(); bus.emit('batch:update', node.id); }
  return items;
}

async function executeLLM(node, cascade) {
  if (!node.data.model) throw new Error('Connect an API key with a text model (Anthropic, Google or OpenAI) in Settings first.');
  const { text: prompt } = await promptText(node, cascade);
  const instructions = (node.data.instructions || '').trim();
  const system = (node.data.system || '').trim();
  // "@image 2" must point at something connected; the attachments are then labelled so the model can tell them apart.
  const mt = resolveMentions(node, [prompt, instructions].filter(Boolean).join('\n\n'), { lenient: true });
  const medias = [];
  for (const e of incoming(node.id, 'media')) {
    const src = state.nodes[e.from]; if (!src) continue;
    const m = await mediaRef(src, cascade);
    if (m) medias.push({ role: m.kind, ref: m.ref, url: m.url, ...(mt.used ? { label: mt.labels[e.id] } : {}) });
  }
  // Connected skills travel with the request; the server adds their text to the system prompt.
  const skills = incoming(node.id, 'skills').map((e) => state.nodes[e.from]).filter((s) => s && s.type === 'skill' && s.data.skill).map((s) => s.data.skill);
  if (!instructions && !prompt && !medias.length) throw new Error('Tell the model what to do, or connect a prompt or some media.');
  node.data.status = 'running'; node.data.error = null;
  bus.emit('status', node.id);
  const r = await api.complete(node.data.model, { system, instructions, prompt, medias, skills, params: node.data.params || {} });
  node.data.pendingJob = r.jobId;
  save(true);
  await finishLLM(node);
}
// Template node: every section is a port; text sections join upstream text with the inline note,
// image sections become numbered reference images. The template's system prompt does the compiling.
async function executeTemplate(node, cascade) {
  const spec = node.data.spec;
  if (!spec) throw new Error('This template is missing its definition.');
  if (!node.data.model) throw new Error('Choose a text model first (Anthropic, Google or OpenAI key needed).');
  const lines = ['SECTIONS PROVIDED'];
  const medias = []; const imageLines = [];
  let anything = false;
  for (const sec of spec.sections) {
    if (sec.type === 'images') {
      for (const e of incoming(node.id, `i_${sec.key}`)) {
        const src = state.nodes[e.from]; if (!src) continue;
        const m = await mediaRef(src, cascade);
        if (!m || m.kind !== 'image') continue;
        medias.push({ role: 'image', ref: m.ref, url: m.url, label: `Image ${medias.length + 1}` });
        const nth = medias.length; const count = incoming(node.id, `i_${sec.key}`).length;
        imageLines.push(`Image ${nth} — ${sec.label}${count > 1 ? ` ${imageLines.filter((l) => l.includes(sec.label)).length + 1}` : ''}${src.data.name ? ` (file: ${src.data.name})` : ''}`);
        anything = true;
      }
      continue;
    }
    const up = await promptText(node, cascade, `s_${sec.key}`);
    const inline = (node.data.values?.[sec.key] || '').trim();
    const text = [up.text, inline].filter(Boolean).join('\n\n');
    if (!text) continue; // empty sections are simply not sent, so nothing invites the model to fill them
    anything = true;
    lines.push('', sec.label.toUpperCase(), text);
  }
  if (!anything) throw new Error('Give the template something to work with: at least a scene context or a reference image.');
  resolveMentions(node, lines.join('\n'), { lenient: true }); // stops here if a section mentions an image that is not connected
  if (imageLines.length) lines.push('', 'REFERENCE IMAGES (attached in this order; refer to them as @Image N)', imageLines.join('\n'));
  if (spec.instruction) lines.push('', spec.instruction);
  node.data.status = 'running'; node.data.error = null;
  bus.emit('status', node.id);
  const r = await api.complete(node.data.model, { system: spec.system, instructions: lines.join('\n'), prompt: '', medias, params: node.data.params || {} });
  node.data.pendingJob = r.jobId;
  save(true);
  await finishLLM(node);
}

// Poll an LLM job to completion and store its text.
async function finishLLM(node) {
  let failures = 0;
  for (;;) {
    let j;
    try { j = await api.job(node.data.pendingJob); failures = 0; }
    catch (e) { if (e.code === 'NO_JOB' || ++failures > 20) throw new Error(e.code === 'NO_JOB' ? 'This run is no longer tracked by the server.' : e.message); await sleep(POLL_MS); continue; }
    if (j.status === 'completed') {
      node.data.output = (j.text || '').trim();
      node.data.status = 'done'; delete node.data.pendingJob;
      bus.emit('status', node.id); bus.emit('llm:output', node.id); bus.emit('prompt:change', node.id);
      save(true);
      return;
    }
    if (TERMINAL.has(j.status)) { delete node.data.pendingJob; throw new Error(j.error || 'The model run failed.'); }
    await sleep(1500);
  }
}

async function execute(node, cascade) {
  if (!node.data.model) throw new Error('Connect an API key in Settings first.');
  const schema = node.data.schema || await loadSchema(node.data.model);
  // Prompt
  const pt = await promptText(node, cascade);
  const prompt = pt.linked ? pt.text : (node.data.prompt || '').trim();
  // "@image 2" must point at a connected image (checked before anything is spent), then is phrased for the model.
  const mt = resolveMentions(node, prompt);

  // Media inputs
  const medias = [];
  const roleFor = { refs: 'image', start: 'start_image', end: 'end_image', vrefs: 'video' };
  for (const [port, role] of Object.entries(roleFor)) {
    for (const e of incoming(node.id, port)) {
      const src = state.nodes[e.from]; if (!src) continue;
      const m = await mediaRef(src, cascade);
      if (m) medias.push({ role, ref: m.ref, url: m.url, ...(mt.used ? { label: mt.labels[e.id] } : {}) });
    }
  }
  if (!prompt && !medias.length) throw new Error('Add a prompt (or connect a Prompt node) before generating.');
  if (schemaParam(schema, 'prompt')?.required && !prompt) throw new Error('This model needs a prompt.');

  // Params: only what the schema knows about
  const params = {};
  for (const [k, v] of Object.entries(node.data.params || {})) if (schemaParam(schema, k) && v !== undefined && v !== null && v !== '') params[k] = v;
  if (prompt) params.prompt = mt.text;
  // "Auto" aspect ratio: read the prompt, else match a connected image, else the model default.
  node.data.autoRatio = null;
  for (const k of Object.keys(params)) {
    if (!isAspectParam(k) || params[k] !== AUTO) continue;
    const imageRatio = await connectedImageRatio(node);
    const r = resolveAuto(schemaParam(schema, k), { prompt, imageRatio });
    if (r.value === undefined) delete params[k]; else params[k] = r.value;
    if (r.from === 'prompt' || r.from === 'image') node.data.autoRatio = String(r.value).replace('x', ' × ');
  }
  const sp = soundParam(schema);
  if (sp && params[sp.key] === undefined) params[sp.key] = schemaParam(schema, sp.key).default;

  const count = node.type === 'image' ? Math.max(1, Math.min(4, node.data.batch || 1)) : 1;

  archiveActiveRun(node);
  node.data.runMeta = { at: Date.now(), model: node.data.model, prompt: prompt.slice(0, 400), params: { ...params, prompt: undefined } };
  node.data.status = 'running'; node.data.error = null;
  node.data.results = Array.from({ length: count }, () => ({ status: 'queued' }));
  node.data.selected = 0;
  bus.emit('status', node.id); bus.emit('results', node.id);

  const out = await api.generate(node.data.model, params, medias, count);
  const jobs = out.jobs || [];
  if (!jobs.length) throw new Error(out.error || 'No job was created.');
  node.data.results = jobs.map((j) => ({ jobId: j.id, status: j.status || 'queued', url: j.result_url || null }));
  if (out.errors && out.errors.length) bus.emit('toast', { msg: `${out.errors.length} of ${count} jobs failed to start: ${out.errors[0]}`, kind: 'err' });
  bus.emit('results', node.id);
  save(true);

  await pollAll(node);

  const ok = node.data.results.filter((r) => r.status === 'completed' && r.url);
  node.data.status = ok.length ? 'done' : 'error';
  node.data.error = ok.length ? null : (node.data.results.find((r) => r.error)?.error || `Generation ${node.data.results[0]?.status || 'failed'}.`);
  if (!ok.length) throw new Error(node.data.error);
  node.data.selected = node.data.results.findIndex((r) => r.status === 'completed');
  bus.emit('status', node.id); bus.emit('results', node.id); bus.emit('generated', node.id);
  save();
}

async function pollAll(node) {
  const pending = () => node.data.results.filter((r) => r.jobId && !TERMINAL.has(r.status));
  let failures = 0;
  let first = true;
  while (pending().length) {
    if (!first) await sleep(POLL_MS); first = false;
    await Promise.all(pending().map(async (r) => {
      try {
        const j = await api.job(r.jobId);
        if (!j) return;
        r.status = j.status || r.status;
        if (j.result_url) r.url = j.result_url;
        if (j.error) r.error = j.error;
        if (r.status === 'completed' && !r.url) r.status = 'in_progress';
        // Some API models return several images for one request.
        if (r.status === 'completed' && Array.isArray(j.extra_urls) && j.extra_urls.length && !r.expanded) {
          r.expanded = true;
          const i = node.data.results.indexOf(r);
          node.data.results.splice(i + 1, 0, ...j.extra_urls.map((u) => ({ jobId: r.jobId, status: 'completed', url: u, expanded: true })));
        }
        failures = 0;
      } catch (e) {
        if (e.code === 'NO_JOB') { r.status = 'error'; r.error = 'No longer tracked by the server.'; }
        else if (++failures > 20) { r.status = 'error'; r.error = e.message; }
      }
    }));
    bus.emit('results', node.id); bus.emit('status', node.id);
    save(true);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// After a reload, pick up any jobs that were still running.
export function resumeAll() {
  for (const node of Object.values(state.nodes)) {
    if (isLLM(node) && node.data.pendingJob) {
      const p = (async () => {
        node.data.status = 'running'; bus.emit('status', node.id);
        try { await finishLLM(node); }
        catch (e) { node.data.status = 'error'; node.data.error = e.message; bus.emit('status', node.id); save(true); }
        finally { inflight.delete(node.id); }
      })();
      inflight.set(node.id, p);
      continue;
    }
    if (!isGen(node)) continue;
    const open = (node.data.results || []).filter((r) => r.jobId && !TERMINAL.has(r.status));
    if (!open.length) continue;
    const p = (async () => {
      node.data.status = 'running'; bus.emit('status', node.id);
      try {
        await pollAll(node);
        const ok = node.data.results.filter((r) => r.status === 'completed' && r.url);
        node.data.status = ok.length ? 'done' : 'error';
        node.data.error = ok.length ? null : 'Generation failed.';
        if (node.data.results[node.data.selected]?.status !== 'completed') node.data.selected = Math.max(0, node.data.results.findIndex((r) => r.status === 'completed'));
        bus.emit('status', node.id); bus.emit('results', node.id); bus.emit('generated', node.id); save(true);
      } catch (e) { node.data.status = 'error'; node.data.error = e.message; bus.emit('status', node.id); }
      finally { inflight.delete(node.id); }
    })();
    inflight.set(node.id, p);
  }
}

bus.on('run:node', (id) => runNode(id));
bus.on('run:downstream', (id) => runDownstream(id));
