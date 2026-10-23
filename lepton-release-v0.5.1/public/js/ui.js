// Chrome: dock, quick add, context menus, lightbox, settings, toasts, status pill, shortcuts.
import { state, bus, addNode, removeNodes, removeEdge, select, clearSelection, save, exportBoard, applyBoard, isGen, isLLM, isRunnable, uid, addEdge, getPorts } from './state.js';
import { applyView, zoomTo, zoomAt, fitToView, viewportCenterWorld, screenToWorld, isTyping, nodeEl, renderEdges, animateToRect } from './canvas.js';
import { mountAll, ICONS, completed } from './nodes.js';
import { runNode, runAll } from './run.js';
import { selectedFiles, downloadSelection } from './download.js';
import { serialize, instantiate, boundsOf, textOf, CLIP_TYPE } from './clipboard.js';
import { installed as installedSkills, loadSkills, addSkillNode, toggleSkillsPanel } from './skills.js';
import { undo, redo, recordMove, snapshot } from './history.js';
import { api } from './api.js';
import { loadModels, clearModels, modelName } from './models.js';
import { createGroup, removeGroup, groupOf, groupAt, addToGroup, removeFromGroup, selectGroup, groupBounds, GROUP_COLORS, toggleCollapsed, collapsedGroupOf, innerPorts } from './groups.js';
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
$('#btn-upload').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', (e) => {
  const files = [...e.target.files]; e.target.value = '';
  const c = viewportCenterWorld();
  bus.emit('files', { files, x: c.x - 130, y: c.y - 100 });
});

