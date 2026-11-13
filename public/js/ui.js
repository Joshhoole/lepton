// Chrome: dock, quick add, context menus, lightbox, settings, toasts, status pill, shortcuts.
import { state, bus, addNode, removeNodes, removeEdge, select, clearSelection, save, exportBoard, applyBoard, isGen, isLLM, isRunnable, uid, addEdge, getPorts } from './state.js';
import { applyView, zoomTo, zoomAt, fitToView, viewportCenterWorld, screenToWorld, isTyping, nodeEl, renderEdges, isMediaFile } from './canvas.js';
import { mountAll, ICONS, completed, refreshMedia } from './nodes.js';
import { runNode, stopNode, isRunning, canStop } from './run.js';
import { selectedFiles, downloadSelection } from './download.js';
import { serialize, instantiate, boundsOf, textOf, CLIP_TYPE } from './clipboard.js';
import { installed as installedSkills, loadSkills, addSkillNode, toggleSkillsPanel } from './skills.js';
import { undo, redo } from './history.js';
import { api } from './api.js';
import { snapToGrid, setSnapToGrid, GRID } from './snap.js';
import { allLinks, linkName, linkOutData } from './links.js';
import { restoreOriginal } from './crop.js';
import { editAnnotation, addFilmLayout } from './annotate.js';
import { loadModels, clearModels, modelName } from './models.js';
import { groupTabsShown, setGroupTabsShown } from './grouptabs.js';
import { createGroup, removeGroup, groupOf, groupAt, addToGroup, removeFromGroup, selectGroup, toggleCollapsed, collapsedGroupOf, innerPorts, boxesCarriedBy, shiftBoxes } from './groups.js';
import { togglePanel as toggleProjectsPanel, saveCurrent, saveAs, settleUnsaved } from './projects.js';

const $ = (s) => document.querySelector(s);
const vp = $('#viewport');

// ---------- toasts ----------
export function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, kind === 'err' ? 6000 : 3200);
}
bus.on('toast', ({ msg, kind }) => toast(msg, kind));
// Undo and redo say what they did in one message that is replaced, not stacked, when ⌘Z is pressed again and again.
let undoMsg = null, undoMsgTimer = 0;
function undoToast(msg) {
  if (!undoMsg || !undoMsg.isConnected) { undoMsg = document.createElement('div'); undoMsg.className = 'toast'; $('#toasts').appendChild(undoMsg); }
  undoMsg.classList.remove('out'); undoMsg.textContent = msg;
  clearTimeout(undoMsgTimer); const el = undoMsg;
  undoMsgTimer = setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.remove(); if (undoMsg === el) undoMsg = null; }, 350); }, 2200);
}

// ---------- connection status + provider cards ----------
let providersInfo = [];
const editing = new Set();
export async function refreshStatus() {
  const dot = $('#status-dot'), txt = $('#status-text');
  try {
    const s = await api.status();
    providersInfo = s.providers || [];
    const live = providersInfo.filter((p) => p.connected);
    state.conn = { connected: !!s.connected, providers: providersInfo };
    if (live.length) { dot.className = 'dot ok'; txt.textContent = `${s.models} models · ${live.map((p) => p.short).join(' + ')}`; }
    else if (providersInfo.some((p) => p.configured)) { dot.className = 'dot bad'; txt.textContent = 'Key rejected'; }
    else { dot.className = 'dot warn'; txt.textContent = 'Add an API key'; }
    renderProviders();
    bus.emit('conn', state.conn);
  } catch (e) {
    state.conn = { connected: false };
    dot.className = 'dot bad'; txt.textContent = 'Server offline';
    $('#providers').innerHTML = '<div class="hint">The local server is not reachable. Start it with <code>npm start</code>.</div>';
  }
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

function renderProviders() {
  const box = $('#providers'); box.innerHTML = '';
  for (const p of providersInfo) {
    const card = el('div', 'provider'); card.dataset.provider = p.id;
    const head = el('div', 'provider-head');
    head.append(el('span', `dot ${p.connected ? 'ok' : p.configured ? 'bad' : ''}`), el('b', '', escapeHtml(p.name)),
      el('span', 'state', p.connected ? `Connected · ${escapeHtml(p.keyHint)}` : p.configured ? `Rejected · ${escapeHtml(p.keyHint)}` : 'Not connected'));
    card.appendChild(head);
    card.appendChild(el('p', 'blurb', `${escapeHtml(p.blurb)} <a href="${p.consoleUrl}" target="_blank" rel="noopener">Get a key</a>`));
    if (p.connected && p.counts) {
      const c = el('div', 'counts');
      for (const [k, n] of Object.entries(p.counts)) if (n) c.appendChild(el('span', '', `${n} ${k === 'llm' ? 'text' : k} model${n === 1 ? '' : 's'}`));
      card.appendChild(c);
    }
    if (p.configured && !p.connected && p.error) card.appendChild(el('p', 'blurb', `<span style="color:var(--danger)">${escapeHtml(p.error)}</span>`));
    const isEditing = editing.has(p.id) || !p.configured;
    if (isEditing) {
      const form = el('div', 'key-form');
      const inputs = {};
      for (const f of p.fields) {
        const lab = el('label', 'field'); lab.appendChild(el('span', '', escapeHtml(f.label)));
        const inp = document.createElement('input'); inp.type = f.secret ? 'password' : 'text'; inp.placeholder = f.placeholder || ''; inp.autocomplete = 'off'; inp.spellcheck = false;
        inputs[f.name] = inp; lab.appendChild(inp); form.appendChild(lab);
      }
      const foot = el('div', 'key-form-foot'); const err = el('span', 'field-error'); err.hidden = true;
      const connect = el('button', 'btn primary', 'Connect'); const cancel = el('button', 'btn', 'Cancel'); cancel.hidden = !p.configured;
      foot.append(err, connect, cancel); form.appendChild(foot); card.appendChild(form);
      const submit = async () => {
        err.hidden = true;
        const fields = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()]));
        if (!Object.values(fields).some(Boolean)) { err.textContent = 'Paste the key first.'; err.hidden = false; return; }
        connect.classList.add('busy'); connect.textContent = 'Checking…';
        try {
          const r = await api.saveKey(p.id, fields);
          editing.delete(p.id);
          toast(`${r.name} connected · ${r.models} models.`, 'ok');
          await refreshStatus(); await syncModels(false);
        } catch (e) { err.textContent = e.message; err.hidden = false; }
        finally { connect.classList.remove('busy'); connect.textContent = 'Connect'; }
      };
      connect.addEventListener('click', submit);
      Object.values(inputs).forEach((i) => { i.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }); i.addEventListener('input', () => { err.hidden = true; }); });
      cancel.addEventListener('click', () => { editing.delete(p.id); renderProviders(); });
    } else {
      const btns = el('div', 'row-btns');
      const change = el('button', 'btn', 'Change key'); const remove = el('button', 'btn danger', 'Remove');
      btns.append(change, remove); card.appendChild(btns);
      const confirm = el('div', 'confirm'); confirm.hidden = true;
      const yes = el('button', 'btn danger', 'Remove'); const no = el('button', 'btn', 'Keep');
      confirm.append(el('span', '', `Remove the saved ${escapeHtml(p.name)} key from this computer?`), yes, no); card.appendChild(confirm);
      change.addEventListener('click', () => { editing.add(p.id); renderProviders(); card.querySelector('input')?.focus(); });
      remove.addEventListener('click', () => { confirm.hidden = false; btns.hidden = true; });
      no.addEventListener('click', () => { confirm.hidden = true; btns.hidden = false; });
      yes.addEventListener('click', async () => {
        try { await api.removeKey(p.id); toast(`${p.name} key removed.`); await refreshStatus(); await syncModels(false); } catch (e) { toast(e.message, 'err'); }
      });
    }
    box.appendChild(card);
  }
}

async function syncModels(msg = true) {
  try {
    const m = await loadModels(true);
    bus.emit('models');
    if (msg) toast(`${m.length} models available.`, 'ok');
  } catch (e) {
    if (e.code === 'NO_API_KEY') { clearModels(); bus.emit('models'); }
    else toast(`Couldn't load models: ${e.message}`, 'err');
  }
}
$('#btn-refresh-models')?.addEventListener('click', () => syncModels());

