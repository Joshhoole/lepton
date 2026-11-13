// Storage sheet: what takes up space and the buttons that give it back. Two quiet jobs live here too: telling the
// server which files the open board uses (so nothing on an unsaved board is ever cleared), and storing freshly
// generated PNGs as JPEG after a save.
import { state, bus, save, boardHash } from './state.js';
import { api } from './api.js';
import { ask } from './dialog.js';
import { exclusive, saveQuietly, adoptBoard, closeArchived, refresh as refreshProjects } from './projects.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const toast = (msg, kind) => bus.emit('toast', { msg, kind });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function fmtBytes(n) {
  if (!n || n < 1024) return '0 MB';
  if (n < 1048576) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1073741824) { const mb = n / 1048576; return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`; }
  const gb = n / 1073741824; return `${gb >= 10 ? gb.toFixed(1) : gb.toFixed(2)} GB`;
}
function fmtWhen(ms) {
  const diff = (Date.now() - ms) / 1000;
  if (diff < 90) return 'just now'; if (diff < 3600) return `${Math.round(diff / 60)} min ago`; if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// =====================================================================
// What this browser's board is using
// =====================================================================
const CLIENT = (() => {
  try { let c = localStorage.getItem('lepton.client'); if (!c) { c = (crypto.randomUUID && crypto.randomUUID()) || `c${Date.now()}${Math.random().toString(36).slice(2)}`; localStorage.setItem('lepton.client', c); } return c; }
  catch { return 'anon'; }
})();
const isRef = (s) => s.length < 4096 && (s.startsWith('/uploads/') || s.startsWith('/projects/') || /^https?:\/\//.test(s));
function eachString(v, fn, key) {
  if (key === 'schema' || key === 'schemaPorts') return v;
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = eachString(v[i], fn); return v; }
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = eachString(v[k], fn, k); return v; }
  return v;
}
function liveRefs() {
  const out = new Set();
  for (const n of Object.values(state.nodes)) eachString(n.data, (s) => { if (isRef(s)) out.add(s); return s; });
  return [...out].sort();
}
let lastReport = null, reportTimer = null;
function report() {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(async () => {
    const refs = liveRefs(); const key = refs.join('\n'); if (key === lastReport) return;
    try { await api.storageInUse(CLIENT, refs); lastReport = key; } catch { /* an older server, or offline: try again on the next change */ }
  }, 3000);
}
bus.on('saved', report);

// =====================================================================
// PNG → JPEG
// =====================================================================
let prefs = { imageFormat: 'jpeg', uploadsDays: 14, trashDays: 30 };
api.storageSettings().then((s) => { prefs = s; }).catch(() => {});

// One PNG re-encoded as JPEG in the page. Resolves null when the picture has see-through pixels and must stay a PNG.
async function toJpeg(url, mayHaveAlpha) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  try {
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
    const ctx = canvas.getContext('2d', { willReadFrequently: !!mayHaveAlpha });
    ctx.drawImage(bmp, 0, 0);
    if (mayHaveAlpha) { const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data; for (let i = 3; i < px.length; i += 4) if (px[i] < 250) return null; }
    if (canvas.convertToBlob) return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  } finally { bmp.close && bmp.close(); }
}
// Swap URLs on the live board after the server swapped them on disk, without re-mounting anything the user is in.
function relinkLive(urls) {
  if (!urls || !Object.keys(urls).length || !state.project) return;
  const clean = boardHash() === state.project.savedHash;
  for (const n of Object.values(state.nodes)) eachString(n.data, (s) => urls[s] || s);
  document.querySelectorAll('img[src], video[src], source[src], video[poster]').forEach((m) => {
    for (const attr of ['src', 'poster']) { const v = m.getAttribute(attr); if (v && urls[v]) m.setAttribute(attr, urls[v]); }
  });
  bus.emit('media:relinked', urls); // pictures showing a small copy keep their file's address elsewhere (thumbs.js)
  if (clean) { state.project.savedHash = boardHash(); state.dirty = false; }
  save(true);
}
const lightening = new Set();
// Store a project's generated PNGs as JPEG. Originals go to Recently removed; pictures with transparency are left alone.
async function lighten(id, onProgress) {
  if (lightening.has(id)) return { count: 0, bytes: 0, busy: true };
  lightening.add(id);
  try {
    const { files } = await api.storagePngs(id);
    const map = {}, keep = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i]; if (onProgress) onProgress(i + 1, files.length);
      let blob; try { blob = await toJpeg(f.url, f.alpha); } catch { keep.push(f.name); continue; } // a picture the browser cannot read stays as it is
      if (!blob) { keep.push(f.name); continue; }
      try { const r = await api.storageStage(id, f.name, blob); if (!r.skipped) map[f.name] = r.name; } catch { /* left as PNG this time */ }
    }
    if (keep.length) await api.storageKeepPng(id, keep).catch(() => {});
    if (!Object.keys(map).length) return { count: 0, bytes: 0 };
    return await exclusive(async () => {
      const r = await api.storageConvert(id, map);
      if (state.project && state.project.id === id) relinkLive(r.urls);
      return r;
    });
  } finally { lightening.delete(id); }
}
// After every save: new PNG results in that project become JPEGs, unless the user chose to keep PNG.
bus.on('project:saved', async (id) => {
  if (prefs.imageFormat !== 'jpeg' || !id) return;
  try { const r = await lighten(id); if (r.count && r.bytes > 20 * 1048576) toast(`Stored ${plural(r.count, 'image')} as JPEG, ${fmtBytes(r.bytes)} smaller.`, 'ok'); if (r.count && !sheet.hidden) refresh(); }
  catch { /* housekeeping only: the project itself is saved */ }
});

// =====================================================================
// The sheet
// =====================================================================
const sheet = $('#storage'), body = $('#storage-body');
let data = null, busy = false;
const expanded = new Set();

export async function openStorage() {
  $('#settings').hidden = true; sheet.hidden = false;
  if (!data) render();
  await refresh();
}
const closeStorage = () => { if (!busy) sheet.hidden = true; };
sheet.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeStorage));
bus.on('open:storage', openStorage);
$('#btn-storage')?.addEventListener('click', openStorage);

async function refresh() {
  try { data = await api.storage(); prefs = data.settings; }
  catch (e) { data = { error: e.status === 404 ? 'Restart Lepton to finish this update, then open Storage again.' : e.message }; }
  if (!sheet.hidden) render();
}
// Every button goes through here: one job at a time, the label shows it is working, and the numbers refresh after.
async function run(btn, fn) {
  if (busy) return; busy = true; sheet.classList.add('busy');
  const label = btn.textContent; btn.textContent = 'Working…'; btn.classList.add('working');
  try { await fn((text) => { btn.textContent = text; }); }
  catch (e) { toast(e.message, 'err'); }
  finally { busy = false; sheet.classList.remove('busy'); btn.textContent = label; btn.classList.remove('working'); await refresh(); }
}
const isOpen = (id) => !!state.project && state.project.id === id;
// A clean-up of the open project works on what is on disk, so save first and show the result after.
function onProject(p, fn) {
  return exclusive(async () => {
    if (isOpen(p.id)) await saveQuietly();
    const r = await fn();
    if (isOpen(p.id) && r && r.board) adoptBoard(r.board);
    return r;
  });
}

function section(title) { const s = el('section'); if (title) s.appendChild(el('h3', '', title)); body.appendChild(s); return s; }
function line(parent, title, sub, btnLabel, onClick, { disabled = false, kind = '' } = {}) {
  const row = el('div', 'st-line'); const txt = el('div', 'st-line-text');
  txt.appendChild(el('div', 'st-line-title', title)); if (sub) txt.appendChild(el('div', 'st-line-sub', sub));
  row.appendChild(txt);
  if (btnLabel) { const b = el('button', `btn st-btn ${kind}`, btnLabel); b.disabled = disabled; b.addEventListener('click', () => onClick(b)); row.appendChild(b); }
  parent.appendChild(row); return row;
}
function segmented(options, value, onPick) {
  const seg = el('div', 'segmented st-seg');
  for (const [v, label] of options) { const b = el('button', v === value ? 'on' : '', label); b.type = 'button'; b.addEventListener('click', () => { if (v !== value) onPick(v); }); seg.appendChild(b); }
  return seg;
}

function render() {
  body.innerHTML = '';
  if (!data) { body.appendChild(el('div', 'st-empty', 'Measuring…')); return; }
  if (data.error) { body.appendChild(el('div', 'st-empty', data.error)); return; }
  const projBytes = data.projects.reduce((a, p) => a + p.bytes, 0);
  const unusedBytes = data.projects.reduce((a, p) => a + p.unused.bytes, 0);
  const total = projBytes + data.uploads.bytes + data.trash.bytes + data.archives.bytes;
  const clearable = data.uploads.saved.bytes + data.uploads.unused.bytes + unusedBytes;

  // ----- overview -----
  const top = section();
  top.appendChild(el('div', 'st-total', fmtBytes(total)));
  top.appendChild(el('div', 'st-total-sub', 'used by Lepton on this computer'));
  const parts = [['Projects', projBytes, 'a'], ['Temporary files', data.uploads.bytes, 'b'], ['Recently removed', data.trash.bytes, 'c'], ['Archived', data.archives.bytes, 'd']];
  const bar = el('div', 'st-bar');
  for (const [, bytes, tone] of parts) if (bytes > 0) { const s = el('span', `st-tone-${tone}`); s.style.flexGrow = String(Math.max(bytes / (total || 1), 0.012)); bar.appendChild(s); }
  top.appendChild(bar);
  const legend = el('div', 'st-legend');
  for (const [label, bytes, tone] of parts) { const i = el('div', 'st-legend-item'); i.appendChild(el('span', `st-dot st-tone-${tone}`)); i.appendChild(el('span', '', label)); i.appendChild(el('b', '', fmtBytes(bytes))); legend.appendChild(i); }
  top.appendChild(legend);
  const call = el('div', 'st-callout');
  if (clearable > 1048576) {
    const t = el('div', 'st-line-text'); t.appendChild(el('div', 'st-line-title', `${fmtBytes(clearable)} can be cleared safely`));
    t.appendChild(el('div', 'st-line-sub', 'Temporary files no board uses, and files inside projects that nothing points to.'));
    const b = el('button', 'btn primary st-btn', 'Free up space'); b.addEventListener('click', () => run(b, freeUp));
    call.append(t, b);
  } else call.appendChild(el('div', 'st-line-sub', 'Nothing to clear right now. Trimming history or archiving a finished project frees more.'));
  top.appendChild(call);

  // ----- temporary files -----
  const up = section('Temporary files');
  const u = data.uploads;
  const bits = [];
  if (u.saved.bytes) bits.push(`${fmtBytes(u.saved.bytes)} already saved in projects`);
  if (u.unused.bytes) bits.push(`${fmtBytes(u.unused.bytes)} not used by any board`);
  if (u.used.bytes) bits.push(`${fmtBytes(u.used.bytes)} in use`);
  line(up, `${fmtBytes(u.bytes)} in ${plural(u.count, 'file')}`, bits.join(' · ') || 'Empty.', 'Clear unused', (b) => run(b, clearUploads), { disabled: !(u.saved.count + u.unused.count) });
  const auto = el('div', 'st-line'); const at = el('div', 'st-line-text'); at.appendChild(el('div', 'st-line-title', 'Clear automatically')); at.appendChild(el('div', 'st-line-sub', 'When a file has not been on any board for'));
  auto.appendChild(at);
  auto.appendChild(segmented([[7, '7 days'], [14, '14 days'], [30, '30 days'], [0, 'Never']], data.settings.uploadsDays, async (v) => { try { prefs = await api.storageSettings({ uploadsDays: v }); data.settings = prefs; render(); } catch (e) { toast(e.message, 'err'); } }));
  up.appendChild(auto);
  up.appendChild(el('p', 'hint', 'Files you drop in and new results land in the uploads folder first. Saving a project gives it its own copy, and the temporary one is then removed.'));

  // ----- projects -----
  const pr = section('Projects');
  if (!data.projects.length) pr.appendChild(el('div', 'st-line-sub', 'No saved projects yet.'));
  for (const p of data.projects) pr.appendChild(projectCard(p));

  // ----- image format -----
  const fm = section('Image format');
  const fr = el('div', 'st-line'); const ft = el('div', 'st-line-text'); ft.appendChild(el('div', 'st-line-title', 'Store generated images as'));
  fr.append(ft, segmented([['jpeg', 'JPEG'], ['png', 'PNG']], data.settings.imageFormat, async (v) => { try { prefs = await api.storageSettings({ imageFormat: v }); data.settings = prefs; render(); } catch (e) { toast(e.message, 'err'); } }));
  fm.appendChild(fr);
  fm.appendChild(el('p', 'hint', data.settings.imageFormat === 'jpeg'
    ? 'When you save a project, PNG results are stored as high-quality JPEG, usually well under half the size. Pictures with transparency and files you add yourself are never changed. Originals wait in Recently removed for 30 days.'
    : 'Results are kept exactly as the model returned them. You can still convert a single project from its row above.'));

  // ----- recently removed -----
  const tr = section('Recently removed');
  line(tr, data.trash.bytes ? `${fmtBytes(data.trash.bytes)} in ${plural(data.trash.count, 'file')}` : 'Empty', `Kept for ${data.settings.trashDays} days, then deleted for good.`, 'Empty now', (b) => emptyTrash(b), { disabled: !data.trash.batches.length, kind: 'danger' });
  for (const b of data.trash.batches.slice(0, 12)) {
    line(tr, `${ACTION[b.action] || 'Removed files'} · ${b.name}`, `${fmtBytes(b.bytes)} · ${plural(b.count, 'file')} · ${fmtWhen(b.at)}`, 'Restore', (btn) => run(btn, () => restore(b))).classList.add('st-sub');
  }
  if (data.trash.batches.length > 12) tr.appendChild(el('p', 'hint', `And ${data.trash.batches.length - 12} older.`));

  // ----- archived -----
  if (data.archives.items.length) {
    const ar = section('Archived projects');
    for (const a of data.archives.items) {
      const row = line(ar, a.name, `${fmtBytes(a.bytes)} · archived ${fmtWhen(a.at)}`, 'Restore', (btn) => run(btn, async () => { const r = await api.storageArchiveRestore(a.file); toast(`Restored "${r.name}". Open it from Projects.`, 'ok'); refreshProjects(); }));
      const show = el('button', 'btn st-btn', 'Show'); show.addEventListener('click', () => api.storageArchiveReveal().catch((e) => toast(e.message, 'err'))); row.appendChild(show);
    }
  }
}
const ACTION = { uploads: 'Temporary files', unused: 'Unused files', history: 'Earlier runs', takes: 'Earlier runs and takes', convert: 'Original PNGs', unknown: 'Removed files' };

function projectCard(p) {
  const card = el('div', `st-card ${expanded.has(p.id) ? 'open' : ''}`);
  const head = el('button', 'st-card-head'); head.type = 'button';
  const name = el('span', 'st-card-name', p.name); head.appendChild(name);
  if (isOpen(p.id)) head.appendChild(el('span', 'st-tag', 'Open'));
  head.appendChild(el('span', 'st-card-size', fmtBytes(p.bytes)));
  const chev = el('span', 'st-chev'); chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>'; head.appendChild(chev);
  head.title = p.path;
  head.addEventListener('click', () => { if (expanded.has(p.id)) expanded.delete(p.id); else expanded.add(p.id); render(); });
  card.appendChild(head);
  if (!expanded.has(p.id)) {
    const freeable = p.history.bytes + p.takes.bytes + p.unused.bytes;
    if (freeable > 1048576) head.insertBefore(el('span', 'st-card-hint', `${fmtBytes(freeable)} to trim`), head.querySelector('.st-card-size'));
    return card;
  }
  const inner = el('div', 'st-card-body');
  const hist = [];
  if (p.runs) hist.push(`${plural(p.runs, 'earlier run')} · ${fmtBytes(p.history.bytes)}`);
  if (p.takes.count) hist.push(`${plural(p.takes.count, 'unpicked take')} · ${fmtBytes(p.takes.bytes)}`);
  line(inner, 'History', hist.join('  ·  ') || 'Nothing to trim.', 'Trim…', (b) => trim(b, p), { disabled: !p.runs && !p.takes.count });
  line(inner, 'Unused files', p.unused.count ? `${plural(p.unused.count, 'file')} · ${fmtBytes(p.unused.bytes)}` : 'None.', 'Remove', (b) => run(b, async () => { const r = await onProject(p, () => api.storageUnused(p.id)); toast(r.count ? `Removed ${plural(r.count, 'unused file')}, ${fmtBytes(r.bytes)}.` : 'Nothing to remove.', 'ok'); }), { disabled: !p.unused.count });
  if (p.png.count) line(inner, 'PNG images', `${plural(p.png.count, 'image')} · ${fmtBytes(p.png.bytes)}`, 'Convert to JPEG', (b) => run(b, async (say) => {
    if (isOpen(p.id)) await exclusive(saveQuietly);
    const r = await lighten(p.id, (i, n) => say(`${i} of ${n}…`));
    toast(r.count ? `Stored ${plural(r.count, 'image')} as JPEG, ${fmtBytes(r.bytes)} smaller.` : 'These images are already as small as they get.', 'ok');
  }));
  line(inner, 'Archive', 'Pack the project into one zip and take it off the list.', 'Archive…', (b) => archive(b, p));
  card.appendChild(inner);
  return card;
}

// ----- actions -----
async function freeUp() {
  const up = await api.storageCleanUploads(CLIENT, liveRefs());
  let bytes = up.removed.bytes, kept = up.trashed.bytes;
  for (const p of data.projects) if (p.unused.count) { const r = await api.storageUnused(p.id); kept += r.bytes; }
  toast(`Cleared ${fmtBytes(bytes + kept)}.${kept ? ` ${fmtBytes(kept)} of it can be restored for 30 days.` : ''}`, 'ok');
}
async function clearUploads() {
  const r = await api.storageCleanUploads(CLIENT, liveRefs());
  const n = r.removed.count + r.trashed.count;
  toast(n ? `Cleared ${plural(n, 'temporary file')}, ${fmtBytes(r.removed.bytes + r.trashed.bytes)}.` : 'Nothing to clear.', 'ok');
}
async function trim(btn, p) {
  if (busy) return;
  const both = p.history.bytes + p.takes.bytes;
  const buttons = [{ label: 'Earlier runs', kind: 'primary', value: 'history' }];
  if (p.takes.count) buttons.push({ label: 'Runs and unpicked takes', value: 'takes' });
  buttons.push({ label: 'Cancel', value: 'cancel' });
  const mode = await ask({
    title: `Trim history in "${p.name}"?`,
    message: `Earlier runs frees ${fmtBytes(p.history.bytes)} and keeps every result showing on the board.${p.takes.count ? ` Removing the takes you did not pick as well frees ${fmtBytes(both)} and keeps one result per prompt.` : ''} Either way it can be restored for 30 days.`,
    buttons,
  });
  if (mode === 'cancel') return;
  run(btn, async () => { const r = await onProject(p, () => api.storageTrim(p.id, mode)); toast(`Trimmed "${p.name}": ${plural(r.count, 'file')}, ${fmtBytes(r.bytes)}.`, 'ok'); });
}
async function archive(btn, p) {
  if (busy) return;
  const finalsBytes = p.history.bytes + p.takes.bytes + p.unused.bytes;
  const buttons = [{ label: 'Archive everything', kind: 'primary', value: 'all' }];
  if (finalsBytes > 0) buttons.push({ label: 'Finals only', value: 'finals' });
  buttons.push({ label: 'Cancel', value: 'cancel' });
  const how = await ask({
    title: `Archive "${p.name}"?`,
    message: `The project is packed into one zip in the Archive folder and leaves the project list. You can restore it from here at any time.${finalsBytes > 0 ? ` Finals only keeps the board and one picked result per prompt, which makes the zip about ${fmtBytes(finalsBytes)} smaller.` : ''}`,
    buttons,
  });
  if (how === 'cancel') return;
  if (how === 'finals') {
    const sure = await ask({ title: 'Delete the rest for good?', message: `Earlier runs, unpicked takes and unused files in "${p.name}" will not be in the archive and cannot be restored.`, buttons: [{ label: 'Archive finals only', kind: 'danger', value: 'yes' }, { label: 'Cancel', value: 'cancel' }] });
    if (sure !== 'yes') return;
  }
  run(btn, async () => {
    const open = isOpen(p.id);
    const r = await exclusive(async () => { if (open) await saveQuietly(); const out = await api.storageArchive(p.id, how === 'finals'); if (open) closeArchived(); return out; });
    expanded.delete(p.id); refreshProjects();
    toast(`Archived "${p.name}" as ${r.file}.`, 'ok');
  });
}
async function restore(b) {
  const open = b.scope !== 'uploads' && isOpen(b.scope);
  const r = await exclusive(async () => {
    // Unsaved edits would be lost if the board went back to its earlier state, so they are saved first.
    if (open && boardHash() !== state.project.savedHash) await saveQuietly();
    const out = await api.storageTrashRestore(b.scope, b.batch || b.id);
    if (open && out.board) adoptBoard(out.board);
    return out;
  });
  if (!r.count && !r.board) toast('Those files are already back.', '');
  else if (r.boardChanged) toast(`Put ${plural(r.count, 'file')} back in the media folder. The project has been saved since, so the board itself was left as it is.`, 'ok');
  else toast(r.board ? `Restored ${plural(r.count, 'file')} and the board as it was.` : `Restored ${plural(r.count, 'file')}.`, 'ok');
}
async function emptyTrash(btn) {
  if (busy) return;
  const sure = await ask({ title: 'Empty Recently removed?', message: `${fmtBytes(data.trash.bytes)} will be deleted for good.`, buttons: [{ label: 'Empty', kind: 'danger', value: 'yes' }, { label: 'Cancel', value: 'cancel' }] });
  if (sure !== 'yes') return;
  run(btn, async () => { const r = await api.storageTrashEmpty(); toast(`Deleted ${fmtBytes(r.bytes)}.`, 'ok'); });
}

report();
