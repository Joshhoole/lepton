// Undo for layout and wiring: moving, nudging and resizing nodes, and connecting or disconnecting strands.
// ⌘Z puts things back, ⇧⌘Z redoes. Results, text and running jobs are never touched.
import { state, bus, save, addEdge, removeEdge, NODE_TYPES } from './state.js';
import { nodeEl, renderEdges } from './canvas.js';

const LIMIT = 60;
const undos = [], redos = [];
const snap = (id) => { const n = state.nodes[id]; return n ? { x: n.x, y: n.y, w: n.w || null } : null; };
const same = (a, b) => a && b && a.x === b.x && a.y === b.y && (a.w || null) === (b.w || null);

// Call with the nodes' positions as they were before the change; the current positions are read now.
export function recordMove(ids, before) {
  const entries = [];
  ids.forEach((id, i) => { const from = before[i], to = snap(id); if (from && to && !same(from, to)) entries.push({ id, from, to }); });
  if (!entries.length) return;
  push({ type: 'move', entries });
}
function push(entry) { undos.push(entry); if (undos.length > LIMIT) undos.shift(); redos.length = 0; }
export const snapshot = (ids) => ids.map(snap);

// Connections made or broken in one gesture are gathered into one step (a multi-connect adds several at once).
let applying = false, pendingEdges = null;
const sameEdge = (a, b) => a.from === b.from && a.fromPort === b.fromPort && a.to === b.to && a.toPort === b.toPort;
function noteEdge(kind, e) {
  if (applying) return;
  if (!pendingEdges) { pendingEdges = { added: [], removed: [] }; setTimeout(flushEdges, 0); }
  pendingEdges[kind].push({ from: e.from, fromPort: e.fromPort, to: e.to, toPort: e.toPort });
}
function flushEdges() {
  const p = pendingEdges; pendingEdges = null; if (!p) return;
  // Strands that vanished because a node was deleted are not something undo can bring back on their own.
  const alive = (e) => state.nodes[e.from] && state.nodes[e.to];
  const added = p.added.filter(alive), removed = p.removed.filter(alive).filter((r) => !p.added.some((a) => sameEdge(a, r)));
  if (added.length || removed.length) push({ type: 'edges', added, removed });
}
bus.on('edge:add', (e) => noteEdge('added', e));
bus.on('edge:remove', (e) => noteEdge('removed', e));
function applyEdges(entry, direction) {
  // Undo: take away what was added, put back what was removed. Redo: the reverse.
  const take = direction === 'undo' ? entry.added : entry.removed;
  const give = direction === 'undo' ? entry.removed : entry.added;
  applying = true; let n = 0;
  try {
    for (const t of take) { const e = Object.values(state.edges).find((x) => sameEdge(x, t)); if (e) { removeEdge(e.id, false); n++; } }
    for (const g of give) if (addEdge(g.from, g.fromPort, g.to, g.toPort)) n++;
  } finally { applying = false; }
  save(); renderEdges();
  return n;
}

function apply(entries, key) {
  let n = 0;
  for (const e of entries) {
    const node = state.nodes[e.id]; if (!node) continue;
    const p = e[key]; node.x = p.x; node.y = p.y; if (p.w) node.w = p.w; else delete node.w;
    const el = nodeEl(e.id); if (el) { el.style.left = `${node.x}px`; el.style.top = `${node.y}px`; if (node.w) el.style.width = `${node.w}px`; else el.style.width = `${NODE_TYPES[node.type].width}px`; el.classList.toggle('sized', !!node.w); }
    n++;
  }
  save(); renderEdges(); bus.emit('groups:render');
  return n;
}
export function undo() { const e = undos.pop(); if (!e) return false; redos.push(e); return (e.type === 'edges' ? applyEdges(e, 'undo') : apply(e.entries, 'from')) > 0; }
export function redo() { const e = redos.pop(); if (!e) return false; undos.push(e); return (e.type === 'edges' ? applyEdges(e, 'redo') : apply(e.entries, 'to')) > 0; }
export const canUndo = () => undos.length > 0;