const cap = (s) => String(s).replace(/^\w/, (c) => c.toUpperCase());
bus.on('generated', () => setTimeout(refreshStatus, 800));

// ---------- adding nodes ----------
function placeNear(x, y, w = 300, h = 200) {
  // Slide right until the spot doesn't overlap an existing node.
  const rects = Object.values(state.nodes).map((n) => { const el = nodeEl(n.id); return { x: n.x, y: n.y, w: el ? el.offsetWidth : 300, h: el ? el.offsetHeight : 200 }; });
  const hits = (px, py) => rects.some((r) => px < r.x + r.w + 24 && px + w + 24 > r.x && py < r.y + r.h + 24 && py + h + 24 > r.y);
  let px = x, py = y, tries = 0;
  while (tries++ < 40 && hits(px, py)) px += 60;
  return { x: px, y: py };
}
export function addAt(type, x, y, data) {
  const p = placeNear(x, y, type === 'preview' ? 340 : type === 'media' ? 260 : type === 'compare' ? 420 : 300, type === 'prompt' ? 150 : type === 'preview' ? 120 : 380);
  const n = addNode(type, p.x, p.y, data);
  select([n.id]);
  $('#empty').hidden = true;
  return n;
}
export function addCentered(type, data) {
  const c = viewportCenterWorld();
  const w = type === 'preview' ? 340 : type === 'media' ? 260 : type === 'template' ? 380 : type === 'compare' ? 420 : type === 'llm' || type === 'batch' ? 320 : 300;
  return addAt(type, c.x - w / 2, c.y - 120, data);
}
document.querySelectorAll('.dock-btn[data-add]').forEach((b) => b.addEventListener('click', () => addCentered(b.dataset.add)));
$('#btn-linkout').addEventListener('click', () => addCentered('linkout', linkOutData()));

// ---------- notes, titles, layouts ----------
// Where the pointer is on the board, for things that should land under the hand (null when it is off the canvas).
function pointerWorld() {
  if (!pointer || pointer.x < 0 || pointer.y < 0 || pointer.x > window.innerWidth || pointer.y > window.innerHeight) return null;
  const hit = document.elementFromPoint(pointer.x, pointer.y); if (!hit || !vp.contains(hit)) return null;
  const w = screenToWorld(pointer.x, pointer.y); return { x: w.x - 24, y: w.y - 18 };
}
// A note or a title, ready to type into.
export function addAnnotation(type, at = null) {
  const n = at ? addAt(type, at.x, at.y) : addCentered(type);
  editAnnotation(n.id);
  return n;
}
export function addFilm(at = null) {
  const empty = !Object.keys(state.nodes).length;
  const c = viewportCenterWorld();
  addFilmLayout(at || { x: c.x - 300, y: c.y - 160 });
  if (empty) requestAnimationFrame(() => fitToView(120));
  toast('Added a film layout: References, Characters, Locations, Shots, Finals. Rename or delete what you do not need.', 'ok');
}
$('#btn-notes').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showCtx(r.left - 60, r.top - 128, [
    { label: 'Note', icon: ICONS.note, key: 'N', run: () => addAnnotation('sticky') },
    { label: 'Title', icon: ICONS.heading, key: 'T', run: () => addAnnotation('heading') },
    '-',
    { label: 'Film layout', icon: ICONS.film, run: () => addFilm() },
  ]);
});
// Straighten the selected nodes without rearranging them: whatever is roughly in a row becomes a row, whatever is
// roughly in a column becomes a column, and each node stays in the place it already holds. One step in undo.
export function tidySelection() {
  const ids = [...state.sel].filter((id) => state.nodes[id] && nodeEl(id) && !collapsedGroupOf(id));
  if (ids.length < 2) { toast('Select two or more nodes to tidy.'); return; }
  const items = ids.map((id) => { const n = state.nodes[id], el = nodeEl(id); return { id, n, x: n.x, y: n.y, w: el.offsetWidth, h: el.offsetHeight }; });
  const x0 = Math.min(...items.map((i) => i.x)), y0 = Math.min(...items.map((i) => i.y));
  // Two nodes share a band when they overlap by at least half of the smaller one along that axis.
  const band = (list, pos, size, key) => {
    const bands = [];
    for (const it of [...list].sort((a, b) => a[pos] - b[pos])) {
      const hit = bands.find((b) => Math.min(b.a[pos] + b.a[size], it[pos] + it[size]) - Math.max(b.a[pos], it[pos]) >= 0.5 * Math.min(b.a[size], it[size]));
      if (hit) it[key] = hit.i; else { it[key] = bands.length; bands.push({ a: it, i: bands.length }); }
    }
    return bands.length;
  };
  const rowCount = band(items, 'y', 'h', 'row');
  band(items, 'x', 'w', 'col');
  // Two nodes can land in the same cell (one on top of another): the later one moves a column along, as it sits now.
  let colCount = 0;
  for (let r = 0; r < rowCount; r++) {
    let last = -1;
    for (const it of items.filter((i) => i.row === r).sort((a, b) => a.x - b.x)) { it.col = Math.max(it.col, last + 1); last = it.col; colCount = Math.max(colCount, it.col + 1); }
  }
  const GAP = 28;
  const colW = Array.from({ length: colCount }, (_, c) => Math.max(0, ...items.filter((i) => i.col === c).map((i) => i.w)));
  const rowH = Array.from({ length: rowCount }, (_, r) => Math.max(0, ...items.filter((i) => i.row === r).map((i) => i.h)));
  const colX = []; let x = x0; for (let c = 0; c < colCount; c++) { colX.push(x); if (colW[c]) x += colW[c] + GAP; }
  const rowY = []; let y = y0; for (let r = 0; r < rowCount; r++) { rowY.push(y); y += rowH[r] + GAP; }
  for (const it of items) {
    it.n.x = Math.round(colX[it.col]); it.n.y = Math.round(rowY[it.row]);
    const el = nodeEl(it.id); el.style.left = `${it.n.x}px`; el.style.top = `${it.n.y}px`;
  }
  renderEdges(); bus.emit('groups:render'); save();
  toast(`Tidied ${ids.length} nodes where they were. ⌘Z puts them back.`, 'ok');
}
bus.on('tidy', tidySelection);
// Open the file picker: any media by default, or one kind, landing at a chosen spot (else the middle of the view).
let uploadAt = null;
function pickFiles(accept = 'image/*,video/*,audio/*', at = null) { const fi = $('#file-input'); fi.accept = accept; uploadAt = at; fi.click(); }
$('#btn-upload').addEventListener('click', () => pickFiles());
$('#file-input').addEventListener('change', (e) => {
  const files = [...e.target.files]; e.target.value = '';
  const c = viewportCenterWorld(); const at = uploadAt || { x: c.x - 130, y: c.y - 100 }; uploadAt = null;
  bus.emit('files', { files, x: at.x, y: at.y });
});

