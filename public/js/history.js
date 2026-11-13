// Undo and redo for everything done to the board: adding, deleting, moving and resizing nodes; typing and every
// setting inside a node; renaming; connecting, disconnecting and reordering strands; grouping, ungrouping and anything
// done to a group; pen drawings; the board's name. ⌘Z puts the last thing back, ⇧⌘Z does it again.
//
// How it works. Nothing in the app reports what it did. Instead a copy of the board as it last stood is kept (`last`),
// and whenever the board is saved the two are compared: what differs becomes one step. A step holds only what changed,
// so undoing it touches nothing else.
//   One step per action   A drag, a slider pull or a pen stroke is one step however many times it saves (the step is
//                         taken when the pointer lets go). Typing is one step per pause.
//   What undo leaves alone   What a run writes: results, history, status, errors. A generation cannot be un-run, and
//                         undoing an earlier move must never take a picture away. Deleting a result or a run, and
//                         making a past run current, are your actions, and those are steps (run.js says so).
//   Changes nobody made   A file finishing its upload, a model list arriving, a picture being measured. They are
//                         folded into `last` without a step, so ⌘Z never appears to do nothing.
//   A deleted node        is kept as it was, the same object. A run still going when it was deleted finishes into it,
//                         and undo brings the node back with its results.
import { state, bus, save, removeNodes, removeEdge, select, outgoing, linkOuts, NODE_TYPES } from './state.js';
import { nodeEl, renderEdges, isTyping } from './canvas.js';
import { remountNode, recomputeBatch } from './nodes.js';
import { redrawGroups } from './groups.js';
import { isRunning } from './run.js';
import { api } from './api.js';

const LIMIT = 100;
const RUN = ['status', 'error', 'results', 'history', 'selected', 'runMeta', 'pendingJob', 'autoRatio']; // written by runs
const WORKED_OUT = ['schema', 'schemaPorts', 'pending']; // rebuilt from the model list or gone when an upload ends
const SHARED = ['output'];                               // a run writes this, and you can edit it
// Worked out from what is connected, and worked out again whenever that changes: never a step of its own. (A strand
// plugged into a Link in reaches a Prompt batch a moment later; its new list must not become a second, empty-looking step.)
const FOLLOWS = { combine: ['text'], batch: ['items'] };
const TEXT = ['text', 'html', 'prompt', 'system', 'instructions', 'output', 'caption', 'items', 'values', 'custom'];
const undos = [], redos = [];

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const usable = (u) => typeof u === 'string' && u !== '' && !u.startsWith('blob:');
const ser = (n) => { const d = { ...n.data }; for (const k of WORKED_OUT) delete d[k]; return JSON.stringify({ ...n, data: d }); };

// ---------- the board as it last stood ----------
let last = null;
function take() {
  const nodes = new Map(), edges = new Map();
  for (const n of Object.values(state.nodes)) nodes.set(n.id, ser(n));
  for (const e of Object.values(state.edges)) edges.set(e.id, JSON.stringify(e));
  return { nodes, edges, groups: JSON.stringify(state.groups), strokes: state.strokes.slice(), name: state.name };
}

// ---------- who made a change ----------
let lastUser = -1e9;   // when the user last pressed, typed, dropped or let go of something
let appliedAt = -1e9;  // when an undo or redo last ran: what follows it without a new press is the app tidying up
let pointers = 0;      // pointers held down
let byUser = false;    // something since the last step was the user's
let applying = false;
let timer = 0;      // > 0: a step is about to be taken; -1: waiting for the pointer to be let go
let typing = false; // …and it is waiting for a pause in typing
const runEdits = new Set();  // nodes whose results the user is changing by hand (delete a result, restore a run)
const removed = new Map();   // nodes deleted since the last step, the objects themselves
const userEvent = () => { lastUser = performance.now(); };
for (const type of ['input', 'change', 'paste', 'cut', 'drop']) window.addEventListener(type, userEvent, true);
// A new press or key begins a new step: whatever the last action changed is settled first, without waiting for a timer
// (a page in the background runs its timers late). Keys pressed while typing carry on the same step.
window.addEventListener('keydown', () => { if (timer > 0 && !typing) commit(); userEvent(); }, true);
window.addEventListener('pointerdown', () => { if (timer > 0) commit(); pointers++; userEvent(); }, true);
const letGo = () => { pointers = Math.max(0, pointers - 1); userEvent(); if (!pointers && timer === -1) soon(0); };
window.addEventListener('pointerup', letGo, true);
window.addEventListener('pointercancel', letGo, true);
// A release the page never heard of (the pointer was let go outside the window) must not hold steps back for good.
window.addEventListener('pointermove', (e) => { if (pointers && e.buttons === 0 && e.pointerType === 'mouse') { pointers = 0; if (timer === -1) soon(0); } }, true);
window.addEventListener('blur', () => { pointers = 0; if (timer === -1) soon(0); });
// Leaving a text box ends the typing step there and then.
window.addEventListener('focusout', () => { if (timer > 0) soon(0); }, true);
bus.on('history:user', userEvent); // a slow action of the user's (an upload first, then the change) is about to land

