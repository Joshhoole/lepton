// Projects sidebar: open, save, save-as, rename, reveal. A project is a folder with project.json + media/.
import { state, bus, save, exportBoard, applyBoard, boardHash, removeNodes } from './state.js';
import { applyView, fitToView } from './canvas.js';
import { mountAll } from './nodes.js';
import { api } from './api.js';
import { askSave } from './dialog.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const toast = (msg, kind) => bus.emit('toast', { msg, kind });

const panel = $('#projects-panel'), list = $('#projects-list'), btn = $('#btn-projects');
let listing = { root: '', projects: [] };
let busy = false;

export function togglePanel(force) {
  const open = force === undefined ? panel.hidden : force;
  if (open) bus.emit('sidebars:close', 'projects');
  panel.hidden = !open; btn.classList.toggle('on', open);
  if (open) refresh();
}
bus.on('sidebars:close', (except) => { if (except !== 'projects' && !panel.hidden) { panel.hidden = true; btn.classList.remove('on'); } });

export async function refresh() {
  try { listing = await api.projects(); } catch (e) { listing = { root: '', projects: [], error: e.message }; }
  render();
}

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso); const diff = (Date.now() - d) / 1000;
  if (diff < 60) return 'just now'; if (diff < 3600) return `${Math.round(diff / 60)} min ago`; if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function render() {
  list.innerHTML = '';
  const cur = state.project;
  // Current project header
  const head = el('div', 'proj-current');
  head.appendChild(el('div', 'proj-label', cur ? 'Current project' : 'No project open'));
  const name = el('div', 'proj-name', cur ? cur.name : state.name);
  head.appendChild(name);
  head.appendChild(el('div', 'proj-meta', cur ? `${state.dirty ? 'Unsaved changes' : 'Saved'} · ${fmtWhen(cur.savedAt)}` : 'The board lives in this browser until you save it to a folder.'));
  const acts = el('div', 'proj-actions');
  const saveBtn = el('button', 'btn primary', cur ? 'Save' : 'Save as…'); saveBtn.title = '⌘S';
  saveBtn.addEventListener('click', () => (cur ? saveCurrent() : promptSaveAs()));
  acts.appendChild(saveBtn);
  if (cur) {
    const asBtn = el('button', 'btn', 'Save as…'); asBtn.addEventListener('click', promptSaveAs); acts.appendChild(asBtn);
    const rev = el('button', 'btn', 'Reveal'); rev.title = 'Show the folder'; rev.addEventListener('click', () => api.projectReveal(cur.id).catch((e) => toast(e.message, 'err'))); acts.appendChild(rev);
    const close = el('button', 'btn', 'Close'); close.title = 'Detach from the folder (board stays as it is)'; close.addEventListener('click', () => { state.project = null; state.dirty = false; save(true); bus.emit('project'); render(); }); acts.appendChild(close);
  }
  head.appendChild(acts);
  const form = el('div', 'proj-form'); form.hidden = true;
  const input = el('input', 'text-input'); input.placeholder = 'Project name'; input.spellcheck = false;
  const go = el('button', 'btn primary', 'Save'); const cancel = el('button', 'btn', 'Cancel');
  form.append(input, go, cancel); head.appendChild(form);
  head._form = { form, input, go, cancel };
  list.appendChild(head);

  const newBtn = el('button', 'sidebar-item proj-new');
  newBtn.innerHTML = `<span class="sidebar-dot" style="background:var(--surface-3)"></span><span class="sidebar-name">New empty project…</span>`;
  newBtn.addEventListener('click', promptNew);
  list.appendChild(newBtn);

  list.appendChild(el('div', 'sidebar-section', 'Projects folder'));
  if (listing.error) list.appendChild(el('div', 'sidebar-empty', listing.error));
  const ps = listing.projects || [];
  if (!ps.length) list.appendChild(el('div', 'sidebar-empty', 'No saved projects yet.'));
  for (const p of ps) {
    const row = el('button', `sidebar-item proj ${cur && cur.id === p.id ? 'on' : ''}`);
    row.innerHTML = `<span class="preset-body"><span class="sidebar-name">${escapeHtml(p.name)}${p.external ? ' <small>(outside folder)</small>' : ''}</span><span class="preset-desc">${p.nodes} node${p.nodes === 1 ? '' : 's'}${p.groups ? ` · ${p.groups} group${p.groups === 1 ? '' : 's'}` : ''} · ${fmtWhen(p.savedAt)}</span></span>`;
    row.title = p.path;
    row.addEventListener('click', () => openProject({ id: p.id }));
    list.appendChild(row);
  }

  const foot = el('div', 'proj-foot');
  const pathIn = el('input', 'text-input'); pathIn.placeholder = 'Open a project folder by path…'; pathIn.spellcheck = false;
  pathIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && pathIn.value.trim()) openProject({ path: pathIn.value.trim() }); });
  const rootBtn = el('button', 'btn small', 'Show folder'); rootBtn.addEventListener('click', () => api.projectReveal().catch((e) => toast(e.message, 'err')));
  foot.append(pathIn, rootBtn);
  list.appendChild(foot);
  if (listing.root) list.appendChild(el('div', 'proj-root', listing.root));
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function showForm(label, initial, onGo) {
  const head = list.querySelector('.proj-current'); if (!head) return;
  const { form, input, go, cancel } = head._form;
  form.hidden = false; input.value = initial; go.textContent = label; input.focus(); input.select();
  const submit = () => { const v = input.value.trim(); if (!v) { input.focus(); return; } form.hidden = true; onGo(v); };
  go.onclick = submit; cancel.onclick = () => { form.hidden = true; };
  input.onkeydown = (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') form.hidden = true; e.stopPropagation(); };
}
function promptSaveAs() { showForm('Save', state.project ? `${state.project.name} copy` : state.name, (name) => saveAs(name)); }
async function promptNew() {
  if (!(await settleUnsaved())) return;
  showForm('Create', 'Untitled project', async (name) => {
    removeNodes(Object.keys(state.nodes)); state.groups = {}; state.selGroup = null; bus.emit('groups:render');
    state.view = { x: 0, y: 0, z: 1 }; applyView(); state.name = name; $('#board-name').textContent = name; $('#empty').hidden = false;
    await saveAs(name);
  });
}

async function withBusy(fn) {
  if (busy) return; busy = true; document.body.classList.add('proj-busy');
  try { await fn(); } catch (e) { toast(e.message, 'err'); } finally { busy = false; document.body.classList.remove('proj-busy'); render(); }
}
export function saveCurrent() {
  if (!state.project) return promptSaveAs();
  return withBusy(async () => {
    const r = await api.projectSave({ id: state.project.id, name: state.name, board: exportBoard() });
    adopt(r, 'Saved.');
  });
}
export function saveAs(name) {
  return withBusy(async () => {
    state.name = name; $('#board-name').textContent = name;
    const r = await api.projectSave({ name, board: exportBoard() });
    adopt(r, `Saved to "${r.name}".`);
  });
}
// Take the server's rewritten board (media now inside the project folder) and mark clean.
function adopt(r, msg) {
  const view = { ...state.view };
  applyBoard({ ...r.board, view, name: r.name });
  state.project = { id: r.id, path: r.path, name: r.name, savedAt: r.savedAt };
  mountAll(); bus.emit('groups:render'); bus.emit('models');
  state.project.savedHash = boardHash(); state.dirty = false;
  save(true); bus.emit('project');
  toast(msg, 'ok'); refresh();
}
export async function openProject(ref) {
  if (state.project && ref.id === state.project.id && !state.dirty) { toast('That project is already open.'); return; }
  if (!(await settleUnsaved())) return;
  return withBusy(async () => {
    const r = await api.projectOpen(ref);
    applyBoard({ ...r.board, name: r.name });
    state.project = { id: r.id, path: r.path, name: r.name, savedAt: r.savedAt };
    $('#board-name').textContent = r.name;
    mountAll(); applyView(); bus.emit('groups:render'); bus.emit('models');
    $('#empty').hidden = Object.keys(state.nodes).length > 0;
    state.project.savedHash = boardHash(); state.dirty = false;
    save(true); bus.emit('project');
    requestAnimationFrame(() => setTimeout(() => fitToView(120), 60));
    toast(`Opened "${r.name}".`, 'ok');
  });
}
// Unsaved project changes: ask before anything replaces the board. Resolves true when it is fine to go on.
export async function settleUnsaved() {
  if (!state.project || !state.dirty) return true;
  const r = await askSave(state.project.name);
  if (r === 'cancel') return false;
  if (r === 'save') { await saveCurrent(); if (state.dirty) return false; } // the save failed; stay put
  return true;
}
// Closing the tab or window with unsaved project changes brings up the browser's own "leave?" question.
window.addEventListener('beforeunload', (e) => { if (state.project && state.dirty) { e.preventDefault(); e.returnValue = ''; } });

// ---------- wiring ----------
btn.addEventListener('click', () => togglePanel());
$('#projects-close').addEventListener('click', () => togglePanel(false));
bus.on('project', () => {
  const b = $('#board-name'); const dot = $('#proj-dot');
  if (dot) { dot.hidden = !(state.project && state.dirty); dot.title = 'Unsaved changes'; }
  if (b && state.project) b.textContent = state.project.name;
  if (!panel.hidden) render();
});
$('#projects-root-btn')?.addEventListener('click', async () => {
  const v = $('#projects-root').value.trim(); if (!v) return;
  try { listing = await api.projectsRoot(v); toast('Projects folder updated.', 'ok'); render(); } catch (e) { toast(e.message, 'err'); }
});
export function initProjects() {
  api.projects().then((l) => { listing = l; const inp = $('#projects-root'); if (inp) inp.value = l.root || ''; }).catch(() => {});
  if (state.project) { state.project.savedHash ||= boardHash(); bus.emit('project'); }
}