// Files dropped / pasted / picked → media nodes.
const fileKind = (f) => (/^video\//.test(f.type) || /\.(mp4|mov|webm|m4v)$/i.test(f.name) ? 'video' : /^audio\//.test(f.type) || /\.(mp3|wav|m4a|ogg|oga|aac|flac|aiff?)$/i.test(f.name) ? 'audio' : 'image');
bus.on('files', async ({ files, x, y }) => {
  let i = 0;
  for (const f of files) {
    if (!isMediaFile(f)) continue;
    const n = addAt('media', x + i * 40, y + i * 40, { name: f.name, kind: fileKind(f), url: URL.createObjectURL(f), pending: true });
    try {
      const r = await api.upload(f);
      // Look the node up again: a project save or an undo may have replaced the object while the file was on its way.
      const live = state.nodes[n.id]; if (!live) { i++; continue; }
      const temp = live.data.url;
      live.data.url = r.url; live.data.kind = r.kind; delete live.data.pending; delete live.data.lost;
      if (typeof temp === 'string' && temp.startsWith('blob:')) URL.revokeObjectURL(temp);
      save(); refreshMedia(live.id); bus.emit('results', live.id);
    } catch (e) {
      toast(`Upload failed: ${e.message}`, 'err');
      if (state.nodes[n.id]) removeNodes([n.id]);
    }
    i++;
  }
});

// Import a result as its own Media node.
bus.on('import', ({ item, near }) => importItem(item, near));
function importItem(item, nearId) {
  const src = state.nodes[nearId];
  const el = src && nodeEl(nearId);
  const x = src ? src.x + (el ? el.offsetWidth : 300) + 60 : viewportCenterWorld().x;
  const y = src ? src.y : viewportCenterWorld().y;
  const n = addAt('media', x, y, { url: item.url, kind: item.kind || 'image', jobId: item.jobId || null, model: item.model || null, name: item.name || modelName(item.model || '') , title: item.model ? modelName(item.model) : 'Media' });
  toast('Added to the board.', 'ok');
  return n;
}

// Show a result's file in Finder / Explorer. A result still on the provider's server is saved first (into the open
// project, else uploads/) and the board then points at the local copy, so it is never fetched again.
function relink(from, to) {
  const swap = (r) => { if (r.url === from) r.url = to; if (r.thumb === from) r.thumb = to; };
  for (const n of Object.values(state.nodes)) { const d = n.data; if (d.url === from) d.url = to; (d.results || []).forEach(swap); for (const run of d.history || []) (run.results || []).forEach(swap); }
  bus.emit('media:relinked', { [from]: to }); // small copies and the undo history follow the file
}
bus.on('reveal', async (item) => {
  try {
    const r = await api.reveal(item.url, state.project?.id || null);
    if (r.url && r.url !== item.url) { relink(item.url, r.url); save(); }
    toast(r.saved ? `Saved to ${r.folder} and shown in ${r.app}.` : `Shown in ${r.app}.`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
});
bus.on('download', (item) => {
  const ext = item.kind === 'video' ? 'mp4' : item.kind === 'audio' ? (item.url.split('?')[0].match(/\.(mp3|wav|m4a|ogg)$/i) || [, 'mp3'])[1] : (item.url.split('?')[0].match(/\.(png|jpe?g|webp|gif)$/i) || [, 'png'])[1];
  const name = `${(item.model ? modelName(item.model) : 'lepton').replace(/\s+/g, '-').toLowerCase()}-${(item.jobId || uid()).slice(0, 8)}.${ext}`;
  const a = document.createElement('a');
  a.href = item.url.startsWith('/') ? item.url : api.downloadUrl(item.url, name);
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
});

// Dropping a connection on empty canvas offers a matching node.
bus.on('connect:drop', (c) => {
  const w = screenToWorld(c.clientX, c.clientY);
  const items = [];
  if (c.dir === 'out') {
    if (c.type === 'text') items.push(['image', 'prompt'], ['video', 'prompt'], ['audio', 'prompt'], ['llm', 'prompt'], ['batch', 'prompt'], ['combine', 'prompt']);
    if (['text', 'image', 'video', 'audio'].includes(c.type)) items.push(['linkin', 'in']); // goes last in the menu, below
    if (c.type === 'image') items.push(['preview', 'in'], ['compare', 'a'], ['llm', 'media'], ['image', 'refs'], ['video', 'start']);
    if (c.type === 'video') items.push(['preview', 'in'], ['compare', 'a'], ['llm', 'media']);
    if (c.type === 'audio') items.push(['llm', 'media'], ['preview', 'in']);
    if (c.type === 'skill') items.push(['llm', 'skills']);
  } else {
    if (c.type === 'text') items.push(['prompt', 'out'], ['llm', 'out'], ['batch', 'all'], ['combine', 'out']);
    if (c.type === 'image') items.push(['image', 'out'], ['media', 'out']);
    if (c.type === 'audio') items.push(['audio', 'out'], ['media', 'out']);
    if (c.type === 'media' || c.type === 'any') items.push(['image', 'out'], ['video', 'out'], ['media', 'out']);
    if (c.type === 'skill') {
      // Offer the installed skills directly.
      const picks = installedSkills.slice(0, 8).map((s) => ({ label: `Skill: ${s.name}`, icon: ICONS.skill, run: async () => { const n = addSkillNode(s, { x: w.x - 320, y: w.y - 30 }); await new Promise((r) => setTimeout(r, 30)); addEdge(n.id, 'out', c.node, c.port); } }));
      if (!picks.length) picks.push({ label: 'No skills installed · open Skills', icon: ICONS.skill, run: () => toggleSkillsPanel(true) });
      showCtx(c.clientX, c.clientY, picks); return;
    }
  }
  // A strand pulled out of an input can be fed by a link that carries that kind of thing.
  const fromLinks = c.dir === 'in' && !c.group ? allLinks().filter((l) => getPorts({ type: 'linkout', id: '', data: { link: l.id } }).outputs.some((p) => p.key === c.type)).slice(0, 8).map((l) => ({
    label: `Link out: ${linkName(l)}`, icon: ICONS.linkout,
    run: async () => { const n = addAt('linkout', w.x - 300, w.y - 30, { link: l.id }); await new Promise((r) => setTimeout(r, 30)); addEdge(n.id, c.type, c.node, c.port); },
  })) : [];
  if (!items.length && !fromLinks.length) return;
  const linkLast = (a, b) => (a[0] === 'linkin') - (b[0] === 'linkin');
  showCtx(c.clientX, c.clientY, [...items.sort(linkLast).map(([type, port]) => ({
    label: `Add ${type === 'media' ? 'Upload' : type === 'llm' ? 'LLM' : type === 'batch' ? 'Prompt batch' : type === 'linkin' ? 'Link in' : cap(type)}${port !== 'out' && port !== 'all' && port !== 'in' ? ` → ${port === 'refs' ? 'References' : port === 'media' ? 'Media' : cap(port)}` : ''}`,
    icon: ICONS[type],
    run: async () => {
      if (type === 'media') { pickFiles(); return; }
      const n = addAt(type, c.dir === 'out' ? w.x : w.x - 320, w.y - 30);
      await new Promise((r) => setTimeout(r, 30));
      if (c.group) {
        // The strand came from a collapsed group: ask which inside port it stands for when there is a choice.
        const g = state.groups[c.group]; if (!g) return;
        const want = c.dir === 'out' ? innerPorts(g, 'out', c.type) : innerPorts(g, 'in', c.type);
        const go = (p) => { if (c.dir === 'out') addEdge(p.node, p.port, n.id, port); else addEdge(n.id, port, p.node, p.port); };
        if (want.length === 1) go(want[0]); else if (want.length) showCtx(c.clientX, c.clientY, want.map((p) => ({ label: p.label, run: () => go(p) })));
        return;
      }
      if (c.dir === 'out') {
        const def = getPortDef(n, port); const sources = c.fan && c.fan.length && def && def.multi ? c.fan : [{ node: c.node, port: c.port }];
        let made = 0; for (const s of sources) if (addEdge(s.node, s.port, n.id, port)) made++;
        if (made > 1) toast(`Connected ${made} nodes.`, 'ok');
      } else addEdge(n.id, port, c.node, c.port);
    },
  })), ...(items.length && fromLinks.length ? ['-'] : []), ...fromLinks]);
});

const getPortDef = (n, key) => getPorts(n).inputs.find((p) => p.key === key) || getPorts(n).outputs.find((p) => p.key === key) || null;
// Choosing which inside port a strand to a collapsed group means.
bus.on('group:pick', ({ title, options, cb }) => { const r = vp.getBoundingClientRect(); const p = pointer || { x: r.left + r.width / 2, y: r.top + r.height / 2 }; showCtx(p.x, p.y, [{ label: title, run: () => {} }, '-', ...options.map((o) => ({ label: o.label, run: () => cb(o) }))]); });
// One generator per prompt, already wired to the batch node's outputs.
bus.on('batch:fanout', ({ id, type }) => {
  const b = state.nodes[id]; if (!b) return;
  const items = b.data.items || []; if (!items.length) return;
  const el = nodeEl(id); const x = b.x + (el ? el.offsetWidth : 320) + 80;
  const gap = type === 'image' ? 440 : 520;
  const made = [];
  items.forEach((t, i) => {
    if (Object.values(state.edges).some((e) => e.from === id && e.fromPort === `out${i}` && state.nodes[e.to]?.type === type)) return;
    const n = addNode(type, x, b.y + i * gap, {});
    addEdge(id, `out${i}`, n.id, 'prompt');
    made.push(n.id);
  });
  if (made.length) { select(made); toast(`Added ${made.length} ${type} node${made.length === 1 ? '' : 's'}.`, 'ok'); }
  else toast('Every prompt already has one.', '');
});
// One prompt out of a batch as its own Prompt node, with the text already in it.
bus.on('batch:popout', ({ id, index }) => {
  const b = state.nodes[id]; if (!b) return;
  const text = (b.data.items || [])[index]; if (!text) return;
  // Below the batch (the generators usually sit to its right); addAt steps aside from anything already there.
  const el = nodeEl(id);
  const n = addAt('prompt', b.x, b.y + (el ? el.offsetHeight : 400) + 40, { text, title: `Prompt ${index + 1}` });
  select([n.id]);
  toast(`Prompt ${index + 1} is now its own node.`, 'ok');
});

// ---------- context menu ----------
const ctx = $('#ctx');
export function showCtx(x, y, items) {
  ctx.innerHTML = '';
  for (const it of items) {
    if (it === '-') { ctx.appendChild(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    if (it.danger) b.classList.add('danger');
    b.innerHTML = `${it.icon ? `<span style="width:16px;height:16px;display:grid;place-items:center">${it.icon}</span>` : ''}<span>${it.label}</span>${it.key ? `<small>${it.key}</small>` : ''}`;
    b.addEventListener('click', () => { hideCtx(); it.run(); });
    ctx.appendChild(b);
  }
  ctx.hidden = false;
  const r = ctx.getBoundingClientRect();
  ctx.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  ctx.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
}
export function hideCtx() { ctx.hidden = true; }
bus.on('ctx:show', ({ x, y, items }) => showCtx(x, y, items));
window.addEventListener('pointerdown', (e) => { if (!ctx.contains(e.target)) hideCtx(); }, true);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCtx(); });

vp.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const nodeElm = e.target.closest && e.target.closest('.node');
  if (nodeElm) return nodeMenu(nodeElm.dataset.id, e.clientX, e.clientY);
  const w = screenToWorld(e.clientX, e.clientY);
  const groupElm = e.target.closest && e.target.closest('.group');
  if (groupElm) {
    const gid = groupElm.dataset.id; selectGroup(gid);
    return showCtx(e.clientX, e.clientY, [
      { label: state.groups[gid]?.collapsed ? 'Expand' : 'Collapse', run: () => toggleCollapsed(gid) },
      { label: 'Rename', run: () => document.querySelector(`.group[data-id="${gid}"] .group-name`)?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) },
      state.sel.size && [...state.sel].some((id) => !state.groups[gid].nodeIds.includes(id)) ? { label: 'Add selected nodes', run: () => addToGroup(gid, [...state.sel]) } : null,
      '-',
      { label: 'Ungroup', key: '⇧⌘G', run: () => { removeGroup(gid); toast('Ungrouped.'); } },
    ].filter(Boolean));
  }
  showCtx(e.clientX, e.clientY, [
    { label: 'Prompt', icon: ICONS.prompt, key: 'P', run: () => addAt('prompt', w.x, w.y) },
    { label: 'Image', icon: ICONS.image, key: 'I', run: () => addAt('image', w.x, w.y) },
    { label: 'Video', icon: ICONS.video, key: 'V', run: () => addAt('video', w.x, w.y) },
    { label: 'Audio', icon: ICONS.audio, key: 'A', run: () => addAt('audio', w.x, w.y) },
    { label: 'LLM', icon: ICONS.llm, key: 'L', run: () => addAt('llm', w.x, w.y) },
    { label: 'Prompt batch', icon: ICONS.batch, key: 'B', run: () => addAt('batch', w.x, w.y) },
    { label: 'Combine', icon: ICONS.combine, key: 'J', run: () => addAt('combine', w.x, w.y) },
    { label: 'Preview', icon: ICONS.preview, key: 'O', run: () => addAt('preview', w.x, w.y) },
    { label: 'Compare', icon: ICONS.compare, key: 'C', run: () => addAt('compare', w.x, w.y) },
    { label: 'Link in', icon: ICONS.linkin, key: 'K', run: () => addAt('linkin', w.x, w.y) },
    { label: 'Link out', icon: ICONS.linkout, key: '⇧K', run: () => addAt('linkout', w.x, w.y, linkOutData()) },
    { label: 'Upload media…', icon: ICONS.media, key: 'U', run: () => pickFiles() },
    '-',
    { label: 'Note', icon: ICONS.note, key: 'N', run: () => addAnnotation('sticky', w) },
    { label: 'Title', icon: ICONS.heading, key: 'T', run: () => addAnnotation('heading', w) },
    '-',
    ...(clip ? [{ label: `Paste${clip.payload.nodes.length > 1 ? ` ${clip.payload.nodes.length} nodes` : ''}`, key: '⌘V', run: () => pasteNodes(clip.payload, { at: w }) }] : []),
    ...(state.sel.size ? [{ label: `Group ${state.sel.size} selected`, key: '⌘G', run: () => groupSelection() }] : []),
    { label: 'Fit to view', key: '⇧1', run: () => fitToView() },
  ].filter(Boolean));
});
// Dropping a node inside a group's panel adds it to that group.
bus.on('nodes:dropped', ({ ids }) => {
  for (const id of ids) {
    const n = state.nodes[id]; if (!n || groupOf(id)) continue;
    const el = nodeEl(id); const cx = n.x + (el ? el.offsetWidth : 300) / 2, cy = n.y + (el ? el.offsetHeight : 200) / 2;
    const g = groupAt(cx, cy);
    if (g) { addToGroup(g.id, [id]); toast(`Added to "${g.label}".`); }
  }
});
bus.on('ctx:node', ({ id, x, y }) => nodeMenu(id, x, y));
function nodeMenu(id, x, y) {
  const n = state.nodes[id]; if (!n) return;
  if (!state.sel.has(id)) select([id]);
  const items = [];
  if (isRunnable(n) && isRunning(id)) { if (canStop(id)) items.push({ label: isLLM(n) ? 'Stop' : 'Stop generating', icon: ICONS.stop, run: () => stopNode(id) }); }
  else if (isRunnable(n)) items.push({ label: n.type === 'template' ? 'Compile' : isLLM(n) ? 'Run' : 'Generate', icon: ICONS.play, key: '⏎', run: () => runNode(id) });
  if (n.type === 'media' || isGen(n)) {
    const has = n.type === 'media' ? (n.data.url ? [{ url: n.data.url, kind: n.data.kind, jobId: n.data.jobId, model: n.data.model }] : []) : completed(n);
    if (has.length) items.push({ label: 'Open', icon: ICONS.expand, run: () => bus.emit('lightbox', { items: has, index: n.type === 'media' ? 0 : Math.max(0, has.findIndex((r) => r.jobId === n.data.results[n.data.selected]?.jobId)), source: id }) });
  }
  if (n.type === 'sticky' || n.type === 'heading') items.push({ label: 'Edit text', run: () => editAnnotation(id) });
  else items.push({ label: 'Rename', run: () => nodeEl(id)?.querySelector('.node-title')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) });
  const drawOn = n.type === 'media' ? (n.data.url && !n.data.pending && n.data.kind !== 'video' && n.data.kind !== 'audio' ? { url: n.data.url, name: n.data.name } : null)
    : n.type === 'image' ? (() => { const r = completed(n); const pick = r.find((x) => x.jobId === n.data.results[n.data.selected]?.jobId && x.url === n.data.results[n.data.selected]?.url) || r[0]; return pick ? { url: pick.url, name: n.data.title || 'image' } : null; })() : null;
  if (drawOn) items.push({ label: 'Crop image', icon: ICONS.crop, run: () => bus.emit('crop', { ...drawOn, sourceId: id }) });
  if (drawOn) items.push({ label: 'Draw on image', icon: ICONS.pen, run: () => bus.emit('markup', { ...drawOn, sourceId: id }) });
  if (n.type === 'media' && n.data.original) items.push({ label: 'Restore original image', run: () => restoreOriginal(id) });
  if (state.sel.size > 1) items.push({ label: `Tidy up ${state.sel.size} nodes`, icon: ICONS.grid, run: () => tidySelection() });
  const files = selectedFiles();
  if (files.length > 1) items.push({ label: `Download ${files.length} files as .zip`, key: '⇧⌘D', run: () => downloadSelection() });
  else if (files.length === 1) items.push({ label: 'Download', key: '⇧⌘D', run: () => downloadSelection() });
  if (items.length) items.push('-');
  items.push({ label: 'Copy', key: '⌘C', run: () => copySelection() }, { label: 'Cut', key: '⌘X', run: () => copySelection(true) });
  items.push({ label: 'Duplicate', key: '⌘D', run: () => duplicateSelection() });
  const g = groupOf(id);
  if (g) items.push({ label: 'Remove from group', run: () => { removeFromGroup([...state.sel]); toast('Removed from group.'); } });
  else items.push({ label: state.sel.size > 1 ? `Group ${state.sel.size} nodes` : 'Group', key: '⌘G', run: () => groupSelection() });
  items.push('-', { label: 'Delete', key: '⌫', danger: true, run: () => deleteSelection() });
  showCtx(x, y, items);
}

