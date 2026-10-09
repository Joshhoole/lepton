// Undo for layout changes: moving, nudging and resizing nodes. ⌘Z puts things back where they were, ⇧⌘Z redoes.
// Only positions and sizes are recorded, so undo can never discard a result or a running job.
import { state, bus, save, NODE_TYPES } from './state.js';
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
  undos.push(entries); if (undos.length > LIMIT) undos.shift();
  redos.length = 0;
}
export const snapshot = (ids) => ids.map(snap);

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
export function undo() { const e = undos.pop(); if (!e) return false; redos.push(e); return apply(e, 'from') > 0; }
export function redo() { const e = redos.pop(); if (!e) return false; undos.push(e); return apply(e, 'to') > 0; }
export const canUndo = () => undos.length > 0;
