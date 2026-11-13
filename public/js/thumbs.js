// Small copies for the board.
// A picture on the board is shown a few hundred pixels wide, so the board shows a small copy of it and keeps the
// original for generating, enlarging and downloading. A video shows one still frame and is only loaded while the
// pointer is over it. The copies are made here, in the browser, the first time a file is seen, and kept by the
// server in .cache/thumbs (see thumbs.js next to server.js). Until a copy exists the file itself is shown, exactly
// as before, so nothing is ever blank while this catches up.
import { bus } from './state.js';

const W = 720, MAX_H = 1440;   // a small copy is at most this big, in pixels
const SHARPEN_AT = 1.25;       // show the original once the picture is drawn this much bigger than its small copy
const known = new Map();       // url → { w, h, dur } of the original (it has a small copy) | false (it has none yet)
const never = new Set();       // files a small copy makes no sense for (animations, drawings)
const failed = new Map();      // url → { n, at }: a copy that could not be made is tried again later, three times at most
const toast = (msg, kind) => bus.emit('toast', { msg, kind });

export const thumbUrl = (url) => `/api/thumb?src=${encodeURIComponent(url)}`;
const eligible = (url) => typeof url === 'string' && (/^\/(uploads|projects)\//.test(url) || /^https:\/\//.test(url)) && !/\.(gif|svg)(\?|$)/i.test(url) && !never.has(url);
// A file still on a provider's server is read through the local server, so the browser is allowed to copy it.
const readable = (url) => (/^https:\/\//.test(url) ? `/api/fetch?url=${encodeURIComponent(url)}` : url);
const smallWidth = (m) => Math.round(m.w * Math.min(1, W / m.w, MAX_H / m.h));
const worth = (m) => !!m && m.w > smallWidth(m) * 1.15; // an original that is already small is shown as it is

// ---------- asking the server what it already has (many questions, one request) ----------
const asking = new Map(); // url → [resolve]
let askTimer = 0;
export function metaOf(url) {
  if (!eligible(url)) return Promise.resolve(null);
  const k = known.get(url);
  if (k !== undefined && (k || !asking.has(url))) return Promise.resolve(k || null);
  return new Promise((ok) => {
    if (!asking.has(url)) asking.set(url, []);
    asking.get(url).push(ok);
    if (!askTimer) askTimer = setTimeout(flush, 15);
  });
}
async function flush() {
  askTimer = 0;
  const batch = new Map(asking); asking.clear();
  let have = {};
  try { const r = await fetch('/api/thumb/have', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: [...batch.keys()] }) }); have = (await r.json()).have || {}; } catch { /* treated as none */ }
  for (const [url, waiters] of batch) {
    if (have[url]) known.set(url, have[url]); else if (!known.get(url)) known.set(url, false);
    for (const ok of waiters) ok(known.get(url) || null);
  }
}

// ---------- pictures ----------
// An <img> for the board. `attrs` are set as given (loading, class…).
export function picture(url, attrs = {}) {
  const img = document.createElement('img'); img.draggable = false;
  for (const [k, v] of Object.entries(attrs)) img.setAttribute(k, v);
  if (!eligible(url)) { img.src = url; return img; }
  img.dataset.full = url;
  const small = () => { img.dataset.small = '1'; img.src = thumbUrl(url); };
  const full = (queue) => { delete img.dataset.small; img.src = url; if (queue) want(url, 'image'); };
  const choose = (m) => { if (img.dataset.full !== url) return; if (!m) full(true); else if (worth(m)) small(); else full(false); };
  const k = known.get(url);
  if (k !== undefined) choose(k || null); else metaOf(url).then(choose);
  // The copy can vanish (the cache folder was cleared): show the file itself and make the copy again.
  img.addEventListener('error', () => { const u = img.dataset.full; if (!img.dataset.small || !u) return; known.set(u, false); delete img.dataset.small; img.src = u; want(u, 'image'); });
  return img;
}
// The size of the original, whichever of the two the <img> is showing. Calls back once it is known, and again if
// the picture is swapped for another.
export function onSize(img, cb) {
  img.addEventListener('load', () => {
    if (!img.dataset.small) { cb({ w: img.naturalWidth, h: img.naturalHeight }); return; }
    const url = img.dataset.full;
    metaOf(url).then((m) => { if (m && m.w && img.dataset.full === url) cb({ w: m.w, h: m.h }); });
  });
}