export function groupSelection() {
  const ids = [...state.sel].filter((id) => state.nodes[id]);
  if (!ids.length) { toast('Select some nodes first.'); return; }
  const g = createGroup(ids);
  if (g) { toast('Grouped. Double-click the label to rename.', 'ok'); const el = document.querySelector(`.group[data-id="${g.id}"] .group-name`); if (el) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }
}
export function ungroupSelection() {
  const ids = [...state.sel];
  const gid = state.selGroup || (ids.length && groupOf(ids[0])?.id);
  if (gid) { removeGroup(gid); toast('Ungrouped.'); }
}
export function deleteSelection() {
  if (state.selEdge) { removeEdge(state.selEdge); return; }
  if (state.selGroup && ![...state.sel].some((id) => !state.groups[state.selGroup]?.nodeIds.includes(id))) {
    // A selected group: Delete removes the panel, keeps the nodes.
    removeGroup(state.selGroup); clearSelection(); toast('Ungrouped. Nodes were kept.'); return;
  }
  if (state.sel.size) { removeNodes([...state.sel]); }
  $('#empty').hidden = Object.keys(state.nodes).length > 0;
}
export function duplicateSelection() {
  const ids = [...state.sel]; if (!ids.length) return;
  const made = instantiate(serialize(ids), { dx: 40, dy: 40 });
  if (made.length) select(made);
}

