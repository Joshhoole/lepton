// Canvas tools, chosen from the left end of the dock.
//   Select    the normal mode: move, select, connect
//   Scissors  drag across strands to cut every one the line crosses; click a single strand to cut just that one
//   Pen       draw on the canvas itself; the same tool carries an eraser
// A tool stays on until another is picked or Esc is pressed. Space or ⌥ still pans in every tool.
import { state, bus, save, removeEdge, uid } from './state.js';
import { screenToWorld, setCanvasTool, renderEdges, isTyping } from './canvas.js';
import { ask } from './dialog.js';

const $ = (s) => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const vp = $('#viewport'), ink = $('#ink-layer'), live = $('#ink-live'), cutLine = $('#cut-line'), opts = $('#tool-options');
const toast = (msg, kind) => bus.emit('toast', { msg, kind });
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

export const INK_COLORS = ['#ececee', '#ffd60a', '#ff453a', '#32d74b', '#0a84ff', '#bf5af2'];
const INK_SIZES = [['s', 3], ['m', 6], ['l', 12]];
let tool = 'select';
const pen = { color: INK_COLORS[0], size: 'm', erase: false };
try { Object.assign(pen, JSON.parse(localStorage.getItem('lepton.pen') || '{}'), { erase: false }); } catch { /* defaults */ }
const rememberPen = () => { try { localStorage.setItem('lepton.pen', JSON.stringify({ color: pen.color, size: pen.size })); } catch { /* not remembered */ } };

