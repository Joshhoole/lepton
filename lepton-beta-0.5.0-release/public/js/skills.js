// Skills: installed folders of knowledge (SKILL.md + reference files). The sidebar installs, edits and removes them;
// a Skill node puts one on the canvas; LLM nodes read whatever skills are connected to their Skills input.
import { state, bus, save, addNode, select } from './state.js';
import { nodeEl, renderEdges, viewportCenterWorld } from './canvas.js';
import { api } from './api.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };
const btn = (cls, html, title, fn) => { const b = el('button', cls); b.type = 'button'; b.innerHTML = html; if (title) b.title = title; b.addEventListener('click', (e) => { e.stopPropagation(); fn(e); }); return b; };
const toast = (msg, kind) => bus.emit('toast', { msg, kind });
export const ICON = {
  skill: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 18A2.5 2.5 0 0 1 6.5 15.5H19"/><path d="M9 7.5h6M9 11h4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 8.5l3 3"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l2 2.5h6a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19.5H6A2.5 2.5 0 0 1 3.5 17z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/></svg>',
};
const TEXT_EXT = /\.(md|markdown|txt|json|ya?ml|csv|xml|html|rst|toml)$/i;
const fmtSize = (chars) => (chars >= 1000 ? `${Math.round(chars / 1000)}k` : String(chars)) + ' characters';
const sizeNote = (chars) => (chars > 400000 ? 'very large: may not fit a request' : chars > 150000 ? 'large' : '');

// ---------- installed list ----------
export let installed = []; let root = '';
let loaded = null; let ready = false; // ready: the installed list has arrived at least once
export async function loadSkills(force = false) {
  if (loaded && !force) return loaded;
  loaded = api.skills().then((r) => { installed = r.skills || []; root = r.root || ''; ready = true; const inp = $('#skills-root'); if (inp && document.activeElement !== inp) inp.value = root; bus.emit('skills:changed'); return installed; }).catch(() => { installed = []; return installed; });
  return loaded;
}
export const skillById = (id) => installed.find((s) => s.id === id) || null;

// ---------- installing ----------
async function readText(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsText(file); }); }
// Files from a drop, a picker or a folder picker. Zips go up whole; everything else as text with its relative path.
export async function installFiles(files, { at = null, quiet = false } = {}) {
  const list = [...files];
  const results = [];
  const zips = list.filter((f) => /\.zip$/i.test(f.name));
  for (const z of zips) {
    try { results.push(await api.skillInstallZip(await z.arrayBuffer())); } catch (e) { toast(`${z.name}: ${e.message}`, 'err'); }
  }
  const rest = list.filter((f) => !/\.zip$/i.test(f.name));
  if (rest.length) {
    const texts = [];
    for (const f of rest) { const p = f.webkitRelativePath || f.name; if (TEXT_EXT.test(p) && f.size <= 2 * 1024 * 1024) texts.push({ path: p, text: await readText(f) }); }
    // A picked folder may hold several skills (one per SKILL.md): install each on its own.
    const groups = new Map();
    for (const t of texts) {
      const m = /^(.*?)SKILL\.md$/i.exec(t.path);
      if (m) groups.set(m[1], groups.get(m[1]) || []);
    }
    if (!groups.size) { if (texts.length) try { results.push(await api.skillInstall(texts)); } catch (e) { toast(e.message, 'err'); } }
    else for (const [prefix] of groups) { const mine = texts.filter((t) => t.path.startsWith(prefix) && ![...groups.keys()].some((o) => o !== prefix && o.startsWith(prefix) && t.path.startsWith(o))); try { results.push(await api.skillInstall(mine)); } catch (e) { toast(`${prefix || 'skill'}: ${e.message}`, 'err'); } }
  }
  if (!results.length) return [];
  await loadSkills(true);
  for (const r of results) {
    if (!quiet) toast(r.updated ? `Updated "${r.skill.name}"${r.skipped.length ? ` · ${r.skipped.length} non-text file${r.skipped.length === 1 ? '' : 's'} skipped` : ''}. Files you had added are kept.` : `Installed "${r.skill.name}"${r.skipped.length ? ` · ${r.skipped.length} non-text file${r.skipped.length === 1 ? '' : 's'} skipped` : ''}.`, 'ok');
    if (at) addSkillNode(r.skill, at); else refreshNodesFor(r.skill.id);
  }
  renderList();
  return results.map((r) => r.skill);
}
function pick(accept, directory, cb) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; if (accept) inp.accept = accept; if (directory) inp.webkitdirectory = true;
  inp.addEventListener('change', () => { if (inp.files.length) cb([...inp.files]); });
  inp.click();
}