// ---------- copy, cut, paste ----------
// The selection goes to the system clipboard (so it can be pasted into another board or tab) and is also kept here,
// for the right-click menu and for browsers that do not hand the page a clipboard event.
let clip = null; // { payload, synced }
let pointer = null; let pasteCount = 0; let lastPasteAt = null;
window.addEventListener('pointermove', (e) => { pointer = { x: e.clientX, y: e.clientY }; }, { passive: true });
const hasTextSelection = () => { const s = window.getSelection(); return !!s && !s.isCollapsed && String(s).trim().length > 0; };
export function copySelection(cut = false) {
  const ids = [...state.sel].filter((id) => state.nodes[id]);
  const payload = serialize(ids);
  if (!payload.nodes.length) return null;
  clip = { payload, synced: false, text: textOf(ids) };
  pasteCount = 0; lastPasteAt = null;
  if (cut) { removeNodes(payload.nodes.map((n) => n.id)); $('#empty').hidden = Object.keys(state.nodes).length > 0; }
  toast(`${cut ? 'Cut' : 'Copied'} ${payload.nodes.length} node${payload.nodes.length === 1 ? '' : 's'}.`);
  return clip;
}
export function pasteNodes(payload, { at = null, inputs = false } = {}) {
  if (!payload || !payload.nodes || !payload.nodes.length) return;
  const b = boundsOf(payload);
  // Under the pointer when it is over the canvas, otherwise in the middle of the view.
  const r = vp.getBoundingClientRect();
  const over = pointer && pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom && !document.elementFromPoint(pointer.x, pointer.y)?.closest('.dock, .sidebar, .topbar, .sheet');
  const target = at || (over ? screenToWorld(pointer.x, pointer.y) : viewportCenterWorld());
  // Pasting again in the same spot steps each copy down and right so they do not hide each other.
  const spot = `${Math.round(target.x)}:${Math.round(target.y)}`;
  if (spot === lastPasteAt) pasteCount++; else { pasteCount = 0; lastPasteAt = spot; }
  const made = instantiate(payload, { dx: target.x - b.x - b.w / 2 + pasteCount * 28, dy: target.y - b.y - b.h / 2 + pasteCount * 28, inputs });
  if (made.length) { select(made); $('#empty').hidden = true; save(); }
  return made;
}
let shiftPaste = false; let pasteTimer = null;
window.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || isTyping(e.target)) return;
  const k = e.key.toLowerCase();
  if ((k === 'c' || k === 'x') && !e.shiftKey && state.sel.size && !hasTextSelection()) copySelection(k === 'x');
  if (k === 'v') {
    shiftPaste = e.shiftKey;
    // If no clipboard event follows, paste what was copied here.
    clearTimeout(pasteTimer);
    pasteTimer = setTimeout(() => { if (clip) pasteNodes(clip.payload, { inputs: shiftPaste }); }, 120);
  }
});
for (const evt of ['copy', 'cut']) document.addEventListener(evt, (e) => {
  if (isTyping(e.target) || hasTextSelection() || !clip || clip.synced || !e.clipboardData) return;
  e.clipboardData.setData(CLIP_TYPE, JSON.stringify(clip.payload));
  e.clipboardData.setData('text/plain', clip.text || '');
  clip.synced = true;
  e.preventDefault();
});
window.addEventListener('paste', (e) => {
  if (isTyping(e.target)) return;
  clearTimeout(pasteTimer);
  const cd = e.clipboardData; if (!cd) return;
  if ([...(cd.files || [])].some(isMediaFile)) return; // files become Media nodes (handled by the canvas)
  const raw = cd.getData(CLIP_TYPE);
  if (raw) { try { e.preventDefault(); pasteNodes(JSON.parse(raw), { inputs: shiftPaste }); } catch { toast('That clipboard content could not be pasted.', 'err'); } return; }
  if (clip && !clip.synced) { e.preventDefault(); pasteNodes(clip.payload, { inputs: shiftPaste }); return; }
  // Plain text becomes a Prompt node.
  const text = (cd.getData('text/plain') || '').trim();
  if (text) { e.preventDefault(); const made = pasteNodes({ nodes: [{ id: 'p', type: 'prompt', x: 0, y: 0, data: { text: text.slice(0, 20000) } }], edges: [] }); if (made && made.length) toast('Pasted as a Prompt node.'); }
});