// ---------- drawings ----------
// A stroke as a smooth path: the curve runs between the samples rather than through every wobble.
function pathOf(points) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]} l 0.01 0`;
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) { const p = points[i], q = points[i + 1]; d += ` Q ${p[0]} ${p[1]} ${(p[0] + q[0]) / 2} ${(p[1] + q[1]) / 2}`; }
  const last = points[points.length - 1]; return `${d} L ${last[0]} ${last[1]}`;
}
function strokeEl(s) {
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', pathOf(s.points)); p.setAttribute('stroke', s.color); p.setAttribute('stroke-width', s.width); p.dataset.id = s.id;
  return p;
}
export function renderInk() { ink.replaceChildren(...(state.strokes || []).map(strokeEl)); }
bus.on('strokes', renderInk);
bus.on('board:mounted', renderInk);

// Drop samples that add nothing: a point stays only if it bends the line by more than `eps`.
function simplify(points, eps) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let worst = 0, at = -1;
    const [ax, ay] = points[a], [bx, by] = points[b]; const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * (points[i][0] - ax) - dx * (points[i][1] - ay)) / len; if (d > worst) { worst = d; at = i; } }
    if (worst > eps) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
const distToSeg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0; return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)); };
const crosses = (a, b, c, d) => { // do segments a-b and c-d intersect?
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
};

// ---------- the pointer, per tool ----------
let drag = null;
const at = (ev) => { const w = screenToWorld(ev.clientX, ev.clientY); return [Math.round(w.x * 10) / 10, Math.round(w.y * 10) / 10]; };

function start(ev) {
  if (tool === 'select') return false;
  try { vp.setPointerCapture(ev.pointerId); } catch { /* the drag still works while the pointer stays over the canvas */ }
  ev.preventDefault();
  const p = at(ev);
  if (tool === 'cut') {
    // Each strand as a short polyline, measured once per cut.
    const strands = [];
    for (const g of document.querySelectorAll('#edge-layer g[data-edge]')) {
      if (g.style.display === 'none') continue;
      const path = g.children[1]; const len = path.getTotalLength(); if (!len) continue;
      const n = Math.max(8, Math.min(160, Math.round(len / 14))); const pts = [];
      for (let i = 0; i <= n; i++) { const q = path.getPointAtLength((len * i) / n); pts.push([q.x, q.y]); }
      strands.push({ id: g.dataset.edge, pts, vis: path });
    }
    drag = { kind: 'cut', pts: [p], strands, hit: new Map() };
    cutLine.setAttribute('d', ''); cutLine.style.strokeWidth = `${1.6 / state.view.z}px`; cutLine.style.strokeDasharray = `${5 / state.view.z} ${5 / state.view.z}`;
  } else if (pen.erase) {
    drag = { kind: 'erase', last: p, removed: [] };
    eraseAt(p, p);
  } else {
    const width = (INK_SIZES.find((s) => s[0] === pen.size) || INK_SIZES[1])[1];
    drag = { kind: 'pen', stroke: { id: uid(), color: pen.color, width, points: [p] } };
    live.setAttribute('stroke', pen.color); live.setAttribute('stroke-width', width); live.setAttribute('d', pathOf([p]));
  }
  return true;
}
function eraseAt(a, b) {
  const reach = 9 / state.view.z;
  for (const s of [...state.strokes]) {
    const r = reach + s.width / 2; const pts = s.points;
    const near = pts.length === 1 ? distToSeg(pts[0], a, b) <= r : pts.some((p, i) => i > 0 && (distToSeg(a, pts[i - 1], p) <= r || distToSeg(b, pts[i - 1], p) <= r || crosses(a, b, pts[i - 1], p)));
    if (!near) continue;
    state.strokes = state.strokes.filter((x) => x !== s); drag.removed.push(s);
    ink.querySelector(`path[data-id="${s.id}"]`)?.remove();
  }
}
vp.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const p = at(ev);
  if (drag.kind === 'pen') {
    const pts = drag.stroke.points, last = pts[pts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 2 / state.view.z) return;
    pts.push(p); live.setAttribute('d', pathOf(pts));
  } else if (drag.kind === 'erase') { eraseAt(drag.last, p); drag.last = p; }
  else {
    const a = drag.pts[drag.pts.length - 1]; if (Math.hypot(p[0] - a[0], p[1] - a[1]) < 3 / state.view.z) return;
    drag.pts.push(p); cutLine.setAttribute('d', `M ${drag.pts.map((q) => q.join(' ')).join(' L ')}`);
    for (const s of drag.strands) {
      if (drag.hit.has(s.id)) continue;
      for (let i = 1; i < s.pts.length; i++) if (crosses(a, p, s.pts[i - 1], s.pts[i])) { drag.hit.set(s.id, s); s.vis.classList.add('cutting'); break; }
    }
  }
});
function end(ev) {
  if (!drag) return;
  const d = drag; drag = null;
  try { vp.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
  if (d.kind === 'pen') {
    live.setAttribute('d', '');
    const s = d.stroke; s.points = simplify(s.points, 0.6 / state.view.z);
    state.strokes.push(s); ink.appendChild(strokeEl(s)); save(); renderOptions();
  } else if (d.kind === 'erase') {
    if (d.removed.length) { save(); renderOptions(); }
  } else {
    cutLine.setAttribute('d', '');
    // A click rather than a slash: cut the strand under the pointer, if there is one.
    if (d.pts.length < 2) {
      const p = d.pts[0]; const reach = 8 / state.view.z; let best = null, bestD = reach;
      for (const s of d.strands) for (let i = 1; i < s.pts.length; i++) { const dist = distToSeg(p, s.pts[i - 1], s.pts[i]); if (dist < bestD) { bestD = dist; best = s; } }
      if (best) d.hit.set(best.id, best);
    }
    for (const s of d.hit.values()) s.vis.classList.remove('cutting');
    const ids = [...d.hit.keys()].filter((id) => state.edges[id]);
    if (!ids.length) return;
    for (const id of ids) removeEdge(id, false); // one tick, so undo brings them all back in one step
    save(); renderEdges();
    toast(`Cut ${ids.length} strand${ids.length === 1 ? '' : 's'}. ⌘Z brings ${ids.length === 1 ? 'it' : 'them'} back.`, 'ok');
  }
}
vp.addEventListener('pointerup', end);
vp.addEventListener('pointercancel', end);
setCanvasTool(start);

// ---------- choosing a tool ----------
export function setTool(next) {
  if (!['select', 'cut', 'pen'].includes(next)) next = 'select';
  tool = next; pen.erase = false;
  vp.classList.toggle('tool-cut', tool === 'cut'); vp.classList.toggle('tool-pen', tool === 'pen'); vp.classList.remove('tool-erase');
  document.querySelectorAll('.dock-btn[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
  renderOptions();
}
export const currentTool = () => tool;
function renderOptions() {
  opts.innerHTML = ''; opts.hidden = tool === 'select';
  if (tool === 'select') return;
  if (tool === 'cut') opts.appendChild(el('span', 'tool-hint', 'Drag across strands to cut them, or click one.'));
  else {
    const colors = el('div', 'tool-colors');
    for (const c of INK_COLORS) {
      const b = el('button', `tool-color ${!pen.erase && c === pen.color ? 'on' : ''}`); b.type = 'button'; b.style.background = c; b.title = 'Colour';
      b.addEventListener('click', () => { pen.color = c; pen.erase = false; vp.classList.remove('tool-erase'); rememberPen(); renderOptions(); });
      colors.appendChild(b);
    }
    const sizes = el('div', 'segmented tool-sizes');
    for (const [id, w] of INK_SIZES) {
      const b = el('button', id === pen.size ? 'on' : ''); b.type = 'button'; b.title = id === 's' ? 'Thin' : id === 'm' ? 'Medium' : 'Thick';
      const dot = el('i'); dot.style.width = dot.style.height = `${Math.round(w * 0.9) + 2}px`; b.appendChild(dot);
      b.addEventListener('click', () => { pen.size = id; rememberPen(); renderOptions(); });
      sizes.appendChild(b);
    }
    const eraser = el('button', `btn tool-btn ${pen.erase ? 'on' : ''}`, 'Eraser'); eraser.title = 'Drag over a drawing to remove it';
    eraser.addEventListener('click', () => { pen.erase = !pen.erase; vp.classList.toggle('tool-erase', pen.erase); renderOptions(); });
    const clear = el('button', 'btn tool-btn', 'Clear all'); clear.disabled = !state.strokes.length; clear.title = 'Remove every drawing on this board';
    clear.addEventListener('click', async () => {
      const ok = await ask({ title: 'Remove every drawing?', message: 'All pen strokes on this board are removed. ⌘Z brings them back.', buttons: [{ label: 'Remove', kind: 'danger', value: 'yes' }, { label: 'Cancel', value: 'cancel' }] });
      if (ok !== 'yes') return;
      state.strokes = []; save(); renderInk(); renderOptions();
    });
    opts.append(colors, sizes, eraser, clear);
  }
  const done = el('button', 'btn tool-btn', 'Done'); done.title = 'Back to Select (Esc)'; done.addEventListener('click', () => setTool('select'));
  opts.appendChild(done);
}
bus.on('strokes', () => { if (tool === 'pen') renderOptions(); });

document.querySelectorAll('.dock-btn[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool === tool ? 'select' : b.dataset.tool)));
bus.on('tool', setTool);
// Esc puts the tool away, unless something is open on top of the canvas (that closes first).
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || tool === 'select' || isTyping(e.target)) return;
  if (['#dialog', '#markup', '#editor', '#lightbox', '#guide', '#storage', '#settings', '#quickadd'].some((s) => { const x = $(s); return x && !x.hidden; })) return;
  e.stopImmediatePropagation(); e.preventDefault(); setTool('select');
}, true);
setTool('select');