// ---------- skill nodes ----------
export function addSkillNode(skill, at) {
  const p = at || (() => { const c = viewportCenterWorld(); return { x: c.x - 150, y: c.y - 60 }; })();
  const n = addNode('skill', p.x, p.y, { skill: skill.id, name: skill.name, description: skill.description, chars: skill.chars, files: skill.files.length, title: skill.name });
  select([n.id]); $('#empty').hidden = true;
  return n;
}
export function buildSkillNode(node, body) {
  body.classList.add('skill-body');
  renderSkillNode(node, body);
  // The installed list arrives after the board is drawn: render again once it is here.
  loadSkills().then(() => renderSkillNode(node));
}
function renderSkillNode(node, body) {
  body = body || nodeEl(node.id)?.querySelector('.skill-body'); if (!body) return;
  const s = skillById(node.data.skill);
  if (s) {
    // The node is named after the skill unless the user renamed it.
    const t = nodeEl(node.id)?.querySelector('.node-title');
    if (!node.data.title || node.data.title === NODE_TITLE_DEFAULT || node.data.title === node.data.name) { node.data.title = s.name; if (t && !t.hasAttribute('contenteditable')) t.textContent = s.name; }
    node.data.name = s.name; node.data.description = s.description; node.data.chars = s.chars; node.data.files = s.files.length;
  }
  body.innerHTML = '';
  const missing = ready && !s;
  if (node.data.description) body.appendChild(el('div', 'skill-desc', node.data.description));
  const meta = el('div', 'skill-meta');
  if (!ready && !s) meta.innerHTML = `${ICON.file}<span>Checking installed skills…</span>`;
  else if (missing) { meta.classList.add('bad'); meta.innerHTML = `${ICON.warn}<span>Not installed on this computer</span>`; }
  else { const note = sizeNote(node.data.chars || 0); meta.innerHTML = `${ICON.file}<span>${node.data.files || 1} file${node.data.files === 1 ? '' : 's'} · ${fmtSize(node.data.chars || 0)}${note ? ` · ${note}` : ''}</span>`; if (note) meta.classList.add(node.data.chars > 400000 ? 'bad' : 'warn'); }
  body.appendChild(meta);
  const row = el('div', 'skill-actions');
  if (missing) row.appendChild(btn('btn small', `${ICON.plus}<span>Install…</span>`, 'Install this skill from a .zip, .md or folder', () => pick('.zip,.md,.markdown,.txt', false, (fs) => installFiles(fs))));
  else if (!ready) { /* nothing to offer until the list is here */ }
  else row.appendChild(btn('btn small', `${ICON.edit}<span>Edit</span>`, 'Edit the skill text or add files', () => { toggleSkillsPanel(true); if (s) openEditor(s.id); }));
  row.appendChild(el('span', 'skill-hint', 'Connect to an LLM node’s Skills input'));
  body.appendChild(row);
}
const NODE_TITLE_DEFAULT = 'Skill';
function refreshNodesFor(id) { for (const n of Object.values(state.nodes)) if (n.type === 'skill' && (!id || n.data.skill === id)) renderSkillNode(n); renderEdges(); }