// ---------- quick add (⇧A) ----------
// A small menu at the pointer. With nothing typed it lists categories, each opening a flyout of what it holds;
// typing searches everything at once. The node lands where the menu was opened.
const qa = $('#quickadd'), qaInput = $('#quickadd-input'), qaList = $('#quickadd-list'), qaSub = $('#quickadd-sub');
const QA_CATS = [
  { id: 'text', label: 'Text', icon: 'prompt' },
  { id: 'image', label: 'Image', icon: 'image' },
  { id: 'video', label: 'Video', icon: 'video' },
  { id: 'audio', label: 'Audio', icon: 'audio' },
  { id: 'view', label: 'View', icon: 'preview' },
  { id: 'link', label: 'Link', icon: 'linkin' },
  { id: 'notes', label: 'Notes', icon: 'note' },
  { id: 'skills', label: 'Skills', icon: 'skill' },
];
const QA_ITEMS = [
  { cat: 'text', type: 'prompt', label: 'Prompt', hint: 'Text box', key: 'P' },
  { cat: 'text', type: 'batch', label: 'Prompt batch', hint: 'Split LLM text into separate prompts', key: 'B' },
  { cat: 'text', type: 'combine', label: 'Combine', hint: 'Join several prompts into one text', key: 'J' },
  { cat: 'text', type: 'llm', label: 'LLM', hint: 'Analyse media, write prompts', key: 'L' },
  { cat: 'image', type: 'image', label: 'Image', hint: 'Generate images', key: 'I' },
  { cat: 'image', type: 'upload', accept: 'image/*', icon: 'media', label: 'Upload image', hint: 'From disk' },
  { cat: 'video', type: 'video', label: 'Video', hint: 'Generate video', key: 'V' },
  { cat: 'video', type: 'upload', accept: 'video/*', icon: 'media', label: 'Upload video', hint: 'From disk' },
  { cat: 'audio', type: 'audio', label: 'Audio', hint: 'Speech from text, in a voice you pick', key: 'A' },
  { cat: 'audio', type: 'upload', accept: 'audio/*', icon: 'audio', label: 'Upload audio', hint: 'From disk' },
  { cat: 'view', type: 'preview', label: 'Preview', hint: 'View results', key: 'O' },
  { cat: 'view', type: 'compare', label: 'Compare', hint: 'Two images or videos under a slider', key: 'C' },
  { cat: 'link', type: 'linkin', label: 'Link in', hint: 'Gather references under a name', key: 'K' },
  { cat: 'link', type: 'linkout', label: 'Link out', hint: 'Use a link here, without a long strand', key: '⇧K' },
  { cat: 'notes', type: 'sticky', icon: 'note', label: 'Note', hint: 'Sticky note, with checkboxes if you like', key: 'N' },
  { cat: 'notes', type: 'heading', label: 'Title', hint: 'Large text: bold, lists, highlighter', key: 'T' },
  { cat: 'notes', type: 'film', label: 'Film layout', hint: 'Labelled sections: References to Finals' },
];
const qaState = { at: null, index: -1, sub: null, subIndex: -1, rows: [], subRows: [] };
let qaHover = null;
const qaAll = () => [
  ...QA_ITEMS,
  ...allLinks().map((l) => ({ cat: 'link', type: 'linkout', link: l.id, label: `Link out: ${linkName(l)}`, hint: 'Stands for everything in that link' })),
  ...installedSkills.map((s) => ({ cat: 'skills', type: 'skill', skill: s, label: s.name, hint: s.description || 'Skill' })),
];
function qaRow(i, active) {
  const el = document.createElement('div');
  el.className = `qa-item ${active ? 'active' : ''}`;
  el.innerHTML = `${ICONS[i.icon || i.type] || ICONS.plus}<b>${escapeHtml(i.label)}</b><span style="color:var(--text-3)">${escapeHtml(i.hint || '')}</span><small>${i.key || ''}</small>`;
  el.title = i.hint && i.hint.length > 40 ? i.hint : '';
  el.addEventListener('click', () => pickQa(i));
  return el;
}
function placeQa() {
  const p = qaState.at ? qaState.at.screen : { x: window.innerWidth / 2 - 124, y: window.innerHeight * 0.22 + 20 };
  // The search field opens under the pointer, so nothing is hovered by accident.
  qa.style.left = `${Math.max(8, Math.min(p.x - 16, window.innerWidth - qa.offsetWidth - 8))}px`;
  qa.style.top = `${Math.max(8, Math.min(p.y - 20, window.innerHeight - qa.offsetHeight - 8))}px`;
}
export function openQuickAdd() {
  const p = pointer && pointer.x >= 0 && pointer.y >= 0 && pointer.x <= window.innerWidth && pointer.y <= window.innerHeight ? pointer : null;
  const w = p ? screenToWorld(p.x, p.y) : null;
  qaState.at = p ? { screen: { ...p }, world: { x: w.x - 24, y: w.y - 18 } } : null;
  qa.hidden = false; qaInput.value = ''; qaState.index = -1; closeQaSub();
  renderQa(); placeQa(); qaInput.focus();
  const again = () => { if (!qa.hidden) { renderQa(); placeQa(); } };
  loadSkills().then(again);
}
function closeQuickAdd(refocus = true) { if (qa.hidden) return; qa.hidden = true; closeQaSub(); if (refocus) vp.focus(); }
function closeQaSub() {
  clearTimeout(qaHover); qaSub.hidden = true; qaState.sub = null; qaState.subIndex = -1; qaState.subRows = [];
  qaList.querySelectorAll('.qa-cat.open').forEach((c) => c.classList.remove('open'));
}
function openQaSub(cat, focusFirst = false) {
  const anchor = qaList.querySelector(`.qa-cat[data-cat="${cat.id}"]`); if (!anchor) return;
  qaState.sub = cat.id; qaState.subRows = cat.items; qaState.subIndex = focusFirst ? 0 : -1;
  qaList.querySelectorAll('.qa-cat').forEach((c) => c.classList.toggle('open', c === anchor));
  qaSub.innerHTML = '';
  const head = document.createElement('div'); head.className = 'qa-head'; head.textContent = cat.label; qaSub.appendChild(head);
  cat.items.forEach((i, idx) => qaSub.appendChild(qaRow(i, idx === qaState.subIndex)));
  qaSub.hidden = false;
  const m = qa.getBoundingClientRect(), a = anchor.getBoundingClientRect(), W = qaSub.offsetWidth, H = qaSub.offsetHeight;
  const right = m.right + 4 + W <= window.innerWidth - 8;
  qaSub.style.left = `${right ? m.right + 4 : Math.max(8, m.left - W - 4)}px`;
  qaSub.style.top = `${Math.max(8, Math.min(a.top - 6, window.innerHeight - H - 8))}px`;
}
function markQaSub() { [...qaSub.querySelectorAll('.qa-item')].forEach((el, idx) => { el.classList.toggle('active', idx === qaState.subIndex); if (idx === qaState.subIndex) el.scrollIntoView({ block: 'nearest' }); }); }
function renderQa() {
  const q = qaInput.value.trim().toLowerCase();
  qaList.innerHTML = ''; qa.classList.toggle('searching', !!q);
  if (q) {
    // Typing: one flat list across every category, best matches (name first) on top.
    closeQaSub();
    const hits = qaAll().filter((i) => i.label.toLowerCase().includes(q) || (i.hint || '').toLowerCase().includes(q));
    const rank = (i) => { const l = i.label.toLowerCase(); return l.startsWith(q) ? 0 : l.includes(q) ? 1 : 2; };
    hits.sort((a, b) => rank(a) - rank(b));
    qaState.rows = hits; qaState.index = Math.max(0, Math.min(qaState.index, hits.length - 1));
    if (!hits.length) { const e = document.createElement('div'); e.className = 'qa-empty'; e.textContent = 'Nothing matches that.'; qaList.appendChild(e); return; }
    hits.forEach((i, idx) => { const el = qaRow(i, idx === qaState.index); qaList.appendChild(el); if (idx === qaState.index) el.scrollIntoView({ block: 'nearest' }); });
    return;
  }
  const all = qaAll();
  const cats = QA_CATS.map((c) => ({ ...c, items: all.filter((i) => i.cat === c.id) })).filter((c) => c.items.length);
  qaState.rows = cats;
  cats.forEach((c, idx) => {
    const el = document.createElement('button'); el.type = 'button'; el.tabIndex = -1; el.dataset.cat = c.id;
    el.className = `qa-cat ${idx === qaState.index ? 'active' : ''} ${c.id === qaState.sub ? 'open' : ''}`;
    el.innerHTML = `${ICONS[c.icon]}<b>${c.label}</b><span class="qa-count">${c.items.length}</span><span class="qa-arrow">${ICONS.chevron}</span>`;
    // A short pause before switching flyouts, so the pointer can cut across other rows on its way into the open one.
    el.addEventListener('pointerenter', () => { clearTimeout(qaHover); qaHover = setTimeout(() => { qaState.index = idx; qaList.querySelectorAll('.qa-cat').forEach((x, k) => x.classList.toggle('active', k === idx)); openQaSub(c); }, qaState.sub && qaState.sub !== c.id ? 130 : 30); });
    el.addEventListener('click', () => { clearTimeout(qaHover); openQaSub(c); qaInput.focus(); });
    qaList.appendChild(el);
  });
}
qaSub.addEventListener('pointerenter', () => clearTimeout(qaHover));
function pickQa(i) {
  const at = qaState.at ? qaState.at.world : null;
  closeQuickAdd();
  if (i.type === 'upload') pickFiles(i.accept, at);
  else if (i.type === 'skill') addSkillNode(i.skill, at || undefined);
  else if (i.type === 'sticky' || i.type === 'heading') addAnnotation(i.type, at);
  else if (i.type === 'film') addFilm(at);
  else if (i.type === 'linkout') { const data = i.link ? { link: i.link } : linkOutData(); if (at) addAt('linkout', at.x, at.y, data); else addCentered('linkout', data); }
  else if (at) addAt(i.type, at.x, at.y);
  else addCentered(i.type);
}
qaInput.addEventListener('input', () => { qaState.index = qaInput.value.trim() ? 0 : -1; renderQa(); placeQa(); });
qaInput.addEventListener('keydown', (e) => {
  const searching = !!qaInput.value.trim(); const rows = qaState.rows;
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (e.key === 'Escape') { stop(); if (!searching && qaState.sub && qaState.subIndex >= 0) { qaState.subIndex = -1; markQaSub(); } else closeQuickAdd(); return; }
  if (searching) {
    if (e.key === 'ArrowDown') { stop(); qaState.index = Math.min(rows.length - 1, qaState.index + 1); renderQa(); }
    else if (e.key === 'ArrowUp') { stop(); qaState.index = Math.max(0, qaState.index - 1); renderQa(); }
    else if (e.key === 'Enter') { stop(); const i = rows[qaState.index]; if (i) pickQa(i); }
    return;
  }
  const inSub = qaState.sub && qaState.subIndex >= 0;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    stop(); const d = e.key === 'ArrowDown' ? 1 : -1;
    if (inSub) { qaState.subIndex = Math.max(0, Math.min(qaState.subRows.length - 1, qaState.subIndex + d)); markQaSub(); return; }
    if (!rows.length) return;
    qaState.index = Math.max(0, Math.min(rows.length - 1, qaState.index + d));
    renderQa(); openQaSub(rows[qaState.index]);
  } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
    if (inSub) { if (e.key === 'Enter') { stop(); const i = qaState.subRows[qaState.subIndex]; if (i) pickQa(i); } return; }
    const c = rows[Math.max(0, qaState.index)]; if (!c) return;
    stop(); qaState.index = Math.max(0, qaState.index); renderQa(); openQaSub(c, true);
  } else if (e.key === 'ArrowLeft' && inSub) { stop(); qaState.subIndex = -1; markQaSub(); }
});
// Clicking anywhere else, or scrolling the canvas, puts the menu away. The click itself still does its job.
const outsideQa = (e) => !qa.hidden && !(e.target instanceof Node && (qa.contains(e.target) || qaSub.contains(e.target)));
window.addEventListener('pointerdown', (e) => { if (outsideQa(e)) closeQuickAdd(false); }, true);
window.addEventListener('wheel', (e) => { if (outsideQa(e)) closeQuickAdd(false); }, { capture: true, passive: true });
window.addEventListener('resize', () => closeQuickAdd(false));
window.addEventListener('blur', () => closeQuickAdd(false));

