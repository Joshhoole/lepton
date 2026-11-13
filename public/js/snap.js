// Lining nodes up while they are dragged.
//   Guides  A dragged node (or a dragged selection, taken as one box) that comes within a few pixels of lining up
//           with another node is pulled the rest of the way: left, right, top and bottom edges against edges, and
//           middles against middles. A thin line shows what it lined up with. Only nodes on screen are considered.
//   Grid    With "Snap to grid" on (the magnet beside the zoom buttons, or ⇧G), a dragged node lands on the board's
//           24px grid instead: the same grid the dots are drawn on at 100%. Lines still show when it happens to
//           line up with something.
// Holding ⇧ during a drag switches both off for as long as it is held.
import { state, bus } from './state.js';
import { collapsedGroupOf } from './groups.js';

export const GRID = 24;
const PULL = 6; // how close, in pixels on screen, before a node is pulled into line
const KEY = 'lepton.snapToGrid';

let gridOn = false;
try { gridOn = localStorage.getItem(KEY) === '1'; } catch { /* private window: the setting lasts for this visit */ }
export const snapToGrid = () => gridOn;
export function setSnapToGrid(on) {
  gridOn = !!on;
  try { localStorage.setItem(KEY, gridOn ? '1' : '0'); } catch { /* as above */ }
  bus.emit('snap:grid', gridOn);
}
export const toGrid = (v) => Math.round(v / GRID) * GRID;

// ---------- the lines ----------
const layer = document.getElementById('snap-guides');
const lines = []; let shown = 0;
function line(i) {
  while (lines.length <= i) { const el = document.createElement('div'); el.className = 'snap-line'; el.hidden = true; layer.appendChild(el); lines.push(el); }
  return lines[i];
}
// Board coordinates in, a 1px line on screen out. Moved with a transform, so drawing one costs no layout.
function draw(i, x0, y0, x1, y1) {
  const { x, y, z } = state.view; const el = line(i);
  const sx = Math.round(x + x0 * z), sy = Math.round(y + y0 * z);
  el.style.transform = `translate(${sx}px, ${sy}px) scale(${Math.max(1, Math.round((x1 - x0) * z))}, ${Math.max(1, Math.round((y1 - y0) * z))})`;
  el.hidden = false;
}
function clear(from = 0) { for (let i = from; i < shown; i++) lines[i].hidden = true; shown = Math.min(shown, from); }

// ---------- one drag ----------
let drag = null;

// `sizeOf(id)` gives a node's width and height on the board. Everything is measured here, once, before anything moves.
export function beginSnap(ids, sizeOf, anchorId) {
  drag = null;
  const moving = new Set(ids);
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const id of ids) {
    const n = state.nodes[id]; if (!n) continue; const s = sizeOf(id); if (!s || !s.w) continue;
    l = Math.min(l, n.x); t = Math.min(t, n.y); r = Math.max(r, n.x + s.w); b = Math.max(b, n.y + s.h);
  }
  if (!Number.isFinite(l)) return;
  const others = [];
  for (const n of Object.values(state.nodes)) {
    if (moving.has(n.id) || collapsedGroupOf(n.id)) continue;
    const s = sizeOf(n.id); if (!s || !s.w) continue;
    others.push({ l: n.x, t: n.y, r: n.x + s.w, b: n.y + s.h });
  }
  const a = state.nodes[anchorId];
  drag = { l, t, w: r - l, h: b - t, others, ax: a ? a.x : l, ay: a ? a.y : t, vw: layer.clientWidth || window.innerWidth, vh: layer.clientHeight || window.innerHeight };
}

// How far to shift so that an edge or the middle of the moving box meets the nearest matching line, if one is in reach.
// When two lines are equally close, the one belonging to the nearer node wins.
function pull(pos, size, near, lo, hi, reach, crossPos, crossSize, crossLo, crossHi) {
  let best = 0, gap = reach, dist = Infinity;
  const tryLine = (d, o) => {
    const ad = Math.abs(d); if (ad > gap + 1e-6) return;
    const apart = Math.max(0, o[crossLo] - (crossPos + crossSize), crossPos - o[crossHi]);
    if (ad < gap - 1e-6 || apart < dist) { best = d; gap = ad; dist = apart; }
  };
  for (const o of near) {
    tryLine(o[lo] - pos, o); tryLine(o[hi] - pos, o);
    tryLine(o[lo] - (pos + size), o); tryLine(o[hi] - (pos + size), o);
    tryLine((o[lo] + o[hi]) / 2 - (pos + size / 2), o);
  }
  return best;
}

// The drag wants to move by (dx, dy) on the board. Returns where it should actually go, and draws the lines.
export function snapMove(dx, dy, free) {
  if (!drag) return { dx, dy };
  if (free) { clear(); return { dx, dy }; }
  const { x, y, z } = state.view;
  const x0 = -x / z, y0 = -y / z, x1 = x0 + drag.vw / z, y1 = y0 + drag.vh / z;
  const near = drag.others.filter((o) => o.r > x0 && o.l < x1 && o.b > y0 && o.t < y1);
  if (gridOn) {
    dx = toGrid(drag.ax + dx) - drag.ax; dy = toGrid(drag.ay + dy) - drag.ay;
  } else {
    const reach = PULL / z;
    dx = Math.round(dx + pull(drag.l + dx, drag.w, near, 'l', 'r', reach, drag.t + dy, drag.h, 't', 'b'));
    dy = Math.round(dy + pull(drag.t + dy, drag.h, near, 't', 'b', reach, drag.l + dx, drag.w, 'l', 'r'));
  }
  // Lines for everything the box now lines up with. Half a pixel of slack: a middle can fall between two pixels.
  // A middle line is left out when both edges already show one: a node the same size lines up on all three.
  const L = drag.l + dx, T = drag.t + dy, R = L + drag.w, B = T + drag.h; let k = 0;
  const same = (a, b) => Math.abs(a - b) < 0.6;
  const hits = (v, mid, lo, hi) => near.filter((o) => (mid ? same((o[lo] + o[hi]) / 2, v) : same(o[lo], v) || same(o[hi], v)));
  const xs = [[L, false], [R, false], [(L + R) / 2, true]].map(([v, mid]) => ({ v, mid, hit: hits(v, mid, 'l', 'r') }));
  for (const { v, mid, hit } of xs) {
    if (!hit.length || (mid && xs[0].hit.length && xs[1].hit.length)) continue;
    draw(k++, v, Math.min(T, ...hit.map((o) => o.t)), v, Math.max(B, ...hit.map((o) => o.b)));
  }
  const ys = [[T, false], [B, false], [(T + B) / 2, true]].map(([v, mid]) => ({ v, mid, hit: hits(v, mid, 't', 'b') }));
  for (const { v, mid, hit } of ys) {
    if (!hit.length || (mid && ys[0].hit.length && ys[1].hit.length)) continue;
    draw(k++, Math.min(L, ...hit.map((o) => o.l)), v, Math.max(R, ...hit.map((o) => o.r)), v);
  }
  clear(k); shown = k;
  return { dx, dy };
}

export function endSnap() { clear(); drag = null; }