// ---------- sidebar ----------
const panel = $('#skills-panel'), list = $('#skills-list'), pbtn = $('#btn-skills'), editor = $('#skills-editor'), toolsBar = $('#skills-tools');
export function toggleSkillsPanel(force) {
  const open = force === undefined ? panel.hidden : force;
  if (open) bus.emit('sidebars:close', 'skills');
  panel.hidden = !open; pbtn.classList.toggle('on', open);
  if (open) { closeEditor(); loadSkills(true).then(renderList); }
}
function renderList() {
  if (panel.hidden || !editor.hidden) return;
  list.innerHTML = '';
  if (toolsBar && !toolsBar.childElementCount) {
    // Pinned above the list, so they stay put however far you scroll.
    toolsBar.append(
      btn('btn small', `${ICON.plus}<span>Install…</span>`, 'A .zip or .md file (several at once is fine)', () => pick('.zip,.md,.markdown,.txt', false, (fs) => installFiles(fs))),
      btn('btn small', `${ICON.file}<span>Folder…</span>`, 'A skill folder with SKILL.md inside', () => pick('', true, (fs) => installFiles(fs))),
      btn('btn small', `${ICON.edit}<span>New skill</span>`, 'Write a skill here', () => openEditor(null)),
      btn('icon-btn skills-reveal', ICON.folder, 'Show the skills folder. Anything you drop in there is installed.', () => api.skillReveal('').catch((e) => toast(e.message, 'err'))),
    );
  }
  if (toolsBar) toolsBar.hidden = false;
  if (!installed.length) { list.appendChild(el('div', 'sidebar-empty', 'No skills yet. Drop a skill .zip, SKILL.md or folder onto the canvas, or use Install.')); return; }
  for (const s of installed) {
    const row = el('div', 'sidebar-item preset skill-row'); row.title = `${s.name}${s.description ? `\n${s.description}` : ''}`;
    const icon = el('span', 'preset-icon'); icon.innerHTML = ICON.skill;
    const bodyEl = el('span', 'preset-body');
    bodyEl.append(el('span', 'sidebar-name skill-name', s.name), el('span', 'skill-size', `${s.files.length} file${s.files.length === 1 ? '' : 's'} · ${fmtSize(s.chars)}${s.version ? ` · v${s.version}` : ''}`));
    const acts = el('span', 'skill-row-actions');
    acts.append(
      btn('icon-btn', ICON.plus, 'Add to board', () => { addSkillNode(s); toast(`Added "${s.name}". Connect it to an LLM node.`, 'ok'); }),
      btn('icon-btn', ICON.edit, 'Edit', () => openEditor(s.id)),
      btn('icon-btn', ICON.more, 'More', (e) => { const r = e.currentTarget.getBoundingClientRect(); bus.emit('ctx:show', { x: r.left, y: r.bottom + 4, items: [
        { label: 'Show folder', run: () => api.skillReveal(s.id).catch((err) => toast(err.message, 'err')) },
        { label: 'Update from file…', run: () => pick('.zip,.md,.markdown,.txt', false, (fs) => installFiles(fs)) },
        '-',
        { label: 'Remove skill…', danger: true, run: () => bus.emit('ctx:show', { x: r.left, y: r.bottom + 4, items: [{ label: `Remove "${s.name}" from this computer`, danger: true, run: async () => { try { await api.skillRemove(s.id); await loadSkills(true); renderList(); refreshNodesFor(s.id); toast('Removed.', ''); } catch (err) { toast(err.message, 'err'); } } }, { label: 'Cancel', run: () => {} }] }) },
      ] }); }),
    );
    row.append(icon, bodyEl, acts);
    row.addEventListener('dblclick', () => addSkillNode(s));
    list.appendChild(row);
  }
}

