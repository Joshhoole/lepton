// Crop an image. Opens on any still picture on the board: an upload, or a result of an Image node.
// Drag the corners or edges of the frame, drag inside it to move it, or drag on the picture outside it to draw a
// new one. The shape can be held to an aspect ratio, and the picture can be turned a quarter or flipped first.
//
// Nothing is ever cut from the original file. "Add to board" saves the crop as a new Media node beside the source.
// "Replace" (uploads only) swaps the Media node's picture for the crop, so its strands keep working, and remembers
// the original so "Restore original image" in the node's menu can bring it back. The crop is made from the
// full-size file at its own resolution, not from the small copy the board shows.
import { state, bus, addNode, select, save } from './state.js';
import { nodeEl } from './canvas.js';
import { api } from './api.js';
import { refreshMedia } from './nodes.js';

const $ = (s) => document.querySelector(s);
const toast = (msg, kind) => bus.emit('toast', { msg, kind });
const root = $('#crop'), frame = $('#crop-frame'), canvas = $('#crop-canvas'), box = $('#crop-box'), shade = $('#crop-shade');
const ctx = canvas.getContext('2d');
const MAX_SIDE = 8192, MIN = 8; // the largest picture kept at full size, and the smallest crop, in the picture's own pixels
const RATIOS = [['free', 'Free'], ['orig', 'Original'], ['1:1', 'Square 1:1'], ['4:3', '4:3'], ['3:2', '3:2'], ['16:9', '16:9'], ['21:9', '21:9'], ['3:4', '3:4 tall'], ['2:3', '2:3 tall'], ['9:16', '9:16 tall']];

let job = null; // { img, name, sourceId, canReplace, alpha, turns, flip, W, H, rect, ratio, ratioKey }

// ---------- the picture, turned and flipped ----------
function paint() {
  const { img, turns, flip } = job;
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
  const side = turns % 2 === 1;
  canvas.width = side ? h : w; canvas.height = side ? w : h;
  job.W = canvas.width; job.H = canvas.height;
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((turns * Math.PI) / 2);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
  layout();
}
// The picture is shown as large as the window allows (a small one up to three times its size, so it can be worked on).
function layout() {
  if (!job) return;
  const stage = $('#crop-stage'); const cs = getComputedStyle(stage);
  const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const k = Math.min(availW / job.W, availH / job.H, 3);
  frame.style.width = `${Math.max(1, Math.floor(job.W * k))}px`; frame.style.height = `${Math.max(1, Math.floor(job.H * k))}px`;
}
window.addEventListener('resize', layout);
const full = () => ({ x: 0, y: 0, w: job.W, h: job.H });
const ratioOf = (key) => (key === 'free' ? null : key === 'orig' ? job.W / job.H : (() => { const [a, b] = key.split(':').map(Number); return a / b; })());
const changed = () => !!job && (job.turns !== 0 || job.flip || Math.round(job.rect.w) < job.W || Math.round(job.rect.h) < job.H);

