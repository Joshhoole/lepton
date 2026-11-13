// Execution engine: resolves a generator node's inputs, submits jobs, polls them, and cascades upstream.
import { state, bus, incoming, outgoing, isGen, isLLM, isRunnable, save, NODE_TYPES } from './state.js';
import { api } from './api.js';
import { loadSchema, schemaParam, soundParam, AUTO, isAspectParam, resolveAuto } from './models.js';
import { splitPrompts } from './split.js';
import { resolveMentions } from './mentions.js';
import { joinPieces, recomputeCombine } from './combine.js';

const inflight = new Map(); // nodeId → Promise
const TERMINAL = new Set(['completed', 'failed', 'nsfw', 'cancelled', 'canceled', 'error']);
const POLL_MS = 3000;

export function isRunning(id) { return inflight.has(id); }

// ---------- stop ----------
// A run the user stopped ends quietly: no error on the node, and the results it had before come back.
class Stopped extends Error { constructor(msg) { super(msg || 'Stopped.'); this.stopped = true; } }
const stopping = new Set();     // nodes with a Stop press being worked out
const unstoppable = new Set();  // nodes whose provider said it was too late; the run carries on
const stoppedNodes = new Set(); // nodes whose last run was stopped, so nodes waiting on them stop too
const undoRun = new Map();      // nodeId → what the node showed before this run began
const wakers = new Map();       // nodeId → cut the wait between status checks short
export const isStopping = (id) => stopping.has(id);
export const canStop = (id) => inflight.has(id) && !unstoppable.has(id);
const openJobs = (node) => (isGen(node) ? (node.data.results || []).filter((r) => r.jobId && !TERMINAL.has(r.status)) : node.data.pendingJob ? [{ jobId: node.data.pendingJob }] : []);

export function stopNode(id) {
  const node = state.nodes[id];
  if (!node || !inflight.has(id) || stopping.has(id) || unstoppable.has(id)) return;
  stopping.add(id); bus.emit('status', id);
  // Jobs already exist: ask now. Otherwise the run notices the press as soon as it has something to stop.
  if (openJobs(node).length) settleStop(node);
}
// Ask the server what can still be done about each job, apply it, and say plainly what happened.
async function settleStop(node) {
  const open = openJobs(node); const ids = [...new Set(open.map((r) => r.jobId))];
  let outs = [];
  try { outs = (await api.stopJobs(ids)).results || []; }
  catch (e) { stopping.delete(node.id); bus.emit('status', node.id); bus.emit('toast', { msg: `Could not stop: ${e.message}`, kind: 'err' }); return; }
  const by = new Map(outs.map((o) => [o.id, o]));
  const gone = [], late = [];
  for (const r of open) {
    const o = by.get(r.jobId); if (!o) continue;
    if (o.outcome === 'stopped' || o.outcome === 'cancelled' || o.outcome === 'abandoned') { r.status = 'cancelled'; r.stoppedByUser = true; gone.push(o); }
    else if (o.outcome === 'too_late') late.push(o);
  }
  if (gone.length && !isGen(node)) node.data.stoppedByUser = true;
  if (late.length) unstoppable.add(node.id);
  // Everything stopped: the button stays on "Stopping…" for the moment it takes the run to wind up. Otherwise the
  // run carries on and the button goes back to showing it.
  if (openJobs(node).length) stopping.delete(node.id);
  const wake = wakers.get(node.id); if (wake) wake();
  const n = (list) => new Set(list.map((o) => o.id)).size;
  if (late.length && gone.length) bus.emit('toast', { msg: `Stopped ${n(gone)} of ${n(gone) + n(late)}. Too late for the rest: ${late[0].message}`, kind: 'err' });
  else if (late.length) bus.emit('toast', { msg: `Too late to stop. ${late[0].message}`, kind: 'err' });
  else if (gone.length) bus.emit('toast', { msg: gone[0].message, kind: 'ok' });
  else bus.emit('toast', { msg: (outs[0] && outs[0].message) || 'It had already finished.' });
  bus.emit('status', node.id); bus.emit('results', node.id); save(true);
}
// The end of a stopped run: drop its placeholders and put back what the node showed before.
function settleStopped(node) {
  stoppedNodes.add(node.id);
  if (isGen(node)) {
    node.data.results = (node.data.results || []).filter((r) => r.jobId && r.status === 'completed' && r.url);
    const undo = undoRun.get(node.id);
    const i = undo ? (node.data.history || []).findIndex((h) => h.id === undo.run) : -1;
    if (!node.data.results.length && i >= 0) {
      const run = node.data.history.splice(i, 1)[0];
      node.data.results = run.results.map((r) => ({ ...r }));
      node.data.runMeta = undo.meta; node.data.selected = Math.min(undo.selected || 0, node.data.results.length - 1);
    }
    node.data.status = node.data.results.length ? 'done' : 'idle';
  } else {
    delete node.data.pendingJob; delete node.data.stoppedByUser;
    node.data.status = (node.data.output || '').trim() ? 'done' : 'idle';
  }
  node.data.error = null;
  bus.emit('status', node.id); bus.emit('results', node.id); bus.emit('history', node.id);
  save(true);
}

