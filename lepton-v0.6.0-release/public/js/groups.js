// Groups: a labelled, dim panel that wraps a set of nodes and follows their bounds.
import { state, bus, save, uid, select, getPorts, NODE_TYPES } from './state.js';
import { nodeEl, renderEdges } from './canvas.js';

const layer = document.getElementById('groups');

export const GROUP_COLORS = [
  { id: 'graphite', fill: '#1d1d1f', line: '#3a3a3d', text: '#c9c9cc' },
  { id: 'slate', fill: '#1c2129', line: '#34404f', text: '#b9c6d6' },
  { id: 'moss', fill: '#1c241d', line: '#354a38', text: '#b7cbb9' },
  { id: 'sand', fill: '#26221a', line: '#4d4331', text: '#d3c7ad' },
  { id: 'rust', fill: '#281e1b', line: '#563a32', text: '#d9b8ad' },
  { id: 'plum', fill: '#241d29', line: '#4a3a54', text: '#cbb9d6' },
  { id: 'teal', fill: '#192526', line: '#2f4a4b', text: '#aecbcb' },
  { id: 'navy', fill: '#1a1e2b', line: '#333c58', text: '#b4bcd9' },
];
const PAD = 22, PAD_TOP = 22;
const CARD_W = 260; // a collapsed group's card

export function groupOf(nodeId) {
  return Object.values(state.groups).find((g) => g.nodeIds.includes(nodeId)) || null;
}
export function createGroup(nodeIds, label = 'Group') {
  const ids = [...new Set(nodeIds)].filter((id) => state.nodes[id]);
  if (!ids.length) return null;
  // A node belongs to at most one group.
  for (const g of Object.values(state.groups)) g.nodeIds = g.nodeIds.filter((id) => !ids.includes(id));
  const used = Object.values(state.groups).map((g) => g.color);
  const color = (GROUP_COLORS.find((c) => !used.includes(c.id)) || GROUP_COLORS[0]).id;
  const g = { id: uid(), label, color, nodeIds: ids };
  state.groups[g.id] = g;
  pruneEmpty();
  state.selGroup = g.id;
  save(); renderGroups();
  return g;
}
export function removeGroup(id) {
  delete state.groups[id];
  hiddenSig = '§';
  if (state.selGroup === id) state.selGroup = null;
  save(); renderGroups();
}
export function addToGroup(groupId, nodeIds) {
  const g = state.groups[groupId]; if (!g) return;
  if (g.collapsed) g.collapsed = false; // a node dropped in opens the folder so you can see where it went
  for (const other of Object.values(state.groups)) if (other !== g) other.nodeIds = other.nodeIds.filter((id) => !nodeIds.includes(id));
  for (const id of nodeIds) if (state.nodes[id] && !g.nodeIds.includes(id)) g.nodeIds.push(id);
  pruneEmpty(); save(); renderGroups();
}
export function removeFromGroup(nodeIds) {
  for (const g of Object.values(state.groups)) g.nodeIds = g.nodeIds.filter((id) => !nodeIds.includes(id));
  pruneEmpty(); save(); renderGroups();
}
function pruneEmpty() {
  for (const g of Object.values(state.groups)) if (!g.nodeIds.filter((id) => state.nodes[id]).length) { delete state.groups[g.id]; if (state.selGroup === g.id) state.selGroup = null; }
}
export function selectGroup(id) {
  state.selGroup = id;
  if (id) select(state.groups[id]?.nodeIds || []);
  renderGroups();
}

// Collapsing: the nodes hide and a small card stands in for them. Connections to the inside attach to the card.
export const collapsedGroupOf = (nodeId) => { const g = groupOf(nodeId); return g && g.collapsed ? g : null; };
export function setCollapsed(id, v) {
  const g = state.groups[id]; if (!g) return;
  g.collapsed = !!v;
  if (v) for (const nid of g.nodeIds) state.sel.delete(nid);
  save(); renderGroups(); renderEdges(); bus.emit('selection'); bus.emit('groups:list');
}
export const toggleCollapsed = (id) => setCollapsed(id, !state.groups[id]?.collapsed);
const TYPE_LABEL = { text: 'Prompt', image: 'Image', video: 'Video', audio: 'Audio', media: 'Media', any: 'Media', skill: 'Skill' };
// Which port types the inside offers, each direction, so the card can show one proxy port per type.
function proxyTypes(g) {
  const ins = [], outs = [];
  for (const id of g.nodeIds) { const n = state.nodes[id]; if (!n) continue; const p = getPorts(n); for (const x of p.inputs) if (!ins.includes(x.type)) ins.push(x.type); for (const x of p.outputs) if (!outs.includes(x.type)) outs.push(x.type); }
  return { ins, outs };
}
// The inside ports a connection to the card could mean: `dir` is the side being looked for ('in' or 'out').
export function innerPorts(g, dir, type) {
  const out = [];
  for (const id of g.nodeIds) {
    const n = state.nodes[id]; if (!n) continue;
    // Name each option so twins can be told apart: a custom title, else a Media node's file name, else the node type.
    const name = (n.data.title && n.data.title !== NODE_TYPES[n.type].title) ? n.data.title : n.type === 'media' && n.data.name ? n.data.name : `${NODE_TYPES[n.type].title}${n.data.model ? ` (${String(n.data.model).split(/[:/]/).pop()})` : ''}`;
    for (const p of (dir === 'in' ? getPorts(n).inputs : getPorts(n).outputs)) if (!type || p.type === type) out.push({ node: n.id, port: p.key, type: p.type, label: `${name} · ${p.label}`, multi: !!p.multi });
  }
  return out;
}