// ---------- the frame ----------
function show() {
  const { rect, W, H } = job;
  for (const el of [box, shade]) { // the shade is the same rectangle, clipped to the picture; the box's handles are not clipped
    el.style.left = `${(rect.x / W) * 100}%`; el.style.top = `${(rect.y / H) * 100}%`;
    el.style.width = `${(rect.w / W) * 100}%`; el.style.height = `${(rect.h / H) * 100}%`;
  }
  const w = Math.round(rect.w), h = Math.round(rect.h);
  const size = $('#crop-size'); size.textContent = `${w} × ${h} px`;
  if (w !== W || h !== H) { const of = document.createElement('span'); of.className = 'crop-of'; of.textContent = `  ·  of ${W} × ${H}`; size.appendChild(of); }
  $('#crop-save').disabled = !changed(); $('#crop-replace').disabled = !changed(); $('#crop-reset').disabled = !changed();
}
// The largest frame of the chosen shape that fits inside the current one, on the same centre.
function applyRatio() {
  const r = job.ratio; if (!r) return;
  const c = job.rect; const w = Math.min(c.w, c.h * r), h = w / r;
  job.rect = { x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, w, h };
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const at = (e) => { const r = frame.getBoundingClientRect(); return { x: clamp(((e.clientX - r.left) / r.width) * job.W, 0, job.W), y: clamp(((e.clientY - r.top) / r.height) * job.H, 0, job.H) }; };

// A frame stretched from a fixed corner (ax, ay) to the pointer, kept inside the picture and to the chosen shape.
function fromCorner(ax, ay, p) {
  const sx = p.x >= ax ? 1 : -1, sy = p.y >= ay ? 1 : -1;
  let w = Math.abs(p.x - ax), h = Math.abs(p.y - ay);
  const maxW = sx > 0 ? job.W - ax : ax, maxH = sy > 0 ? job.H - ay : ay;
  if (job.ratio) {
    if (w / Math.max(h, 0.001) > job.ratio) h = w / job.ratio; else w = h * job.ratio;
    if (w > maxW) { w = maxW; h = w / job.ratio; }
    if (h > maxH) { h = maxH; w = h * job.ratio; }
  }
  w = clamp(w, Math.min(MIN, maxW), maxW); h = clamp(h, Math.min(MIN, maxH), maxH);
  return { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h };
}
// One edge dragged: that side moves; with a shape chosen the other dimension follows, about the frame's middle.
function fromEdge(start, side, p) {
  let { x, y, w, h } = start; const r = job.ratio;
  if (side === 'e' || side === 'w') {
    const ax = side === 'e' ? x : x + w; const max = side === 'e' ? job.W - ax : ax;
    let nw = clamp(side === 'e' ? p.x - ax : ax - p.x, MIN, max);
    if (r) { const cy = y + h / 2; const maxH = 2 * Math.min(cy, job.H - cy); let nh = nw / r; if (nh > maxH) { nh = maxH; nw = nh * r; } y = cy - nh / 2; h = nh; }
    return { x: side === 'e' ? ax : ax - nw, y, w: nw, h };
  }
  const ay = side === 's' ? y : y + h; const max = side === 's' ? job.H - ay : ay;
  let nh = clamp(side === 's' ? p.y - ay : ay - p.y, MIN, max);
  if (r) { const cx = x + w / 2; const maxW = 2 * Math.min(cx, job.W - cx); let nw = nh * r; if (nw > maxW) { nw = maxW; nh = nw / r; } x = cx - nw / 2; w = nw; }
  return { x, y: side === 's' ? ay : ay - nh, w, h: nh };
}

let drag = null;
frame.addEventListener('pointerdown', (e) => {
  if (!job || e.button !== 0) return;
  e.preventDefault(); frame.setPointerCapture(e.pointerId);
  const p = at(e); const r = job.rect; const handle = e.target.closest('.crop-handle');
  if (handle) {
    const h = handle.dataset.h;
    if (h.length === 2) drag = { kind: 'corner', ax: h.includes('w') ? r.x + r.w : r.x, ay: h.includes('n') ? r.y + r.h : r.y };
    else drag = { kind: 'edge', side: h, start: { ...r } };
  } else if (e.target.closest('#crop-box')) drag = { kind: 'move', dx: p.x - r.x, dy: p.y - r.y };
  else drag = { kind: 'corner', ax: p.x, ay: p.y, fresh: true, was: { ...r } }; // a new frame, drawn from here
  root.classList.add('dragging');
});
frame.addEventListener('pointermove', (e) => {
  if (!drag || !job) return;
  const p = at(e);
  if (drag.kind === 'move') job.rect = { ...job.rect, x: clamp(p.x - drag.dx, 0, job.W - job.rect.w), y: clamp(p.y - drag.dy, 0, job.H - job.rect.h) };
  else if (drag.kind === 'edge') job.rect = fromEdge(drag.start, drag.side, p);
  else { if (drag.fresh && Math.hypot(p.x - drag.ax, p.y - drag.ay) < MIN) return; drag.fresh = false; job.rect = fromCorner(drag.ax, drag.ay, p); }
  show();
});
const endDrag = () => { drag = null; root.classList.remove('dragging'); };
frame.addEventListener('pointerup', endDrag);
frame.addEventListener('pointercancel', endDrag);

// ---------- open, save, close ----------
const readable = (url) => (/^https?:\/\//.test(url) ? `/api/fetch?url=${encodeURIComponent(url)}` : url);
export async function openCrop({ url, name = '', sourceId = null }) {
  if (!url) return;
  const img = new Image();
  try { await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('That image could not be opened for cropping.')); img.src = readable(url); }); }
  catch (e) { toast(e.message, 'err'); return; }
  const src = sourceId && state.nodes[sourceId];
  job = { img, name, sourceId, url, canReplace: !!src && src.type === 'media', alpha: /\.(png|webp|gif|avif)(\?|#|$)/i.test(`${url} ${name}`), turns: 0, flip: false, ratio: null, ratioKey: 'free' };
  $('#crop-ratio').value = 'free';
  $('#crop-replace').hidden = !job.canReplace;
  root.hidden = false; // shown first: the picture is fitted to the room the window gives it
  paint(); job.rect = full(); show();
}
function close() { root.hidden = true; job = null; drag = null; canvas.width = canvas.height = 1; }

async function cut() {
  const r = job.rect; const w = Math.max(1, Math.round(r.w)), h = Math.max(1, Math.round(r.h));
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  out.getContext('2d').drawImage(canvas, Math.round(r.x), Math.round(r.y), w, h, 0, 0, w, h);
  // A picture that may have see-through parts keeps them; anything else is saved the compact way.
  const type = job.alpha ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((ok) => out.toBlob(ok, type, 0.95));
  if (!blob) throw new Error('The cropped image could not be saved.');
  const base = String(job.name || 'image').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/-cropped$/i, '').replace(/[^\w.\- ]+/g, '_').slice(0, 60) || 'image';
  const file = `${base}-cropped.${job.alpha ? 'png' : 'jpg'}`;
  const up = await api.upload(new File([blob], file, { type }));
  return { url: up.url, name: file, w, h };
}
async function finish(replace) {
  if (!job || !changed()) return;
  const btn = replace ? $('#crop-replace') : $('#crop-save'); const label = btn.textContent;
  $('#crop-save').disabled = true; $('#crop-replace').disabled = true; btn.textContent = 'Saving…';
  try {
    const made = await cut();
    const src = job.sourceId && state.nodes[job.sourceId];
    if (replace && src && src.type === 'media') {
      const d = src.data;
      // The first replacement remembers the picture as it was, so it can be brought back.
      bus.emit('history:user'); // the upload took a moment; this is still the user's change
      if (!d.original) d.original = { url: d.url, name: d.name, w: d.w || 0, h: d.h || 0 };
      Object.assign(d, { url: made.url, name: made.name, w: made.w, h: made.h, kind: 'image' }); delete d.lost;
      save(); refreshMedia(src.id); bus.emit('results', src.id);
      close(); toast('Cropped. "Restore original image" in the node\'s menu brings the full picture back.', 'ok');
    } else {
      const srcEl = src && nodeEl(src.id);
      const at2 = src ? { x: src.x + (srcEl ? srcEl.offsetWidth : 300) + 40, y: src.y } : { x: (innerWidth / 2 - state.view.x) / state.view.z - 130, y: (innerHeight / 2 - state.view.y) / state.view.z - 100 };
      const n = addNode('media', at2.x, at2.y, { url: made.url, kind: 'image', name: made.name, w: made.w, h: made.h, caption: 'Cropped' });
      select([n.id]); document.getElementById('empty').hidden = true;
      close(); toast('Added the cropped image to the board.', 'ok');
    }
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.textContent = label; if (job) show(); }
}
// Bring back the picture a Media node had before it was cropped in place.
export function restoreOriginal(id) {
  const n = state.nodes[id]; const o = n && n.type === 'media' && n.data.original; if (!o) return;
  Object.assign(n.data, { url: o.url, name: o.name, w: o.w, h: o.h }); delete n.data.original;
  save(); refreshMedia(id); bus.emit('results', id);
  toast('The original image is back.', 'ok');
}