// ---------- videos ----------
// A <video> for the board: a still frame, loaded only when it is played. `onInfo` hears the clip's size and length,
// from the still when there is one and from the file when it is played.
export function clip(url, attrs = {}, onInfo = null) {
  const v = document.createElement('video'); v.muted = true; v.loop = true; v.playsInline = true;
  for (const [k, val] of Object.entries(attrs)) v.setAttribute(k, val);
  if (onInfo) v.addEventListener('loadedmetadata', () => onInfo({ w: v.videoWidth, h: v.videoHeight, dur: v.duration }));
  if (!eligible(url)) { v.preload = 'metadata'; v.src = url; return v; }
  v.dataset.clip = url; v.preload = 'none';
  const arm = (m) => {
    if (v.dataset.clip !== url) return;
    if (m) { v.poster = thumbUrl(url); v.src = url; if (onInfo && m.w) Promise.resolve().then(() => onInfo(m)); } // never in the middle of the caller building its node
    else { v.preload = 'metadata'; v.src = url; want(url, 'video'); }
  };
  const k = known.get(url);
  if (k !== undefined) arm(k || null); else metaOf(url).then(arm);
  return v;
}
// Play while the pointer is over `target`; a little after it leaves, go back to the still and let go of the file.
export function hoverPlay(target, v) {
  let timer = 0;
  target.addEventListener('pointerenter', () => { clearTimeout(timer); v.play().catch(() => {}); });
  target.addEventListener('pointerleave', () => {
    v.pause(); clearTimeout(timer);
    timer = setTimeout(() => { if (v.isConnected && v.paused && v.poster) rest(v); }, 4000);
  });
}
// Back to the still, with the file let go of. Taking the address away and putting it back is what makes the browser
// drop what it had loaded; with nothing preloaded, it is fetched again only when the clip is next played.
function rest(v) { const url = v.dataset.clip; if (!url) return; v.removeAttribute('src'); v.load(); v.preload = 'none'; v.src = url; }