export function groupBounds(g) {
  if (g.collapsed) {
    let x0 = Infinity, y0 = Infinity;
    for (const id of g.nodeIds) { const n = state.nodes[id]; if (n) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); } }
    if (!isFinite(x0)) return null;
    const el = layer.querySelector(`.group[data-id="${g.id}"]`);
    return { x: x0 - PAD, y: y0 - PAD_TOP, w: CARD_W, h: el ? el.offsetHeight || 110 : 110 };
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of g.nodeIds) {
    const n = state.nodes[id]; if (!n) continue;
    const el = nodeEl(id); const w = el ? el.offsetWidth : 300, h = el ? el.offsetHeight : 200;
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + w); y1 = Math.max(y1, n.y + h);
  }
  if (!isFinite(x0)) return null;
  return { x: x0 - PAD, y: y0 - PAD_TOP, w: x1 - x0 + PAD * 2, h: y1 - y0 + PAD + PAD_TOP };
}
export function groupAt(wx, wy) {
  return Object.values(state.groups).find((g) => { const b = groupBounds(g); return b && wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h; }) || null;
}

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

export function renderGroups() {
  const seen = new Set();
  for (const g of Object.values(state.groups)) {
    const b = groupBounds(g);
    if (!b) continue;
    seen.add(g.id);
    let el = layer.querySelector(`.group[data-id="${g.id}"]`);
    if (!el) { el = buildGroup(g); layer.appendChild(el); }
    const c = GROUP_COLORS.find((x) => x.id === g.color) || GROUP_COLORS[0];
    el.style.left = b.x + 'px'; el.style.top = b.y + 'px'; el.style.width = b.w + 'px'; el.style.height = g.collapsed ? '' : b.h + 'px';
    el.style.setProperty('--g-fill', c.fill); el.style.setProperty('--g-line', c.line); el.style.setProperty('--g-text', c.text);
    el.classList.toggle('selected', state.selGroup === g.id);
    el.classList.toggle('collapsed', !!g.collapsed);
    const lab = el.querySelector('.group-name');
    if (document.activeElement !== lab && lab.textContent !== g.label) lab.textContent = g.label;
    el.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('on', s.dataset.color === g.color));
    const tgl = el.querySelector('.group-toggle'); if (tgl) tgl.textContent = g.collapsed ? 'Expand' : 'Collapse';
    if (g.collapsed) renderCard(g, el);
  }
  for (const el of [...layer.children]) if (!seen.has(el.dataset.id)) el.remove();
  hideCollapsedNodes();
}
// Nodes inside a collapsed group are kept but not shown.
let hiddenSig = '';
function hideCollapsedNodes() {
  const hidden = new Set();
  for (const g of Object.values(state.groups)) if (g.collapsed) for (const id of g.nodeIds) hidden.add(id);
  const s = [...hidden].sort().join(',');
  if (s === hiddenSig) return; hiddenSig = s;
  document.querySelectorAll('.node').forEach((el) => el.classList.toggle('in-collapsed', hidden.has(el.dataset.id)));
  renderEdges();
}
export const isHiddenNode = (id) => !!collapsedGroupOf(id);
function renderCard(g, el) {
  let card = el.querySelector('.group-card');
  if (!card) { card = h('div', 'group-card'); el.appendChild(card); }
  const { ins, outs } = proxyTypes(g);
  const kinds = {}; for (const id of g.nodeIds) { const n = state.nodes[id]; if (n) kinds[NODE_TYPES[n.type].title] = (kinds[NODE_TYPES[n.type].title] || 0) + 1; }
  const sig = `${g.label}|${g.nodeIds.length}|${ins.join()}|${outs.join()}|${Object.entries(kinds).join()}`;
  if (card.dataset.sig === sig) return; card.dataset.sig = sig;
  card.innerHTML = '';
  const head = h('div', 'gc-head');
  const icon = h('span', 'gc-icon'); icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l2 2.5h6a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19.5H6A2.5 2.5 0 0 1 3.5 17z"/></svg>';
  head.append(icon, h('span', 'gc-title', g.label), h('span', 'gc-count', `${g.nodeIds.length} node${g.nodeIds.length === 1 ? '' : 's'}`));
  const kindsEl = h('div', 'gc-kinds', Object.entries(kinds).map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(' · '));
  const ports = h('div', 'gc-ports');
  const colIn = h('div', 'gc-col in'), colOut = h('div', 'gc-col out');
  for (const t of ins) { const row = h('div', 'gc-row'); const p = h('span', 'gport'); p.dataset.dir = 'in'; p.dataset.type = t; p.dataset.group = g.id; p.title = `Connect into the group (${TYPE_LABEL[t] || t})`; row.append(p, h('span', 'gc-label', TYPE_LABEL[t] || t)); colIn.appendChild(row); }
  for (const t of outs) { const row = h('div', 'gc-row'); const p = h('span', 'gport'); p.dataset.dir = 'out'; p.dataset.type = t; p.dataset.group = g.id; p.title = `Connect out of the group (${TYPE_LABEL[t] || t})`; row.append(h('span', 'gc-label', TYPE_LABEL[t] || t), p); colOut.appendChild(row); }
  ports.append(colIn, colOut);
  card.append(head, kindsEl, ports, h('div', 'gc-hint', 'Click to open'));
}