// ---------- editor: the skill's own text plus its reference files ----------
let editing = null; // { id, files } or { id: null }
async function openEditor(id) {
  let s = null;
  if (id) { try { s = await api.skillRead(id); } catch (e) { toast(e.message, 'err'); return; } }
  editing = { id, files: s ? s.files : [] };
  list.hidden = true; if (toolsBar) toolsBar.hidden = true; editor.hidden = false; editor.innerHTML = '';
  const field = (label, input) => { const w = el('label', 'skill-field'); w.append(el('span', '', label), input); return w; };
  const name = el('input', 'text-input'); name.placeholder = 'Skill name'; name.value = s ? s.name : ''; name.spellcheck = false;
  const desc = el('input', 'text-input'); desc.placeholder = 'One line on what it knows and when to use it'; desc.value = s ? s.description : ''; desc.spellcheck = false;
  const body = el('textarea', 'textarea skill-editor-body'); body.placeholder = 'The skill itself: instructions, rules, knowledge, examples. Markdown is fine.'; body.value = s ? s.body : ''; body.spellcheck = false;
  const head = el('div', 'skills-editor-head'); head.append(el('h3', '', s ? 'Edit skill' : 'New skill'), btn('icon-btn', ICON.x, 'Close', closeEditor));
  editor.append(head, field('Name', name), field('Description', desc), field('Instructions (SKILL.md)', body));
  // Reference files: the "more information" behind the skill.
  const filesBox = el('div', 'skill-files'); const filesHead = el('div', 'skill-files-head'); filesHead.append(el('span', '', 'Reference files'));
  const renderFiles = () => {
    filesBox.innerHTML = '';
    const refs = (editing.files || []).filter((f) => f.path !== 'SKILL.md');
    if (!refs.length) filesBox.appendChild(el('div', 'skill-files-empty', 'None yet. Add .md, .txt, .json, .csv or .yaml files: notes, examples, glossaries, past work.'));
    for (const f of refs) {
      const row = el('div', 'skill-file');
      row.append(el('span', `skill-file-name ${f.text ? '' : 'dim'}`, f.path), el('span', 'skill-file-size', `${Math.round(f.bytes / 1000)}k${f.text ? '' : ' · not text, not sent'}`));
      if (editing.id) row.appendChild(btn('icon-btn', ICON.x, 'Remove this file', async () => { try { const r = await api.skillFile({ id: editing.id, path: f.path, remove: true }); editing.files = r.files; renderFiles(); } catch (e) { toast(e.message, 'err'); } }));
      filesBox.appendChild(row);
    }
  };
  const addFiles = btn('btn small', `${ICON.plus}<span>Add files…</span>`, 'Text files only', () => pick('.md,.markdown,.txt,.json,.yaml,.yml,.csv,.xml,.html,.rst,.toml', false, async (fs) => {
    if (!editing.id) { toast('Save the skill first, then add files.'); return; }
    for (const f of fs) { try { const r = await api.skillFile({ id: editing.id, path: `references/${f.name}`, text: await readText(f) }); editing.files = r.files; } catch (e) { toast(`${f.name}: ${e.message}`, 'err'); } }
    renderFiles(); toast(`Added ${fs.length} file${fs.length === 1 ? '' : 's'}.`, 'ok');
  }));
  filesHead.appendChild(addFiles);
  editor.append(filesHead, filesBox); renderFiles();
  const foot = el('div', 'skills-editor-foot');
  const saveBtn = btn('btn primary', 'Save', '', async () => {
    const nm = name.value.trim(); if (!nm) { toast('Give the skill a name.'); name.focus(); return; }
    try {
      if (editing.id) { await api.skillUpdate({ id: editing.id, name: nm, description: desc.value.trim(), body: body.value }); toast('Saved.', 'ok'); }
      else {
        const r = await api.skillInstall([{ path: 'SKILL.md', text: `---\nname: ${nm}\ndescription: ${desc.value.trim().replace(/\n/g, ' ')}\n---\n\n${body.value.trim()}\n` }], false);
        editing.id = r.skill.id; editing.files = r.skill.files; head.querySelector('h3').textContent = 'Edit skill'; renderFiles(); toast(`Created "${r.skill.name}". You can add reference files now.`, 'ok');
      }
      await loadSkills(true); refreshNodesFor(editing.id);
      if (editing.id && (editing.files || []).length <= 1 && !body.value.trim()) return;
    } catch (e) { toast(e.message, 'err'); }
  });
  foot.append(saveBtn, btn('btn', 'Done', '', closeEditor));
  editor.appendChild(foot);
  setTimeout(() => (s ? body : name).focus(), 30);
}
function closeEditor() { editing = null; editor.hidden = true; editor.innerHTML = ''; list.hidden = false; if (toolsBar) toolsBar.hidden = false; renderList(); }

// ---------- wiring ----------
pbtn?.addEventListener('click', () => toggleSkillsPanel());
$('#skills-close')?.addEventListener('click', () => toggleSkillsPanel(false));
$('#skills-root-btn')?.addEventListener('click', async () => {
  const v = $('#skills-root').value.trim(); if (!v) return;
  try { const r = await api.skillsRoot(v); installed = r.skills || []; root = r.root; toast('Skills folder updated.', 'ok'); renderList(); refreshNodesFor(); } catch (e) { toast(e.message, 'err'); }
});
$('#skills-root-reveal')?.addEventListener('click', () => api.skillReveal('').catch((e) => toast(e.message, 'err')));
bus.on('sidebars:close', (except) => { if (except !== 'skills' && !panel.hidden) { panel.hidden = true; pbtn.classList.remove('on'); } });
// Dropping a skill file or folder onto the canvas installs it and puts its node where it landed.
bus.on('skills:drop', ({ files, x, y }) => installFiles(files, { at: { x, y } }));
bus.on('node:add', (n) => { if (n.type === 'skill' && loaded) setTimeout(() => renderSkillNode(n), 0); });
bus.on('skills:changed', () => refreshNodesFor());
loadSkills();