// ---------- making the copies ----------
const queue = []; const queued = new Set();
let active = 0, announced = false, announceTimer = 0;
function want(url, kind) {
  if (queued.has(url) || !eligible(url) || known.get(url)) return;
  const f = failed.get(url); if (f && (f.n >= 3 || Date.now() - f.at < 20000)) return;
  queued.add(url); queue.push({ url, kind });
  if (!announced && !announceTimer) announceTimer = setTimeout(() => {
    announceTimer = 0; const n = queue.length + active;
    if (n >= 12) { announced = true; toast(`Making small copies of ${n} pictures and clips so this board stays fast. This happens once.`); }
  }, 1200);
  pump();
}
const idle = () => new Promise((ok) => (window.requestIdleCallback ? requestIdleCallback(() => ok(), { timeout: 400 }) : setTimeout(ok, 30)));
function pump() {
  while (active < 2 && queue.length) {
    const job = queue.shift(); active++;
    idle().then(() => make(job)).catch((e) => { failed.set(job.url, { n: (failed.get(job.url)?.n || 0) + 1, at: Date.now() }); console.debug('No small copy yet for', job.url, e); }).finally(() => { active--; queued.delete(job.url); pump(); });
  }
}
async function make({ url, kind }) {
  // Another tab, or an earlier visit, may have made it already.
  known.delete(url); if (await metaOf(url)) { swapIn(url); return; }
  const made = kind === 'video' ? await frameOf(url) : await shrink(url);
  if (!made) { never.add(url); return; }
  const q = `src=${encodeURIComponent(url)}&w=${made.w}&h=${made.h}&ms=${Math.round((made.dur || 0) * 1000)}`;
  const r = await fetch(`/api/thumb?${q}`, { method: 'POST', headers: { 'Content-Type': made.blob.type }, body: made.blob });
  if (!r.ok) throw new Error('not stored');
  known.set(url, { w: made.w, h: made.h, dur: made.dur || 0 });
  swapIn(url);
}
// Draw something onto a small canvas and encode it. WebP keeps transparency; where a browser cannot write WebP the
// copy is a JPEG on the board's own grey.
async function encode(source, sw, sh) {
  const k = Math.min(1, W / sw, MAX_H / sh);
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, c.width, c.height);
  let blob = await new Promise((ok) => c.toBlob(ok, 'image/webp', 0.82));
  if (!blob || blob.type !== 'image/webp') {
    ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#1c1c1e'; ctx.fillRect(0, 0, c.width, c.height);
    blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
  }
  c.width = c.height = 0;
  return blob;
}
async function shrink(url) {
  const res = await fetch(readable(url)); if (!res.ok) throw new Error('unreadable');
  const file = await res.blob();
  if (/svg|gif/.test(file.type) || !/^image\//.test(file.type || 'image/')) return null;
  const bm = await createImageBitmap(file);
  try { const blob = await encode(bm, bm.width, bm.height); return blob ? { blob, w: bm.width, h: bm.height } : null; }
  finally { bm.close && bm.close(); }
}
function frameOf(url) {
  return new Promise((ok, no) => {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
    const end = (fn, x) => { clearTimeout(t); v.removeAttribute('src'); v.load(); fn(x); };
    const t = setTimeout(() => end(no, new Error('slow')), 30000);
    v.addEventListener('error', () => end(no, new Error('unreadable')));
    v.addEventListener('loadeddata', async () => {
      try { if (!v.videoWidth) throw new Error('no picture'); const blob = await encode(v, v.videoWidth, v.videoHeight); end(ok, blob ? { blob, w: v.videoWidth, h: v.videoHeight, dur: isFinite(v.duration) ? v.duration : 0 } : null); }
      catch (e) { end(no, e); }
    }, { once: true });
    v.src = readable(url);
  });
}
// A copy has just been made: whatever on the board is showing that file moves over to it.
function swapIn(url) {
  const small = thumbUrl(url);
  for (const img of document.querySelectorAll('img[data-full]')) {
    if (img.dataset.full !== url) continue;
    if (img.dataset.small) { if (img.getAttribute('src') !== small) img.src = small; } // was showing the copy of a file this one replaced
    else if (worth(known.get(url)) && !drawnBigger(img, url, SHARPEN_AT)) { img.dataset.small = '1'; img.src = small; }
  }
  for (const v of document.querySelectorAll('video[data-clip]')) if (v.dataset.clip === url && !v.poster) { v.poster = thumbUrl(url); if (v.paused) rest(v); }
}

// ---------- sharp when it matters ----------
// Zoom in on a picture, or pull its node large, and the small copy would look soft. Whatever is on screen and drawn
// clearly bigger than its copy shows the original; it goes back to the copy when it no longer needs to.
function drawnBigger(img, url, factor) {
  const m = known.get(url); if (!worth(m)) return true; // nothing to gain from the copy
  const sw = smallWidth(m);
  const r = img.getBoundingClientRect();
  const on = r.width > 0 && r.right > -200 && r.left < innerWidth + 200 && r.bottom > -200 && r.top < innerHeight + 200;
  return on && r.width * (window.devicePixelRatio || 1) > sw * factor;
}
function settle() {
  const up = [], down = [];
  for (const img of document.querySelectorAll('img[data-full]')) {
    const url = img.dataset.full; if (!known.get(url)) continue;
    if (img.dataset.small) { if (drawnBigger(img, url, SHARPEN_AT)) up.push(img); } else if (!drawnBigger(img, url, 1)) down.push(img);
  }
  for (const img of up) { delete img.dataset.small; img.src = img.dataset.full; }
  for (const img of down) { img.dataset.small = '1'; img.src = thumbUrl(img.dataset.full); }
}
let settleTimer = 0;
const later = () => { clearTimeout(settleTimer); settleTimer = setTimeout(settle, 260); };
bus.on('view', later);
bus.on('saved', later);
window.addEventListener('resize', later);

// A file was replaced by another (a PNG stored as a JPEG): whatever shows the old one now belongs to the new one.
// A small copy that is already on screen stays until the new file has its own.
bus.on('media:relinked', (urls) => {
  for (const img of document.querySelectorAll('img[data-full]')) {
    const next = urls[img.dataset.full]; if (!next) continue;
    img.dataset.full = next; failed.delete(next);
    if (img.dataset.small && !(img.complete && img.naturalWidth)) { delete img.dataset.small; img.src = next; }
    want(next, 'image');
  }
  for (const v of document.querySelectorAll('video[data-clip]')) { const next = urls[v.dataset.clip]; if (next) { v.dataset.clip = next; want(next, 'video'); } }
});