function soon(ms) { if (timer > 0) clearTimeout(timer); typing = ms > 0; timer = setTimeout(commit, ms); }
// Every save says the board may have changed.
bus.on('change', () => {
  if (applying || !last) return;
  if (pointers || (lastUser > appliedAt && performance.now() - lastUser < 1500)) byUser = true;
  if (pointers) { if (timer > 0) clearTimeout(timer); timer = -1; return; } // the end of the gesture makes the step
  soon(isTyping(document.activeElement) ? 700 : 0);
});
bus.on('node:remove', (n) => { if (!applying) removed.set(n.id, n); });
// A result or a run is about to be deleted or restored by hand: what stood before must be exact, so settle up first.
bus.on('history:run-edit', (id) => { commit(); runEdits.add(id); byUser = true; });

// ---------- making a step ----------
function commit() {
  if (timer > 0) clearTimeout(timer); timer = 0;
  if (applying || !last) return;
  const now = take();
  const step = compare(last, now, byUser);
  last = now; byUser = false; runEdits.clear(); removed.clear();
  if (!step) return;
  undos.push(step); if (undos.length > LIMIT) undos.shift();
  redos.length = 0;
}
// What one node's change comes to: { id, top: { x: [before, after] }, data: { text: [before, after] } }, or null.
function patch(old, cur) {
  const top = {}, data = {};
  for (const k of new Set([...Object.keys(old), ...Object.keys(cur)])) if (k !== 'id' && k !== 'type' && k !== 'data' && !eq(old[k], cur[k])) top[k] = [old[k], cur[k]];
  const od = old.data || {}, cd = cur.data || {}, type = cur.type;
  const byHand = runEdits.has(cur.id);
  const ran = RUN.some((k) => !eq(od[k], cd[k])) || isRunning(cur.id); // a run wrote to the node in the same stretch
  for (const k of new Set([...Object.keys(od), ...Object.keys(cd)])) {
    if (eq(od[k], cd[k])) continue;
    if (RUN.includes(k)) { if (!byHand) continue; }
    else if (WORKED_OUT.includes(k) || (FOLLOWS[type] || []).includes(k)) continue;      // follows from other things
    else if (SHARED.includes(k) && ran && !byHand) continue;                             // the run's, not yours
    else if (type === 'media' && k === 'url' && !usable(od.url)) continue;               // an upload arriving
    else if (type === 'media' && (k === 'w' || k === 'h' || k === 'lost' || k === 'kind') && (!od[k] || !usable(od.url))) continue; // …and being measured
    else if (k === 'model' && !od.model) continue;                                       // the first model, chosen for you
    data[k] = [od[k], cd[k]];
  }
  return Object.keys(top).length || Object.keys(data).length ? { id: cur.id, top, data } : null;
}
function compare(a, b, user) {
  const step = { nodes: [], patches: [], edges: [] };
  for (const id of b.nodes.keys()) if (!a.nodes.has(id)) step.nodes.push({ id, removed: false, ref: null });
  for (const [id, json] of a.nodes) if (!b.nodes.has(id)) step.nodes.push({ id, removed: true, ref: removed.get(id) || JSON.parse(json) });
  // A change inside a node is a step only when the user was at work. Whole nodes, strands and groups always are.
  if (user) for (const [id, json] of b.nodes) { const old = a.nodes.get(id); if (old === undefined || old === json) continue; const p = patch(JSON.parse(old), JSON.parse(json)); if (p) step.patches.push(p); }
  for (const [id, json] of b.edges) { const old = a.edges.get(id); if (old !== json) step.edges.push({ id, from: old ? JSON.parse(old) : null, to: JSON.parse(json) }); }
  for (const [id, json] of a.edges) if (!b.edges.has(id)) step.edges.push({ id, from: JSON.parse(json), to: null });
  if (a.groups !== b.groups) step.groups = { from: a.groups, to: b.groups };
  if (a.strokes.length !== b.strokes.length || a.strokes.some((s, i) => s !== b.strokes[i])) step.strokes = { from: a.strokes, to: b.strokes };
  if (a.name !== b.name) step.name = { from: a.name, to: b.name };
  return step.nodes.length || step.patches.length || step.edges.length || step.groups || step.strokes || step.name ? step : null;
}