// ---------- lightbox ----------
const lb = $('#lightbox'), lbStage = $('#lb-stage'), lbMeta = $('#lb-meta');
let lbState = null;
bus.on('lightbox', ({ items, index = 0, source, preview }) => {
  if (!items || !items.length) return;
  lbState = { items, index: Math.max(0, index), source, preview };
  lb.hidden = false; renderLb();
});
function renderLb() {
  const { items, index } = lbState;
  const it = items[index];
  lbStage.innerHTML = '';
  let el;
  if (it.kind === 'video') el = Object.assign(document.createElement('video'), { src: it.url, controls: true, autoplay: true, loop: true, playsInline: true });
  else if (it.kind === 'audio') {
    el = Object.assign(document.createElement('audio'), { src: it.url, controls: true, autoplay: true });
    const box = document.createElement('div'); box.className = 'audio-box';
    const name = document.createElement('div'); name.className = 'name'; name.textContent = it.name || 'Audio';
    box.append(name, el); lbStage.appendChild(box);
  } else el = Object.assign(document.createElement('img'), { src: it.url, draggable: false });
  if (it.kind !== 'audio') lbStage.appendChild(el);
  const meta = [];
  if (items.length > 1) meta.push(`${index + 1} of ${items.length}`);
  if (it.model) meta.push(modelName(it.model));
  if (it.name && !it.model) meta.push(it.name);
  if (it.kind === 'video') el.addEventListener('loadedmetadata', () => { lbMeta.textContent = [...meta, `${el.videoWidth}×${el.videoHeight}`, `${Math.round(el.duration * 10) / 10}s`].join('  ·  '); });
  else el.addEventListener('load', () => { lbMeta.textContent = [...meta, `${el.naturalWidth}×${el.naturalHeight}`].join('  ·  '); });
  lbMeta.textContent = meta.join('  ·  ');
  $('#lb-prev').hidden = items.length < 2; $('#lb-next').hidden = items.length < 2;
  $('#lb-markup').hidden = it.kind === 'video' || it.kind === 'audio';
  $('#lb-crop').hidden = it.kind === 'video' || it.kind === 'audio';
}
function closeLb() { lb.hidden = true; lbStage.innerHTML = ''; lbState = null; }
$('#lb-close').addEventListener('click', closeLb);
lb.querySelector('.lightbox-backdrop').addEventListener('click', closeLb);
lbStage.addEventListener('click', (e) => { if (e.target === lbStage) closeLb(); });
$('#lb-prev').addEventListener('click', () => { lbState.index = (lbState.index - 1 + lbState.items.length) % lbState.items.length; renderLb(); });
$('#lb-next').addEventListener('click', () => { lbState.index = (lbState.index + 1) % lbState.items.length; renderLb(); });
$('#lb-import').addEventListener('click', () => { const it = lbState.items[lbState.index]; importItem(it, lbState.preview || lbState.source); closeLb(); });
$('#lb-download').addEventListener('click', () => bus.emit('download', lbState.items[lbState.index]));
$('#lb-markup').addEventListener('click', () => { const it = lbState.items[lbState.index]; const src = lbState.source; closeLb(); bus.emit('markup', { url: it.url, name: it.name || (it.model ? modelName(it.model) : 'image'), sourceId: src }); });
$('#lb-crop').addEventListener('click', () => { const it = lbState.items[lbState.index]; const src = lbState.source; closeLb(); bus.emit('crop', { url: it.url, name: it.name || (it.model ? modelName(it.model) : 'image'), sourceId: src }); });
$('#lb-reveal').addEventListener('click', () => bus.emit('reveal', lbState.items[lbState.index]));
$('#lb-open').addEventListener('click', () => window.open(lbState.items[lbState.index].url, '_blank'));

// ---------- guide modal (plain-text help for template sections) ----------
const guide = $('#guide');
bus.on('guide', ({ title, description, optional, guide: g }) => {
  $('#guide-title').textContent = title;
  const body = $('#guide-body'); body.innerHTML = '';
  const tag = el('div', 'guide-tag', optional ? 'Optional' : 'Recommended');
  body.appendChild(tag);
  if (g.summary || description) body.appendChild(el('p', 'guide-summary', escapeHtml(g.summary || description)));
  for (const grp of g.groups || []) {
    const sec = el('section', 'guide-group');
    sec.appendChild(el('h3', '', escapeHtml(grp.title)));
    const ul = document.createElement('ul');
    for (const it of grp.items || []) { const li = document.createElement('li'); li.textContent = it; ul.appendChild(li); }
    sec.appendChild(ul); body.appendChild(sec);
  }
  body.appendChild(el('p', 'guide-foot', 'Leave the section empty and it is left out of the prompt entirely. Whatever you write is kept as written; the model does not add to it.'));
  guide.hidden = false;
});
guide.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => (guide.hidden = true)));