// ---------- the bar ----------
const sel = $('#crop-ratio');
for (const [key, label] of RATIOS) { const o = document.createElement('option'); o.value = key; o.textContent = label; sel.appendChild(o); }
sel.addEventListener('change', () => { if (!job) return; job.ratioKey = sel.value; job.ratio = ratioOf(sel.value); applyRatio(); show(); });
const reframe = () => { paint(); job.ratio = ratioOf(job.ratioKey); job.rect = full(); applyRatio(); show(); };
$('#crop-left').addEventListener('click', () => { if (job) { job.turns = (job.turns + 3) % 4; reframe(); } });
$('#crop-right').addEventListener('click', () => { if (job) { job.turns = (job.turns + 1) % 4; reframe(); } });
$('#crop-flip').addEventListener('click', () => { if (job) { job.flip = !job.flip; reframe(); } });
$('#crop-reset').addEventListener('click', () => { if (!job) return; job.turns = 0; job.flip = false; job.ratioKey = 'free'; job.ratio = null; sel.value = 'free'; paint(); job.rect = full(); show(); });
$('#crop-cancel').addEventListener('click', close);
$('#crop-save').addEventListener('click', () => finish(false));
$('#crop-replace').addEventListener('click', () => finish(true));
// The editor owns the keyboard while it is open. Arrows move the frame a pixel at a time (ten with ⇧).
window.addEventListener('keydown', (e) => {
  if (root.hidden) return;
  e.stopImmediatePropagation();
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  if (e.key === 'Enter') { e.preventDefault(); finish(false); return; }
  if (/^Arrow/.test(e.key) && job && e.target !== sel) {
    e.preventDefault(); const step = e.shiftKey ? 10 : 1; const r = job.rect;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    job.rect = { ...r, x: clamp(r.x + dx, 0, job.W - r.w), y: clamp(r.y + dy, 0, job.H - r.h) }; show();
  }
}, true);
bus.on('crop', (item) => openCrop(item));