// ---------- putting a step back, or doing it again ----------
const put = (o, k, v) => { if (v === undefined) delete o[k]; else o[k] = clone(v); };
function apply(step, dir) {
  const back = dir === 'undo', want = back ? 0 : 1;
  const redrawn = new Set(), revived = [];
  applying = true;
  try {
    // Nodes that go. The object is kept, so the opposite step brings back exactly this node.
    const going = step.nodes.filter((e) => e.removed !== back && state.nodes[e.id]);
    for (const e of going) e.ref = state.nodes[e.id];
    if (going.length) removeNodes(going.map((e) => e.id));
    // Nodes that come back.
    for (const e of step.nodes) {
      if (e.removed !== back || !e.ref || state.nodes[e.id] || !NODE_TYPES[e.ref.type]) continue;
      const n = e.ref;
      if (n.data.status === 'running' && !isRunning(n.id)) n.data.status = 'idle'; // nothing is watching that run any more
      state.nodes[n.id] = n; bus.emit('node:add', n); revived.push(n.id);
    }
    // Changes inside nodes.
    for (const p of step.patches) {
      const n = state.nodes[p.id]; if (!n) continue;
      let inside = false;
      for (const [k, v] of Object.entries(p.top)) put(n, k, v[want]);
      for (const [k, v] of Object.entries(p.data)) {
        // What a run also writes is put back only if it still stands as this step left it, and never mid-run.
        if ((RUN.includes(k) || SHARED.includes(k)) && (isRunning(n.id) || !eq(n.data[k], v[1 - want]))) continue;
        put(n.data, k, v[want]); inside = true;
      }
      if (inside || Object.keys(p.top).some((k) => k !== 'x' && k !== 'y' && k !== 'w')) redrawn.add(n.id);
      else {
        const el = nodeEl(n.id);
        if (el) { el.style.left = `${n.x}px`; el.style.top = `${n.y}px`; el.style.width = `${n.w || NODE_TYPES[n.type].width}px`; el.classList.toggle('sized', !!n.w); }
      }
    }
    for (const id of redrawn) remountNode(id);
    // Strands.
    for (const e of step.edges) {
      const target = back ? e.from : e.to, cur = state.edges[e.id];
      if (!target) { if (cur) removeEdge(e.id, false); continue; }
      if (!state.nodes[target.from] || !state.nodes[target.to]) continue;
      state.edges[e.id] = { ...target };
      if (!cur) bus.emit('edge:add', state.edges[e.id]); else bus.emit('edges:reorder', { id: target.to, port: target.toPort });
    }
    // Groups, drawings, the board's name.
    if (step.groups) { state.groups = JSON.parse(back ? step.groups.from : step.groups.to); if (!state.groups[state.selGroup]) state.selGroup = null; }
    if (step.strokes) { state.strokes = (back ? step.strokes.from : step.strokes.to).slice(); bus.emit('strokes'); }
    if (step.name) {
      state.name = back ? step.name.from : step.name.to;
      document.getElementById('board-name').textContent = state.name;
      if (state.project) { state.project.name = state.name; api.projectRename(state.project.id, state.name).catch(() => {}); bus.emit('project'); }
    }
    // Whatever shows a changed node's text, name or file looks again.
    for (const id of redrawn) {
      const n = state.nodes[id]; if (!n) continue;
      if (n.type === 'batch') recomputeBatch(n); // its list follows its settings and what feeds it
      bus.emit('prompt:change', id); bus.emit('results', id);
      for (const e of outgoing(id)) bus.emit('edge:refresh', e);
      if (n.type === 'linkin') for (const lo of linkOuts(id)) { remountNode(lo.id); for (const e of outgoing(lo.id)) bus.emit('edge:refresh', e); }
    }
    if (step.patches.some((p) => 'title' in p.data)) bus.emit('node:renamed', {});
    document.getElementById('empty').hidden = Object.keys(state.nodes).length > 0;
    if (revived.length) select(revived); else bus.emit('selection');
    redrawGroups(); renderEdges(); save();
  } finally { applying = false; }
  last = take(); appliedAt = performance.now(); byUser = false; runEdits.clear(); removed.clear();
  if (timer > 0) clearTimeout(timer); timer = 0;
}