// ---------- settings ----------
const settings = $('#settings');
const openSettings = () => { settings.hidden = false; $('#clear-confirm').hidden = true; refreshStatus(); };
$('#btn-settings').addEventListener('click', openSettings);
bus.on('open:settings', openSettings);
$('#status-pill').addEventListener('click', () => { settings.hidden = false; refreshStatus(); });
settings.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => (settings.hidden = true)));
$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(exportBoard(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${state.name.replace(/[^\w-]+/g, '_') || 'board'}.lepton.json`; a.click();
});
$('#btn-import-board').addEventListener('click', () => $('#board-file').click());
$('#board-file').addEventListener('change', async (e) => {
  if (!(await settleUnsaved())) { e.target.value = ''; return; }
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    applyBoard(d); mountAll(); applyView(); bus.emit('groups:render'); $('#board-name').textContent = state.name; save(); settings.hidden = true; fitToView(); toast('Board imported.', 'ok');
  } catch (err) { toast(`Couldn't import: ${err.message}`, 'err'); }
});
$('#btn-clear').addEventListener('click', () => { $('#clear-confirm').hidden = false; });
$('#btn-clear-no').addEventListener('click', () => { $('#clear-confirm').hidden = true; });
$('#btn-clear-yes').addEventListener('click', () => {
  $('#clear-confirm').hidden = true;
  removeNodes(Object.keys(state.nodes)); state.groups = {}; state.strokes = []; bus.emit('strokes'); state.selGroup = null; bus.emit('groups:render'); state.view = { x: 0, y: 0, z: 1 }; applyView(); settings.hidden = true; $('#empty').hidden = false;
});
$('#board-name').addEventListener('dblclick', (e) => { e.target.setAttribute('contenteditable', 'true'); e.target.focus(); document.getSelection().selectAllChildren(e.target); });
$('#board-name').addEventListener('blur', (e) => { e.target.removeAttribute('contenteditable'); state.name = e.target.textContent.trim() || 'Untitled board'; e.target.textContent = state.name; if (state.project) { state.project.name = state.name; api.projectRename(state.project.id, state.name).catch(() => {}); } save(); });
$('#board-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });

// ---------- group tabs ----------
// The tabs themselves are grouptabs.js. The dock button and G show and hide the column.
const gbtn = $('#btn-groups');
const showGroupTabsBtn = () => { const on = groupTabsShown(); gbtn.classList.toggle('on', on); gbtn.setAttribute('aria-pressed', String(on)); gbtn.title = `Group tabs: ${on ? 'shown' : 'hidden'} (G)`; };
export function toggleGroupTabs() {
  if (!Object.keys(state.groups).length) { if (!groupTabsShown()) setGroupTabsShown(true); toast('No groups yet. Select nodes and press ⌘G to make one; its tab appears on the left.'); return; }
  setGroupTabsShown(!groupTabsShown());
  toast(groupTabsShown() ? 'Group tabs shown. Click one to go to its group; drag to reorder.' : 'Group tabs hidden. Press G to bring them back.');
}
bus.on('grouptabs:shown', showGroupTabsBtn); showGroupTabsBtn();
gbtn.addEventListener('click', toggleGroupTabs);

// ---------- zoom ----------
$('#zoom-in').addEventListener('click', () => zoomTo(state.view.z * 1.25));
$('#zoom-out').addEventListener('click', () => zoomTo(state.view.z / 1.25));
$('#zoom-level').addEventListener('click', () => zoomTo(1));
$('#zoom-fit').addEventListener('click', () => fitToView());
// Snap to grid: a setting of this browser, not of the board, so it stays as it was left across boards and reloads.
const snapBtn = $('#snap-grid');
const showSnap = () => { const on = snapToGrid(); snapBtn.classList.toggle('on', on); snapBtn.setAttribute('aria-pressed', String(on)); snapBtn.title = `Snap to grid: ${on ? 'on' : 'off'} (⇧G)`; };
function toggleSnapToGrid() { setSnapToGrid(!snapToGrid()); toast(snapToGrid() ? 'Snap to grid on. Dragged nodes land on the grid; hold ⇧ to place one freely.' : 'Snap to grid off. Nodes still pull into line with each other.'); }
bus.on('snap:grid', showSnap); showSnap();
snapBtn.addEventListener('click', toggleSnapToGrid);
bus.on('view', () => { $('#zoom-level').textContent = Math.round(state.view.z * 100) + '%'; });

// ---------- keyboard ----------
window.addEventListener('keydown', (e) => {
  const typing = isTyping(e.target);
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); openQuickAdd(); return; }
  if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); if (e.shiftKey) { toggleProjectsPanel(true); saveAs(state.name); } else saveCurrent(); return; }
  if (meta && e.key.toLowerCase() === 'o') { e.preventDefault(); toggleProjectsPanel(); return; }
  if (e.key === 'Escape') { if (!guide.hidden) guide.hidden = true; else if (!lb.hidden) closeLb(); else if (!$('#storage').hidden) { if (!$('#storage').classList.contains('busy')) $('#storage').hidden = true; } else if (!settings.hidden) settings.hidden = true; else if (!qa.hidden) closeQuickAdd(); else if (!$('#skills-panel').hidden) toggleSkillsPanel(false); else if (!$('#projects-panel').hidden) toggleProjectsPanel(false); else clearSelection(); return; }
  if (!lb.hidden && lbState) {
    if (e.key === 'ArrowLeft') $('#lb-prev').click();
    if (e.key === 'ArrowRight') $('#lb-next').click();
    return;
  }
  if (typing) return;
  if (!meta && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); openQuickAdd(); return; }
  if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); const what = e.shiftKey ? redo() : undo(); undoToast(what ? `${e.shiftKey ? 'Redid' : 'Undid'} ${what}.` : e.shiftKey ? 'Nothing to redo.' : 'Nothing to undo.'); return; }
  if (meta && e.key === '0') { e.preventDefault(); zoomTo(1); return; }
  if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
  if (meta && e.key.toLowerCase() === 'g') { e.preventDefault(); if (e.shiftKey) ungroupSelection(); else groupSelection(); return; }
  if (meta && e.key.toLowerCase() === 'a') { e.preventDefault(); select(Object.keys(state.nodes).filter((id) => !collapsedGroupOf(id))); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteSelection(); return; }
  if (/^Arrow/.test(e.key) && state.sel.size && !meta && !e.altKey) {
    e.preventDefault();
    const ids = [...state.sel];
    // With snap to grid on, a nudge is one grid square (four with ⇧) and brings the first selected node onto the grid.
    const grid = snapToGrid(); const step = grid ? (e.shiftKey ? GRID * 4 : GRID) : (e.shiftKey ? 50 : 10);
    let dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    const lead = grid && state.nodes[ids[0]];
    if (lead) {
      const land = (v, d) => (d > 0 ? Math.floor(v / GRID) * GRID + d : d < 0 ? Math.ceil(v / GRID) * GRID + d : v);
      dx = land(lead.x, dx) - lead.x; dy = land(lead.y, dy) - lead.y;
    }
    for (const id of ids) { const n = state.nodes[id]; if (!n) continue; n.x += dx; n.y += dy; const el = nodeEl(id); if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; } }
    const boxes = boxesCarriedBy(ids); shiftBoxes(boxes, dx, dy); // a hand-sized group panel moves with its whole group
    renderEdges(); save(); return;
  }
  if (e.key === 'Enter') { const sel = [...state.sel].filter((id) => isRunnable(state.nodes[id])); if (sel.length) { e.preventDefault(); sel.forEach((id) => runNode(id)); } return; }
  if (e.key === '=' || e.key === '+') zoomTo(state.view.z * 1.2);
  if (e.key === '-') zoomTo(state.view.z / 1.2);
  if (e.key === '!' || (e.shiftKey && e.key === '1')) fitToView();
  const k = e.key.toLowerCase();
  if (!meta && !e.altKey && e.shiftKey && k === 's') { toggleSkillsPanel(); return; }
  if (!meta && !e.altKey) {
    if (k === 'p') addCentered('prompt');
    if (k === 'i') addCentered('image');
    if (k === 'v') addCentered('video');
    if (k === 'a' && !e.shiftKey) addCentered('audio');
    if (k === 'l') addCentered('llm');
    if (k === 'j') addCentered('combine');
    if (k === 'k') { if (e.shiftKey) addCentered('linkout', linkOutData()); else addCentered('linkin'); }
    if (k === 'b') addCentered('batch');
    if (k === 'g') { if (e.shiftKey) toggleSnapToGrid(); else toggleGroupTabs(); }
    if (k === 'o') addCentered('preview');
    if (k === 'c') addCentered('compare');
    if (k === 'u') pickFiles();
    if (k === 'x') bus.emit('tool', 'cut');
    if (k === 'd') bus.emit('tool', 'pen');
    if (k === 'n') { e.preventDefault(); addAnnotation('sticky', pointerWorld()); }
    if (k === 't') { e.preventDefault(); addAnnotation('heading', pointerWorld()); }
  }
});