function buildGroup(g) {
  const el = h('div', 'group'); el.dataset.id = g.id;
  const bar = h('div', 'group-bar');
  const name = h('span', 'group-name', g.label);
  name.title = 'Double-click to rename';
  name.addEventListener('dblclick', (e) => { e.stopPropagation(); name.setAttribute('contenteditable', 'true'); name.focus(); document.getSelection().selectAllChildren(name); });
  name.addEventListener('blur', () => { name.removeAttribute('contenteditable'); const v = name.textContent.trim() || 'Group'; name.textContent = v; if (state.groups[g.id]) { state.groups[g.id].label = v; save(); } });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); name.blur(); } e.stopPropagation(); });
  const tools = h('div', 'group-tools');
  const swatches = h('div', 'swatches');
  for (const c of GROUP_COLORS) {
    const s = h('button', 'swatch'); s.dataset.color = c.id; s.title = c.id[0].toUpperCase() + c.id.slice(1);
    s.style.background = c.line;
    s.addEventListener('click', (e) => { e.stopPropagation(); if (state.groups[g.id]) { state.groups[g.id].color = c.id; save(); renderGroups(); } });
    swatches.appendChild(s);
  }
  const toggle = h('button', 'group-btn group-toggle', g.collapsed ? 'Expand' : 'Collapse');
  toggle.title = 'Fold the group into a small card, or open it again';
  toggle.addEventListener('click', (e) => { e.stopPropagation(); toggleCollapsed(g.id); });
  const ungroup = h('button', 'group-btn', 'Ungroup');
  ungroup.title = 'Remove the group, keep the nodes';
  ungroup.addEventListener('click', (e) => { e.stopPropagation(); removeGroup(g.id); bus.emit('toast', { msg: 'Ungrouped.' }); });
  tools.append(swatches, toggle, ungroup);
  bar.append(name, tools);
  el.appendChild(bar);
  return el;
}

// Keep the label readable: it is counter-scaled against the canvas zoom.
let lastInv = '';
bus.on('view', () => { const v = (1 / state.view.z).toFixed(4); if (v !== lastInv) { lastInv = v; layer.style.setProperty('--inv', v); } });
// Sidebar listing: emitted whenever the set of groups or their labels/colours change.
let lastSig = '';
function sig() { return Object.values(state.groups).map((g) => `${g.id}|${g.label}|${g.color}|${g.nodeIds.length}|${g.collapsed ? 1 : 0}`).join(';'); }
bus.on('groups:render', () => { const n = sig(); if (n !== lastSig) { lastSig = n; bus.emit('groups:list'); } });
bus.on('node:remove', () => { pruneEmpty(); renderGroups(); });
bus.on('groups:render', renderGroups);
bus.on('selection', () => { if (state.selGroup && !state.sel.size) state.selGroup = null; renderGroups(); });
