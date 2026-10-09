// Compare node: two images or videos, A and B, under a slider, side by side, overlaid, or as a difference.
import { state, bus, incoming, outgoing, save, isGen, NODE_TYPES } from './state.js';
import { nodeEl, renderEdges } from './canvas.js';

const MODES = [['slider', 'Slider'], ['side', 'Side by side'], ['overlay', 'Overlay'], ['diff', 'Difference']];
const ICON = {
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h13l-3.5-3.5M17 17H4l3.5 3.5"/></svg>',
  turn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 12h16"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4h3l5 4V6L7 10z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  muted: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4h3l5 4V6L7 10z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></svg>',
};
const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };
const btn = (cls, html, title, fn) => { const b = el('button', cls); b.type = 'button'; b.innerHTML = html; b.title = title; b.addEventListener('click', fn); return b; };
const fmt = (s) => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

// What is connected to a port: an upload, or the selected result of an Image or Video node.
function sourceOf(node, port) {
  const e = incoming(node.id, port)[0]; const src = e && state.nodes[e.from];
  if (!src) return null;
  const title = src.data.title || NODE_TYPES[src.type].title;
  if (src.type === 'media') return { url: src.data.url, kind: src.data.kind || 'image', name: src.data.name || title, src: src.id };
  if (isGen(src)) {
    const res = src.data.results || [];
    const sel = res[src.data.selected]?.status === 'completed' ? res[src.data.selected] : res.find((r) => r.status === 'completed' && r.url);
    return { url: sel ? sel.url : null, kind: src.type, name: title, model: src.data.model, jobId: sel && sel.jobId, src: src.id, waiting: !sel };
  }
  return null;
}

const views = new Map(); // nodeId → { stage, info, bar, opacityRow, turn, labels, key }

export function buildCompare(node, body) {
  const ports = el('div', 'ports cmp-ports');
  const labels = {};
  for (const key of ['a', 'b']) {
    const row = el('div', 'port-row in'); row.dataset.portRow = key;
    const p = el('span', 'port'); p.dataset.port = key; p.dataset.dir = 'in'; p.dataset.type = 'media'; p.title = key.toUpperCase();
    const tag = el('span', 'cmp-letter', key.toUpperCase());
    labels[key] = el('span', 'port-label cmp-name');
    row.append(p, tag, labels[key]);
    ports.appendChild(row);
  }
  const tools = el('div', 'cmp-tools');
  const seg = el('div', 'segmented');
  for (const [id, label] of MODES) {
    const b = el('button', node.data.mode === id ? 'on' : '', label); b.type = 'button'; b.dataset.mode = id;
    b.addEventListener('click', () => { node.data.mode = id; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.mode === id)); save(); sync(node); });
    seg.appendChild(b);
  }
  const turn = btn('cmp-icon', ICON.turn, 'Wipe top to bottom instead of left to right', () => { node.data.vertical = !node.data.vertical; save(); sync(node); });
  const swap = btn('cmp-icon', ICON.swap, 'Swap A and B', () => swapInputs(node));
  tools.append(seg, turn, swap);

  const stage = el('div', 'cmp-stage');
  const opacityRow = el('div', 'row cmp-opacity');
  const range = el('input'); range.type = 'range'; range.min = 0; range.max = 100; range.value = Math.round((node.data.opacity ?? 0.5) * 100);
  const pct = el('span', 'cmp-pct', `${range.value}%`);
  range.addEventListener('input', () => { node.data.opacity = Number(range.value) / 100; pct.textContent = `${range.value}%`; stage.style.setProperty('--mix', node.data.opacity); save(); });
  const lab = el('label', '', 'B opacity');
  opacityRow.append(lab, range, pct);
  const bar = el('div', 'cmp-bar');
  const info = el('div', 'cmp-info');
  body.append(ports, tools, stage, opacityRow, bar, info);

  // Drag anywhere on the picture to move the divider.
  const setSplit = (ev) => {
    const r = stage.getBoundingClientRect();
    const v = node.data.vertical ? (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width;
    node.data.split = Math.max(0, Math.min(1, v));
    stage.style.setProperty('--split', node.data.split);
  };
  stage.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || node.data.mode !== 'slider' || !stage.classList.contains('both')) return;
    try { stage.setPointerCapture(ev.pointerId); } catch { /* pointer already released */ }
    stage.classList.add('dragging'); setSplit(ev);
    const move = (e) => setSplit(e);
    const up = () => { stage.removeEventListener('pointermove', move); stage.classList.remove('dragging'); save(); };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up, { once: true });
    stage.addEventListener('pointercancel', up, { once: true });
  });
  // Full screen: the two pictures one after the other, flipped with the arrow keys.
  stage.addEventListener('dblclick', () => {
    const items = ['a', 'b'].map((k) => sourceOf(node, k)).filter((s) => s && s.url && s.kind !== 'audio');
    if (items.length) bus.emit('lightbox', { items, index: 0, source: node.id });
  });

  views.set(node.id, { stage, info, bar, opacityRow, turn, labels, key: null });
  sync(node);
}