// Files dropped / pasted / picked → media nodes.
bus.on('files', async ({ files, x, y }) => {
  let i = 0;
  for (const f of files) {
    if (!/^(image|video|audio)\//.test(f.type)) continue;
    const n = addAt('media', x + i * 40, y + i * 40, { name: f.name, kind: f.type.startsWith('video') ? 'video' : f.type.startsWith('audio') ? 'audio' : 'image', url: URL.createObjectURL(f), pending: true });
    try {
      const r = await api.upload(f);
      n.data.url = r.url; n.data.kind = r.kind; n.data.pending = false;
      const el = nodeEl(n.id); if (el) { const m = el.querySelector('img, video, audio'); if (m) m.src = r.url; }
      save();
    } catch (e) {
      toast(`Upload failed: ${e.message}`, 'err');
      removeNodes([n.id]);
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
    if (c.type === 'text') items.push(['image', 'prompt'], ['video', 'prompt'], ['llm', 'prompt'], ['batch', 'prompt']);
    if (c.type === 'image') items.push(['preview', 'in'], ['compare', 'a'], ['llm', 'media'], ['image', 'refs'], ['video', 'start']);
    if (c.type === 'video') items.push(['preview', 'in'], ['compare', 'a'], ['llm', 'media']);
    if (c.type === 'audio') items.push(['llm', 'media'], ['preview', 'in']);
    if (c.type === 'skill') items.push(['llm', 'skills']);
  } else {
    if (c.type === 'text') items.push(['prompt', 'out'], ['llm', 'out'], ['batch', 'out0']);
    if (c.type === 'image') items.push(['image', 'out'], ['media', 'out']);
    if (c.type === 'media' || c.type === 'any') items.push(['image', 'out'], ['video', 'out'], ['media', 'out']);
    if (c.type === 'skill') {
      // Offer the installed skills directly.
      const picks = installedSkills.slice(0, 8).map((s) => ({ label: `Skill: ${s.name}`, icon: ICONS.skill, run: async () => { const n = addSkillNode(s, { x: w.x - 320, y: w.y - 30 }); await new Promise((r) => setTimeout(r, 30)); addEdge(n.id, 'out', c.node, c.port); } }));
      if (!picks.length) picks.push({ label: 'No skills installed · open Skills', icon: ICONS.skill, run: () => toggleSkillsPanel(true) });
      showCtx(c.clientX, c.clientY, picks); return;
    }
  }
  if (!items.length) return;
  showCtx(c.clientX, c.clientY, items.map(([type, port]) => ({
    label: `Add ${type === 'media' ? 'Upload' : type === 'llm' ? 'LLM' : type === 'batch' ? 'Prompt batch' : cap(type)}${port !== 'out' && port !== 'out0' && port !== 'in' ? ` → ${port === 'refs' ? 'References' : port === 'media' ? 'Media' : cap(port)}` : ''}`,
    icon: ICONS[type],
    run: async () => {
      if (type === 'media') { $('#file-input').click(); return; }
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
  })));
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
    { label: 'LLM', icon: ICONS.llm, key: 'L', run: () => addAt('llm', w.x, w.y) },
    { label: 'Prompt batch', icon: ICONS.batch, key: 'B', run: () => addAt('batch', w.x, w.y) },
    { label: 'Preview', icon: ICONS.preview, key: 'O', run: () => addAt('preview', w.x, w.y) },
    { label: 'Compare', icon: ICONS.compare, key: 'C', run: () => addAt('compare', w.x, w.y) },
    { label: 'Upload media…', icon: ICONS.media, key: 'U', run: () => $('#file-input').click() },
    '-',
    ...(clip ? [{ label: `Paste${clip.payload.nodes.length > 1 ? ` ${clip.payload.nodes.length} nodes` : ''}`, key: '⌘V', run: () => pasteNodes(clip.payload, { at: w }) }] : []),
    ...(state.sel.size ? [{ label: `Group ${state.sel.size} selected`, key: '⌘G', run: () => groupSelection() }] : []),
    { label: 'Fit to view', key: '⇧1', run: () => fitToView() },
  ]);
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
  if (isRunnable(n)) items.push({ label: n.type === 'template' ? 'Compile' : isLLM(n) ? 'Run' : 'Generate', icon: ICONS.play, key: '⏎', run: () => runNode(id) });
  if (n.type === 'media' || isGen(n)) {
    const has = n.type === 'media' ? [{ url: n.data.url, kind: n.data.kind, jobId: n.data.jobId, model: n.data.model }] : completed(n);
    if (has.length) items.push({ label: 'Open', icon: ICONS.expand, run: () => bus.emit('lightbox', { items: has, index: n.type === 'media' ? 0 : Math.max(0, has.findIndex((r) => r.jobId === n.data.results[n.data.selected]?.jobId)), source: id }) });
  }
  const files = selectedFiles();
  if (files.length > 1) items.push({ label: `Download ${files.length} files as .zip`, key: '⇧⌘D', run: () => downloadSelection() });
  else if (files.length === 1) items.push({ label: 'Download', key: '⇧⌘D', run: () => downloadSelection() });
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
  if ([...(cd.files || [])].some((f) => /^(image|video|audio)\//.test(f.type))) return; // files become Media nodes (handled by the canvas)
  const raw = cd.getData(CLIP_TYPE);
  if (raw) { try { e.preventDefault(); pasteNodes(JSON.parse(raw), { inputs: shiftPaste }); } catch { toast('That clipboard content could not be pasted.', 'err'); } return; }
  if (clip && !clip.synced) { e.preventDefault(); pasteNodes(clip.payload, { inputs: shiftPaste }); return; }
  // Plain text becomes a Prompt node.
  const text = (cd.getData('text/plain') || '').trim();
  if (text) { e.preventDefault(); const made = pasteNodes({ nodes: [{ id: 'p', type: 'prompt', x: 0, y: 0, data: { text: text.slice(0, 20000) } }], edges: [] }); if (made && made.length) toast('Pasted as a Prompt node.'); }
});

// ---------- quick add (⌘K) ----------
const qa = $('#quickadd'), qaInput = $('#quickadd-input'), qaList = $('#quickadd-list');
const QA_ITEMS = [
  { type: 'prompt', label: 'Prompt', hint: 'Text box', key: 'P' },
  { type: 'image', label: 'Image', hint: 'Generate images', key: 'I' },
  { type: 'video', label: 'Video', hint: 'Generate video', key: 'V' },
  { type: 'llm', label: 'LLM', hint: 'Analyse media, write prompts', key: 'L' },
  { type: 'batch', label: 'Prompt batch', hint: 'Split LLM text into separate prompts', key: 'B' },
  { type: 'preview', label: 'Preview', hint: 'View results', key: 'O' },
  { type: 'compare', label: 'Compare', hint: 'Two images or videos under a slider', key: 'C' },
  { type: 'upload', label: 'Upload', hint: 'Image, video or audio from disk', key: 'U' },
];
let qaIndex = 0;
export function openQuickAdd() { qa.hidden = false; qaInput.value = ''; qaIndex = 0; renderQa(); qaInput.focus(); loadSkills().then(() => { if (!qa.hidden) renderQa(); }); }
function closeQuickAdd() { qa.hidden = true; vp.focus(); }
function renderQa() {
  const q = qaInput.value.trim().toLowerCase();
  const all = [...QA_ITEMS, ...installedSkills.map((s) => ({ type: 'skill', skill: s, label: s.name, hint: s.description || 'Skill', key: '' }))];
  const items = all.filter((i) => !q || i.label.toLowerCase().includes(q) || i.hint.toLowerCase().includes(q));
  qaList.innerHTML = '';
  items.forEach((i, idx) => {
    const el = document.createElement('div');
    el.className = `qa-item ${idx === qaIndex ? 'active' : ''}`;
    el.innerHTML = `${ICONS[i.type === 'upload' ? 'media' : i.type]}<b>${escapeHtml(i.label)}</b><span style="color:var(--text-3)">${escapeHtml(i.hint)}</span><small>${i.key}</small>`;
    el.addEventListener('click', () => pickQa(i));
    qaList.appendChild(el);
  });
  qa._items = items;
}
function pickQa(i) { closeQuickAdd(); if (i.type === 'upload') $('#file-input').click(); else if (i.type === 'skill') addSkillNode(i.skill); else addCentered(i.type); }
qaInput.addEventListener('input', () => { qaIndex = 0; renderQa(); });
qaInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeQuickAdd();
  else if (e.key === 'ArrowDown') { qaIndex = Math.min(qa._items.length - 1, qaIndex + 1); renderQa(); }
  else if (e.key === 'ArrowUp') { qaIndex = Math.max(0, qaIndex - 1); renderQa(); }
  else if (e.key === 'Enter') { const i = qa._items[qaIndex]; if (i) pickQa(i); }
});
qa.addEventListener('pointerdown', (e) => { if (e.target === qa) closeQuickAdd(); });

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
}
function closeLb() { lb.hidden = true; lbStage.innerHTML = ''; lbState = null; }
$('#lb-close').addEventListener('click', closeLb);
lb.querySelector('.lightbox-backdrop').addEventListener('click', closeLb);
lbStage.addEventListener('click', (e) => { if (e.target === lbStage) closeLb(); });
$('#lb-prev').addEventListener('click', () => { lbState.index = (lbState.index - 1 + lbState.items.length) % lbState.items.length; renderLb(); });
$('#lb-next').addEventListener('click', () => { lbState.index = (lbState.index + 1) % lbState.items.length; renderLb(); });
$('#lb-import').addEventListener('click', () => { const it = lbState.items[lbState.index]; importItem(it, lbState.preview || lbState.source); closeLb(); });
$('#lb-download').addEventListener('click', () => bus.emit('download', lbState.items[lbState.index]));
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
  removeNodes(Object.keys(state.nodes)); state.groups = {}; state.selGroup = null; bus.emit('groups:render'); state.view = { x: 0, y: 0, z: 1 }; applyView(); settings.hidden = true; $('#empty').hidden = false;
});
$('#board-name').addEventListener('dblclick', (e) => { e.target.setAttribute('contenteditable', 'true'); e.target.focus(); document.getSelection().selectAllChildren(e.target); });
$('#board-name').addEventListener('blur', (e) => { e.target.removeAttribute('contenteditable'); state.name = e.target.textContent.trim() || 'Untitled board'; e.target.textContent = state.name; if (state.project) { state.project.name = state.name; api.projectRename(state.project.id, state.name).catch(() => {}); } save(); });
$('#board-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });

bus.on('sidebars:close', (except) => { if (except !== 'groups' && !gpanel.hidden) { gpanel.hidden = true; gbtn.classList.remove('on'); } });

// ---------- groups sidebar ----------
const gpanel = $('#groups-panel'), glist = $('#groups-list'), gbtn = $('#btn-groups');
export function toggleGroupsPanel(force) {
  const open = force === undefined ? gpanel.hidden : force;
  if (open) bus.emit('sidebars:close', 'groups');
  gpanel.hidden = !open; gbtn.classList.toggle('on', open);
  if (open) renderGroupsList();
}
function renderGroupsList() {
  glist.innerHTML = '';
  const groups = Object.values(state.groups);
  if (!groups.length) { glist.appendChild(el('div', 'sidebar-empty', 'No groups yet.')); return; }
  for (const g of groups) {
    const c = GROUP_COLORS.find((x) => x.id === g.color) || GROUP_COLORS[0];
    const row = el('button', `sidebar-item ${state.selGroup === g.id ? 'on' : ''}`);
    const dot = el('span', 'sidebar-dot'); dot.style.background = c.line; dot.style.boxShadow = `0 0 0 1px ${c.text}55`;
    const name = el('span', 'sidebar-name', g.label);
    const count = el('span', 'sidebar-count', `${g.nodeIds.length}${g.collapsed ? ' · folded' : ''}`);
    row.append(dot, name, count);
    row.title = 'Jump to this group';
    row.addEventListener('click', () => {
      const b = groupBounds(g); if (!b) return;
      animateToRect(b, 90, 1, gpanel.getBoundingClientRect().right + 16);
      selectGroup(g.id);
      renderGroupsList();
    });
    glist.appendChild(row);
  }
}
gbtn.addEventListener('click', () => toggleGroupsPanel());
$('#groups-close').addEventListener('click', () => toggleGroupsPanel(false));
bus.on('groups:list', () => { if (!gpanel.hidden) renderGroupsList(); });
bus.on('selection', () => { if (!gpanel.hidden) renderGroupsList(); });

// ---------- run ----------
const runBtn = $('#btn-run-all');
runBtn.addEventListener('click', async () => {
  runBtn.classList.add('busy');
  try { await runAll(); } finally { runBtn.classList.remove('busy'); }
});

// ---------- zoom ----------
$('#zoom-in').addEventListener('click', () => zoomTo(state.view.z * 1.25));
$('#zoom-out').addEventListener('click', () => zoomTo(state.view.z / 1.25));
$('#zoom-level').addEventListener('click', () => zoomTo(1));
$('#zoom-fit').addEventListener('click', () => fitToView());
bus.on('view', () => { $('#zoom-level').textContent = Math.round(state.view.z * 100) + '%'; });

// ---------- keyboard ----------
window.addEventListener('keydown', (e) => {
  const typing = isTyping(e.target);
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); openQuickAdd(); return; }
  if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); if (e.shiftKey) { toggleProjectsPanel(true); saveAs(state.name); } else saveCurrent(); return; }
  if (meta && e.key.toLowerCase() === 'o') { e.preventDefault(); toggleProjectsPanel(); return; }
  if (e.key === 'Escape') { if (!guide.hidden) guide.hidden = true; else if (!lb.hidden) closeLb(); else if (!settings.hidden) settings.hidden = true; else if (!qa.hidden) closeQuickAdd(); else if (!gpanel.hidden) toggleGroupsPanel(false); else if (!$('#skills-panel').hidden) toggleSkillsPanel(false); else if (!$('#projects-panel').hidden) toggleProjectsPanel(false); else clearSelection(); return; }
  if (!lb.hidden && lbState) {
    if (e.key === 'ArrowLeft') $('#lb-prev').click();
    if (e.key === 'ArrowRight') $('#lb-next').click();
    return;
  }
  if (meta && e.key === 'Enter') { e.preventDefault(); if (typing) return; runBtn.click(); return; }
  if (typing) return;
  if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); const ok = e.shiftKey ? redo() : undo(); if (!ok) toast(e.shiftKey ? 'Nothing to redo.' : 'Nothing to undo.'); return; }
  if (meta && e.key === '0') { e.preventDefault(); zoomTo(1); return; }
  if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
  if (meta && e.key.toLowerCase() === 'g') { e.preventDefault(); if (e.shiftKey) ungroupSelection(); else groupSelection(); return; }
  if (meta && e.key.toLowerCase() === 'a') { e.preventDefault(); select(Object.keys(state.nodes).filter((id) => !collapsedGroupOf(id))); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteSelection(); return; }
  if (/^Arrow/.test(e.key) && state.sel.size && !meta && !e.altKey) {
    e.preventDefault();
    const step = e.shiftKey ? 50 : 10;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    const ids = [...state.sel]; const before = snapshot(ids);
    for (const id of ids) { const n = state.nodes[id]; if (!n) continue; n.x += dx; n.y += dy; const el = nodeEl(id); if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; } }
    recordMove(ids, before);
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
    if (k === 'l') addCentered('llm');
    if (k === 'b') addCentered('batch');
    if (k === 'g') toggleGroupsPanel();
    if (k === 'o') addCentered('preview');
    if (k === 'c') addCentered('compare');
    if (k === 'u') $('#file-input').click();
  }
});