export async function runNode(id, { cascade = true } = {}) {
  if (inflight.has(id)) return inflight.get(id);
  const node = state.nodes[id];
  if (!node || !isRunnable(node)) return;
  stoppedNodes.delete(id); delete node.data.stoppedByUser;
  const p = (async () => {
    try { await (node.type === 'template' ? executeTemplate(node, cascade) : isLLM(node) ? executeLLM(node, cascade) : execute(node, cascade)); }
    catch (e) {
      if (e && e.stopped) { settleStopped(node); return; }
      node.data.status = 'error'; node.data.error = e.message || String(e);
      // Placeholders that never became jobs must not sit there spinning.
      if (Array.isArray(node.data.results)) node.data.results = node.data.results.filter((r) => r.jobId);
      bus.emit('status', id); bus.emit('results', id);
      bus.emit('toast', { msg: e.message || String(e), kind: 'err' });
    } finally { inflight.delete(id); stopping.delete(id); unstoppable.delete(id); undoRun.delete(id); bus.emit('status', id); }
  })();
  inflight.set(id, p);
  return p;
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
    if (!src.data.url) throw new Error(`"${src.data.name || 'Media'}" has no file. Choose it again on its node.`);
    return { ref: src.data.url, url: /^https?:\/\//.test(src.data.url || '') ? src.data.url : null, kind: src.data.kind || 'image' };
  }
  if (isGen(src)) {
    const pick = () => {
      const res = src.data.results || [];
      const sel = res[src.data.selected] && res[src.data.selected].status === 'completed' ? res[src.data.selected] : res.find((r) => r.status === 'completed');
      return sel ? { ref: sel.url, url: /^https?:\/\//.test(sel.url || '') ? sel.url : null, kind: src.type } : null;
    };
    if (inflight.has(src.id)) { await inflight.get(src.id); const got = pick(); if (!got && stoppedNodes.has(src.id)) throw new Stopped(); return got; }
    let ref = pick();
    if (!ref && cascade) { await runNode(src.id, { cascade }); ref = pick(); }
    if (!ref && stoppedNodes.has(src.id)) throw new Stopped();
    if (!ref) throw new Error(`"${src.data.title || NODE_TYPES[src.type].title}" has no result to use yet.`);
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
  node.data.history = [{ id: Math.random().toString(36).slice(2, 10), at: meta.at || Date.now(), model: meta.model || node.data.model, prompt: meta.prompt || '', params: meta.params || {}, results: done.map((r) => ({ jobId: r.jobId, status: 'completed', url: r.url, thumb: r.thumb || null, ...(r.prompt ? { pi: r.pi, prompt: r.prompt } : {}) })) }, ...(node.data.history || [])].slice(0, HISTORY_MAX);
}
// Make a past run the active one; the current active run goes back into history.
export function restoreRun(node, runId) {
  const i = (node.data.history || []).findIndex((h) => h.id === runId); if (i < 0) return;
  bus.emit('history:run-edit', node.id); // ⌘Z puts the runs back as they were
  const run = node.data.history[i];
  node.data.history.splice(i, 1);
  archiveActiveRun(node);
  node.data.results = run.results.map((r) => ({ ...r }));
  node.data.runMeta = { at: run.at, model: run.model, prompt: run.prompt, params: run.params };
  node.data.selected = 0; node.data.status = 'done'; node.data.error = null;
  save(true); bus.emit('status', node.id); bus.emit('results', node.id); bus.emit('history', node.id);
}
export function deleteRun(node, runId) {
  bus.emit('history:run-edit', node.id);
  node.data.history = (node.data.history || []).filter((h) => h.id !== runId);
  save(true); bus.emit('history', node.id);
}
export function deleteResult(node, runId, index) {
  bus.emit('history:run-edit', node.id);
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
// A Prompt batch's "All prompts" port is a list: with `expand` the list comes back as `prompts` (one generation each,
// any other linked text in front of every one); otherwise the prompts are joined into one block of text.
// A Combine node hands over its pieces already joined its own way; `flat` (used for a Combine node's own inputs)
// keeps a batch's prompts as separate pieces instead of one block.
async function promptText(node, cascade, portKey = 'prompt', { expand = false, flat = false } = {}) {
  const links = incoming(node.id, portKey);
  const parts = []; const sets = [];
  for (const e of links) {
    const src = state.nodes[e.from]; if (!src) continue;
    if (src.type === 'prompt') parts.push((src.data.text || '').trim());
    else if (src.type === 'combine') parts.push(await combinedText(src, cascade));
    else if (isLLM(src)) {
      if (inflight.has(src.id)) await inflight.get(src.id);
      else if (!(src.data.output || '').trim() && cascade) await runNode(src.id, { cascade });
      if (stoppedNodes.has(src.id) && !(src.data.output || '').trim()) throw new Stopped();
      if (src.data.status === 'error') throw new Error(`"${src.data.title || 'LLM'}" failed: ${src.data.error}`);
      parts.push((src.data.output || '').trim());
    }
    else if (src.type === 'batch') {
      const items = await batchItems(src, cascade);
      if (e.fromPort === 'all') {
        if (!items.length) throw new Error(`"${src.data.title || 'Prompt batch'}" has no prompts yet.`);
        if (expand) sets.push(items); else if (flat) parts.push(...items); else parts.push(items.join('\n\n'));
        continue;
      }
      const i = Number(String(e.fromPort).replace('out', '')) || 0;
      if (!items[i]) throw new Error(`"${src.data.title || 'Prompt batch'}" has no prompt ${i + 1} yet.`);
      parts.push(items[i]);
    }
  }
  const text = parts.filter(Boolean).join('\n\n');
  return { linked: links.length > 0, text, parts, prompts: sets.length ? sets.flat() : null };
}
// What a Combine node sends: its pieces as they are right now (running an LLM that feeds it, if it has nothing yet),
// joined its own way. The node's stored text is brought up to date at the same time.
async function combinedText(node, cascade) {
  const { parts } = await promptText(node, cascade, 'prompt', { flat: true });
  const text = joinPieces(node, parts);
  if (text !== (node.data.text || '')) recomputeCombine(node);
  return text;
}
// How many generations a node's prompt port asks for: the prompts of every connected "All prompts" port, else one.
export function promptCount(node) {
  let n = 0;
  for (const e of incoming(node.id, 'prompt')) { const s = state.nodes[e.from]; if (s && s.type === 'batch' && e.fromPort === 'all') n += (s.data.items || []).length; }
  return n || 1;
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
  if (stopping.has(node.id)) await settleStop(node);
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
  if (stopping.has(node.id)) await settleStop(node);
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
    if (TERMINAL.has(j.status)) { const mine = node.data.stoppedByUser && /cancel/.test(j.status); delete node.data.pendingJob; if (mine) throw new Stopped(); throw new Error(j.error || 'The model run failed.'); }
    await sleep(1500);
  }
}

async function execute(node, cascade) {
  if (!node.data.model) throw new Error('Connect an API key in Settings first.');
  const schema = node.data.schema || await loadSchema(node.data.model);
  // Prompt: one, or a whole list when a Prompt batch's "All prompts" port is connected (other linked text goes in front of each).
  const pt = await promptText(node, cascade, 'prompt', { expand: true });
  const noText = node.type === 'audio' && !schemaParam(schema, 'prompt'); // a model that takes a recording, not words
  const prompts = noText ? [''] : pt.prompts ? pt.prompts.map((p) => [pt.text, p].filter(Boolean).join('\n\n')) : [pt.linked ? pt.text : (node.data.prompt || '').trim()];
  const prompt = prompts[0];
  // "@image 2" must point at a connected image (checked before anything is spent), then is phrased for the model.
  // A script for a voice is read as written: "@" in it is just a character.
  const mts = prompts.map((p) => (node.type === 'audio' ? { text: p, used: false, labels: {} } : resolveMentions(node, p)));
  const mt = mts[0];

  // Media inputs
  const medias = [];
  const roleFor = { refs: 'image', start: 'start_image', end: 'end_image', vrefs: 'video', arefs: 'audio' };
  for (const [port, role] of Object.entries(roleFor)) {
    for (const e of incoming(node.id, port)) {
      const src = state.nodes[e.from]; if (!src) continue;
      const m = await mediaRef(src, cascade);
      if (m) medias.push({ role, ref: m.ref, url: m.url, ...(mt.used ? { label: mt.labels[e.id] } : {}) });
    }
  }
  // An input the model cannot work without (the recording for voice isolation).
  for (const need of (schema.medias || []).filter((m) => m.required)) if (!medias.some((m) => m.role === need.role)) { const what = need.role.replace('_', ' '); throw new Error(`Connect ${/^[aeiou]/.test(what) ? 'an' : 'a'} ${what} file to "${node.data.title || NODE_TYPES[node.type].title}" first.`); }
  if (node.type === 'audio' && schemaParam(schema, 'prompt') && !prompt) throw new Error('Write what should be said (or connect a Prompt node) first.');
  if (!prompt && !medias.length) throw new Error('Add a prompt (or connect a Prompt node) before generating.');
  if (schemaParam(schema, 'prompt')?.required && !prompt) throw new Error('This model needs a prompt.');

  // Params: only what the schema knows about
  const params = {};
  for (const [k, v] of Object.entries(node.data.params || {})) if (schemaParam(schema, k) && v !== undefined && v !== null && v !== '') params[k] = v;
  // "Auto" aspect ratio: read the prompt, else match a connected image, else the model default. Read per prompt, so a
  // list of prompts can mix portrait and landscape; the label shows the ratio only when every prompt agrees.
  node.data.autoRatio = null;
  const autoKeys = Object.keys(params).filter((k) => isAspectParam(k) && params[k] === AUTO);
  const imageRatio = autoKeys.length ? await connectedImageRatio(node) : null;
  const sp = soundParam(schema);
  if (sp && params[sp.key] === undefined) params[sp.key] = schemaParam(schema, sp.key).default;
  const ratios = new Set();
  const paramSets = prompts.map((p, i) => {
    const ps = { ...params };
    if (p) ps.prompt = mts[i].text;
    for (const k of autoKeys) {
      const r = resolveAuto(schemaParam(schema, k), { prompt: p, imageRatio });
      if (r.value === undefined) delete ps[k]; else ps[k] = r.value;
      ratios.add(r.from === 'prompt' || r.from === 'image' ? String(r.value).replace('x', ' × ') : '');
    }
    return ps;
  });
  if (ratios.size === 1 && [...ratios][0]) node.data.autoRatio = [...ratios][0];
  // PROMPT CAP: the model's own character limit (Kling: 2,500). Checked here so nothing is spent on a prompt it will reject.
  const lim = schemaParam(schema, 'prompt')?.maxLength;
  if (lim) paramSets.forEach((ps, i) => {
    const len = String(ps.prompt || '').length; if (len <= lim) return;
    throw new Error(`${prompts.length > 1 ? `Prompt ${i + 1}` : 'The prompt'} is ${len.toLocaleString()} characters, ${(len - lim).toLocaleString()} over the ${lim.toLocaleString()}-character limit for ${schema.display_name || 'this model'}. Shorten it by ${(len - lim).toLocaleString()} characters.`);
  });

  const count = node.type === 'image' ? Math.max(1, Math.min(4, node.data.batch || 1)) : 1;
  const total = count * prompts.length;

  // Remember what the node shows now, so a stopped run can put it back.
  const prev = { meta: node.data.runMeta, selected: node.data.selected, top: (node.data.history || [])[0]?.id };
  archiveActiveRun(node);
  const archived = (node.data.history || [])[0]?.id;
  if (archived && archived !== prev.top) undoRun.set(node.id, { run: archived, meta: prev.meta, selected: prev.selected }); else undoRun.delete(node.id);
  node.data.runMeta = { at: Date.now(), model: node.data.model, prompt: (prompts.length > 1 ? `${prompts.length} prompts · ${prompt}` : prompt).slice(0, 400), params: { ...params, prompt: undefined } };
  node.data.status = 'running'; node.data.error = null;
  node.data.results = Array.from({ length: total }, (_, i) => ({ status: 'queued', pi: Math.floor(i / count) }));
  node.data.selected = 0;
  bus.emit('status', node.id); bus.emit('results', node.id);

  // Every prompt is submitted at once with the same settings; each one's results remember which prompt made them.
  const outs = await Promise.all(paramSets.map((ps) => api.generate(node.data.model, ps, medias, count).catch((e) => ({ jobs: [], errors: [e.message || String(e)] }))));
  const results = []; const errors = [];
  outs.forEach((out, i) => {
    for (const j of out.jobs || []) results.push({ jobId: j.id, status: j.status || 'queued', url: j.result_url || null, ...(prompts.length > 1 ? { pi: i, prompt: prompts[i].slice(0, 400) } : {}) });
    for (const err of out.errors || []) errors.push(err);
    if (out.error) errors.push(out.error);
  });
  if (!results.length) throw new Error(errors[0] || 'No job was created.');
  node.data.results = results;
  if (errors.length) bus.emit('toast', { msg: `${errors.length} of ${total} jobs failed to start: ${errors[0]}`, kind: 'err' });
  bus.emit('results', node.id);
  save(true);
  // Stop was pressed while the jobs were being handed to the server: now there is something to stop.
  if (stopping.has(node.id)) await settleStop(node);

  await pollAll(node);

  const stoppedSome = node.data.results.some((r) => r.stoppedByUser);
  node.data.results = node.data.results.filter((r) => !r.stoppedByUser);
  if (stoppedSome && !node.data.results.some((r) => r.status === 'completed' && r.url)) throw new Stopped();
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
    if (!first) { await Promise.race([sleep(POLL_MS), new Promise((r) => wakers.set(node.id, r))]); wakers.delete(node.id); } first = false;
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
          node.data.results.splice(i + 1, 0, ...j.extra_urls.map((u) => ({ jobId: r.jobId, status: 'completed', url: u, expanded: true, ...(r.prompt ? { pi: r.pi, prompt: r.prompt } : {}) })));
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
        catch (e) { if (e && e.stopped) settleStopped(node); else { node.data.status = 'error'; node.data.error = e.message; bus.emit('status', node.id); save(true); } }
        finally { inflight.delete(node.id); stopping.delete(node.id); unstoppable.delete(node.id); bus.emit('status', node.id); }
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
        const stoppedSome = node.data.results.some((r) => r.stoppedByUser);
        node.data.results = node.data.results.filter((r) => !r.stoppedByUser);
        const ok = node.data.results.filter((r) => r.status === 'completed' && r.url);
        if (stoppedSome && !ok.length) { settleStopped(node); return; }
        node.data.status = ok.length ? 'done' : 'error';
        node.data.error = ok.length ? null : 'Generation failed.';
        if (node.data.results[node.data.selected]?.status !== 'completed') node.data.selected = Math.max(0, node.data.results.findIndex((r) => r.status === 'completed'));
        bus.emit('status', node.id); bus.emit('results', node.id); bus.emit('generated', node.id); save(true);
      } catch (e) { node.data.status = 'error'; node.data.error = e.message; bus.emit('status', node.id); }
      finally { inflight.delete(node.id); stopping.delete(node.id); unstoppable.delete(node.id); bus.emit('status', node.id); }
    })();
    inflight.set(node.id, p);
  }
}

bus.on('run:node', (id) => runNode(id));
bus.on('stop:node', (id) => stopNode(id));
bus.on('run:downstream', (id) => runDownstream(id));