function mediaEl(item, side) {
  let m;
  if (item.kind === 'video') { m = el('video', `cmp-layer ${side}`); m.src = item.url; m.muted = true; m.loop = true; m.playsInline = true; m.preload = 'auto'; }
  else { m = el('img', `cmp-layer ${side}`); m.src = item.url; m.draggable = false; }
  return m;
}

function sync(node) {
  const v = views.get(node.id); if (!v) return;
  const { stage } = v;
  const A = sourceOf(node, 'a'), B = sourceOf(node, 'b');
  for (const [k, s] of [['a', A], ['b', B]]) { v.labels[k].textContent = s ? `${s.name}${s.waiting ? ' · not generated yet' : ''}` : 'Not connected'; v.labels[k].classList.toggle('off', !s); }
  const mode = node.data.mode || 'slider';
  const usable = (s) => s && s.url && s.kind !== 'audio';
  const both = usable(A) && usable(B);
  v.opacityRow.hidden = !(both && mode === 'overlay');
  v.turn.hidden = !(both && mode === 'slider');
  v.turn.classList.toggle('on', !!node.data.vertical);
  stage.style.setProperty('--split', node.data.split ?? 0.5);
  stage.style.setProperty('--mix', node.data.opacity ?? 0.5);
  stage.className = `cmp-stage ${both ? `both ${mode}` : ''} ${node.data.vertical ? 'vertical' : ''}`;

  const key = `${both}|${usable(A) ? A.url : ''}|${usable(B) ? B.url : ''}|${A?.kind}|${B?.kind}`;
  if (key === v.key) { describe(node, v); renderEdges(); return; } // same pictures: only the mode or divider changed
  v.key = key;
  stage.innerHTML = ''; v.bar.innerHTML = ''; v.bar.hidden = true; v.dims = {};
  if (!usable(A) && !usable(B)) {
    const audio = (A && A.kind === 'audio') || (B && B.kind === 'audio');
    stage.appendChild(el('div', 'cmp-empty', audio ? 'Compare works with images and video. Audio clips cannot be compared here.'
      : (A && A.waiting) || (B && B.waiting) ? 'Waiting for the connected node to generate something.'
        : 'Connect two images or two videos to A and B.'));
    describe(node, v); renderEdges(); return;
  }
  const shown = [];
  for (const [side, item] of [['a', A], ['b', B]]) {
    if (!usable(item)) continue;
    const m = mediaEl(item, side);
    const ready = () => {
      const w = m.videoWidth || m.naturalWidth, h = m.videoHeight || m.naturalHeight; if (!w || !h) return;
      v.dims[side] = { w, h, d: item.kind === 'video' ? m.duration : null };
      // The frame takes the shape of A (or of whatever is there).
      if (side === 'a' || !usable(A)) stage.style.setProperty('--ar', `${w / h}`);
      describe(node, v); renderEdges();
    };
    m.addEventListener(item.kind === 'video' ? 'loadedmetadata' : 'load', ready);
    stage.appendChild(m); shown.push({ side, item, m });
  }
  if (both) {
    const line = el('div', 'cmp-divider'); line.appendChild(el('span', 'cmp-knob'));
    stage.appendChild(line);
  }
  for (const s of shown) stage.appendChild(el('span', `cmp-tag ${s.side}`, s.side.toUpperCase()));
  if (!both) stage.appendChild(el('div', 'cmp-hint', `Connect ${usable(A) ? 'B' : 'A'} to compare`));
  const vids = shown.filter((s) => s.item.kind === 'video').map((s) => s.m);
  if (vids.length) transport(v, vids);
  describe(node, v); renderEdges();
}

