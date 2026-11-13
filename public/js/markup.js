// Draw on an image: circle the jacket, point an arrow at the light. The marked-up picture is saved as a new Media
// node beside the original, ready to connect to a model as a reference that shows what you mean.
import { state, bus, addNode, select } from './state.js';
import { nodeEl } from './canvas.js';
import { api } from './api.js';

const $ = (s) => document.querySelector(s);
const toast = (msg, kind) => bus.emit('toast', { msg, kind });
const root = $('#markup'), canvas = $('#markup-canvas'), ctx = canvas.getContext('2d');
const COLORS = ['#ff453a', '#ffd60a', '#32d74b', '#0a84ff', '#ffffff', '#000000'];
const SIZES = [['s', 1], ['m', 2.2], ['l', 4.2]];
const MAX_SIDE = 4096;

let job = null; // { img, name, sourceId, strokes, tool, color, size, base }

function redraw() {
  if (!job) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(job.img, 0, 0, canvas.width, canvas.height);
  for (const s of job.strokes) drawStroke(s);
}
function drawStroke(s) {
  if (!s.points.length) return;
  ctx.save();
  ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // A thin dark edge keeps a mark readable on any picture.
  ctx.shadowColor = s.color === '#000000' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)'; ctx.shadowBlur = s.width * 0.6;
  if (s.tool === 'arrow') {
    const [a, b] = [s.points[0], s.points[s.points.length - 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 2) { ctx.restore(); return; }
    const head = Math.min(len * 0.45, s.width * 5.5), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const bx = b[0] - Math.cos(ang) * head * 0.8, by = b[1] - Math.sin(ang) * head * 0.8;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(bx, by); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(b[0], b[1]);
    ctx.lineTo(b[0] - Math.cos(ang - 0.45) * head, b[1] - Math.sin(ang - 0.45) * head);
    ctx.lineTo(b[0] - Math.cos(ang + 0.45) * head, b[1] - Math.sin(ang + 0.45) * head);
    ctx.closePath(); ctx.fill();
  } else if (s.points.length === 1) {
    ctx.beginPath(); ctx.arc(s.points[0][0], s.points[0][1], s.width / 2, 0, Math.PI * 2); ctx.fill();
  } else {
    // Midpoint smoothing: the line passes between the samples instead of through every jitter.
    ctx.beginPath(); ctx.moveTo(s.points[0][0], s.points[0][1]);
    for (let i = 1; i < s.points.length - 1; i++) { const p = s.points[i], q = s.points[i + 1]; ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
    const last = s.points[s.points.length - 1]; ctx.lineTo(last[0], last[1]); ctx.stroke();
  }
  ctx.restore();
}
const pos = (e) => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height]; };

let drawing = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!job || e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  drawing = { tool: job.tool, color: job.color, width: job.base * (SIZES.find((s) => s[0] === job.size) || SIZES[1])[1], points: [pos(e)] };
  job.strokes.push(drawing); redraw(); syncTools();
});
canvas.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const p = pos(e); const last = drawing.points[drawing.points.length - 1];
  if (drawing.tool === 'arrow') drawing.points = [drawing.points[0], p];
  else if (Math.hypot(p[0] - last[0], p[1] - last[1]) > job.base * 0.5) drawing.points.push(p);
  redraw();
});
const endStroke = () => { drawing = null; };
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);

function syncTools() {
  if (!job) return;
  root.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === job.tool));
  root.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('on', b.dataset.size === job.size));
  root.querySelectorAll('.markup-color').forEach((b) => b.classList.toggle('on', b.dataset.color === job.color));
  $('#markup-undo').disabled = !job.strokes.length; $('#markup-clear').disabled = !job.strokes.length; $('#markup-save').disabled = !job.strokes.length;
}
function undo() { if (job && job.strokes.length) { job.strokes.pop(); redraw(); syncTools(); } }
function close() { root.hidden = true; job = null; drawing = null; ctx.clearRect(0, 0, canvas.width, canvas.height); }

// A picture still on a provider's server is read through the local server, so the canvas can be saved afterwards.
const readable = (url) => (/^https?:\/\//.test(url) ? `/api/fetch?url=${encodeURIComponent(url)}` : url);
export async function openMarkup({ url, name = '', sourceId = null }) {
  if (!url) return;
  const img = new Image();
  try { await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('That image could not be opened for drawing.')); img.src = readable(url); }); }
  catch (e) { toast(e.message, 'err'); return; }
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  canvas.width = Math.round(img.naturalWidth * k); canvas.height = Math.round(img.naturalHeight * k);
  job = { img, name, sourceId, strokes: [], tool: 'pen', color: COLORS[0], size: 'm', base: Math.max(canvas.width, canvas.height) / 380 };
  root.hidden = false; redraw(); syncTools();
}
async function saveMarkup() {
  if (!job || !job.strokes.length) return;
  const btn = $('#markup-save'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.92));
    if (!blob) throw new Error('The marked-up image could not be saved.');
    const base = String(job.name || 'image').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^\w.\- ]+/g, '_').slice(0, 60) || 'image';
    const up = await api.upload(new File([blob], `${base}-marked.jpg`, { type: 'image/jpeg' }));
    // Beside the picture it was drawn on, or in the middle of the view when that node is gone.
    const src = job.sourceId && state.nodes[job.sourceId]; const srcEl = src && nodeEl(src.id);
    const at = src ? { x: src.x + (srcEl ? srcEl.offsetWidth : 300) + 40, y: src.y } : { x: (innerWidth / 2 - state.view.x) / state.view.z - 130, y: (innerHeight / 2 - state.view.y) / state.view.z - 100 };
    const n = addNode('media', at.x, at.y, { url: up.url, kind: 'image', name: `${base}-marked.jpg`, caption: 'Marked up' });
    select([n.id]); document.getElementById('empty').hidden = true;
    close();
    toast('Added the marked-up image to the board. Connect it to a model as a reference.', 'ok');
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.textContent = 'Add to board'; if (job) syncTools(); }
}

// ---------- toolbar ----------
const colors = $('#markup-colors');
for (const c of COLORS) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'markup-color'; b.dataset.color = c; b.style.background = c; b.title = 'Colour';
  b.addEventListener('click', () => { if (job) { job.color = c; syncTools(); } }); colors.appendChild(b);
}
root.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => { if (job) { job.tool = b.dataset.tool; syncTools(); } }));
root.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => { if (job) { job.size = b.dataset.size; syncTools(); } }));
$('#markup-undo').addEventListener('click', undo);
$('#markup-clear').addEventListener('click', () => { if (job) { job.strokes = []; redraw(); syncTools(); } });
$('#markup-cancel').addEventListener('click', close);
$('#markup-save').addEventListener('click', saveMarkup);
// The editor owns the keyboard while it is open: nothing behind it should react.
window.addEventListener('keydown', (e) => {
  if (root.hidden) return;
  e.stopImmediatePropagation();
  if (e.key === 'Escape') { e.preventDefault(); close(); }
  else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveMarkup(); }
}, true);
bus.on('markup', (item) => openMarkup(item));