// In a few words, what a step was: "deleting 2 nodes", "an edit to Prompt", "a move".
function describe(step) {
  const many = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const gone = step.nodes.filter((e) => e.removed).length, came = step.nodes.length - gone;
  if (gone && !came) return `deleting ${many(gone, 'node')}`;
  if (came && !gone) return `adding ${many(came, 'node')}`;
  if (gone && came) return 'a change of nodes';
  if (step.groups) {
    const a = Object.keys(JSON.parse(step.groups.from)), b = Object.keys(JSON.parse(step.groups.to));
    if (b.length < a.length) return 'ungrouping';
    if (b.length > a.length) return 'grouping';
    if (a.join() !== b.join()) return 'reordering the groups';
    if (!step.patches.length) return 'a change to a group';
  }
  if (step.patches.length) {
    const keys = new Set(step.patches.flatMap((p) => Object.keys(p.data)));
    const n = state.nodes[step.patches[0].id] || {}; const name = n.type ? n.data.title || NODE_TYPES[n.type].title : 'a node';
    const which = step.patches.length === 1 ? name : many(step.patches.length, 'node');
    if (!keys.size) return step.patches.some((p) => 'w' in p.top) && !step.patches.some((p) => 'x' in p.top || 'y' in p.top) ? `resizing ${which}` : `moving ${which}`;
    if (keys.has('title') && keys.size === 1) return 'a rename';
    if (RUN.some((k) => keys.has(k))) return `a change to the results of ${which}`;
    return [...keys].some((k) => TEXT.includes(k)) ? `an edit to ${which}` : `a change to ${which}`;
  }
  if (step.edges.length) {
    const made = step.edges.filter((e) => !e.from).length, cut = step.edges.filter((e) => !e.to).length;
    if (made && !cut) return many(made, 'connection');
    if (cut && !made) return `disconnecting ${many(cut, 'strand')}`;
    return made || cut ? 'a change of connections' : 'a change of order';
  }
  if (step.strokes) return step.strokes.to.length < step.strokes.from.length ? 'erasing a drawing' : 'a drawing';
  if (step.name) return 'renaming the board';
  return 'a change';
}

// Both return what was put back or done again, in a few words, or null when there was nothing.
export function undo() { commit(); const s = undos.pop(); if (!s) return null; const what = describe(s); apply(s, 'undo'); redos.push(s); return what; }
export function redo() { commit(); const s = redos.pop(); if (!s) return null; const what = describe(s); apply(s, 'redo'); undos.push(s); return what; }
export const canUndo = () => undos.length > 0;
export const canRedo = () => redos.length > 0;

// ---------- another board, or the same board with its files moved ----------
function reset() { undos.length = 0; redos.length = 0; byUser = false; runEdits.clear(); removed.clear(); last = take(); }
// Files changed address (saved into a project's folder, PNG to JPEG): what is kept here follows them.
const eachString = (o, fn) => { if (!o || typeof o !== 'object') return; for (const k of Object.keys(o)) { const v = o[k]; if (typeof v === 'string') o[k] = fn(v); else eachString(v, fn); } };
function relink(urls) {
  if (!urls || !Object.keys(urls).length) return;
  const fix = (s) => urls[s] || s;
  for (const step of [...undos, ...redos]) {
    for (const e of step.nodes) if (e.ref && !state.nodes[e.id]) eachString(e.ref.data, fix);
    for (const p of step.patches) eachString(p.data, fix);
  }
  // `last` learns the new addresses too, so the move itself is not taken for a change.
  if (last) for (const [id, json] of last.nodes) { const n = JSON.parse(json); eachString(n.data, fix); last.nodes.set(id, JSON.stringify(n)); }
}
bus.on('media:relinked', relink);
// A project save hands back the same board with its files inside the project folder. projects.js says so just before
// it swaps the board in; any other board being mounted is a different board, and the steps of the old one end there.
let adopting = null;
bus.on('history:adopting', () => { commit(); adopting = state.nodes; });
bus.on('board:mounted', () => {
  const before = adopting; adopting = null;
  if (!before || !last) { reset(); return; }
  const urls = {};
  const walk = (a, b) => {
    if (typeof a === 'string') { if (typeof b === 'string' && a !== b && /^(\/|https?:)/.test(a)) urls[a] = b; return; }
    if (a && b && typeof a === 'object' && typeof b === 'object') for (const k of Object.keys(a)) walk(a[k], b[k]);
  };
  for (const [id, n] of Object.entries(before)) if (state.nodes[id]) walk(n.data, state.nodes[id].data);
  relink(urls);
  last = take(); byUser = false;
});
bus.on('history:reset', reset);