// One set of controls drives both videos, so they stay on the same frame.
function transport(v, vids) {
  const lead = vids[0];
  v.bar.hidden = false;
  const play = btn('cmp-icon', ICON.play, 'Play / pause', () => { if (lead.paused) vids.forEach((x) => x.play().catch(() => {})); else vids.forEach((x) => x.pause()); });
  const scrub = el('input'); scrub.type = 'range'; scrub.min = 0; scrub.max = 1000; scrub.value = 0;
  const time = el('span', 'cmp-time', '0:00');
  const mute = btn('cmp-icon', ICON.muted, 'Sound (plays A)', () => { lead.muted = !lead.muted; mute.innerHTML = lead.muted ? ICON.muted : ICON.sound; });
  const follow = (t) => vids.slice(1).forEach((x) => { const to = Math.min(t, (x.duration || t) - 0.04); if (Math.abs(x.currentTime - to) > 0.12) x.currentTime = Math.max(0, to); });
  let scrubbing = false;
  scrub.addEventListener('input', () => { scrubbing = true; const t = (Number(scrub.value) / 1000) * (lead.duration || 0); lead.currentTime = t; follow(t); time.textContent = `${fmt(t)} / ${fmt(lead.duration)}`; });
  scrub.addEventListener('change', () => { scrubbing = false; });
  lead.addEventListener('timeupdate', () => { if (!scrubbing && lead.duration) scrub.value = Math.round((lead.currentTime / lead.duration) * 1000); time.textContent = `${fmt(lead.currentTime)} / ${fmt(lead.duration)}`; follow(lead.currentTime); });
  lead.addEventListener('loadedmetadata', () => { time.textContent = `${fmt(0)} / ${fmt(lead.duration)}`; });
  lead.addEventListener('play', () => { play.innerHTML = ICON.pause; });
  lead.addEventListener('pause', () => { play.innerHTML = ICON.play; });
  v.bar.append(play, scrub, time, mute);
}

function describe(node, v) {
  const parts = [];
  for (const side of ['a', 'b']) { const d = v.dims && v.dims[side]; if (d) parts.push(`${side.toUpperCase()} ${d.w}×${d.h}${d.d ? ` · ${Math.round(d.d * 10) / 10}s` : ''}`); }
  const a = v.dims && v.dims.a, b = v.dims && v.dims.b;
  if (a && b && Math.abs(a.w / a.h - b.w / b.h) > 0.02) parts.push('different shapes');
  if (node.data.mode === 'diff' && a && b) parts.push('black means identical');
  v.info.textContent = parts.join('   ·   ');
  v.info.hidden = !parts.length;
}

function swapInputs(node) {
  const a = incoming(node.id, 'a'), b = incoming(node.id, 'b');
  if (!a.length && !b.length) return;
  for (const e of a) e.toPort = 'b';
  for (const e of b) e.toPort = 'a';
  save(); sync(node); renderEdges();
}

const compareNodesFedBy = (id) => outgoing(id).map((e) => state.nodes[e.to]).filter((n) => n && n.type === 'compare');
bus.on('edge:add', (e) => { const n = state.nodes[e.to]; if (n && n.type === 'compare') sync(n); });
bus.on('edge:remove', (e) => { const n = state.nodes[e.to]; if (n && n.type === 'compare') sync(n); });
bus.on('results', (id) => compareNodesFedBy(id).forEach(sync));
bus.on('status', (id) => compareNodesFedBy(id).forEach(sync));
bus.on('node:remove', (n) => views.delete(n.id));
