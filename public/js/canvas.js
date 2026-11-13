// Viewport: pan, zoom, node dragging, port connections, edge drawing, marquee selection, file drop.
import { state, bus, addEdge, removeEdge, portDef, getPorts, canConnect, select, clearSelection, save, incomingRaw, insertionPlan, insertNodeOnEdge, NODE_TYPES } from './state.js';
import { serialize, instantiate } from './clipboard.js';
import { collapsedGroupOf, innerPorts, setCollapsed, groupBounds, contentBounds, setGroupBox, boxesCarriedBy, shiftBoxes } from './groups.js';
import { beginSnap, snapMove, endSnap, snapToGrid, toGrid } from './snap.js';

const vp = document.getElementById('viewport');
const world = document.getElementById('world');
const edgeLayer = document.getElementById('edge-layer');
const draft = document.getElementById('edge-draft');
const marqueeEl = document.getElementById('marquee');
const dropHint = document.getElementById('drop-hint');

export const MIN_Z = 0.15, MAX_Z = 3;
let spaceDown = false;
let edgeFrame = 0;

// ---------- view transform ----------
let lastGrid = null;
const grid = document.getElementById('grid'); // the dot grid: a sheet 96px bigger than the window on every side
const GRID_PAD = 96;
const wrap = (v, g) => ((v % g) + g) % g;
// Below this zoom the writing in a node is too small to read, so nodes show only their name and their pictures
// (styles.css, "Far away"). Nothing moves or changes size; the browser just has far less to draw.
const FAR_Z = 0.3;
let far = null;
export function applyView() {
  const { x, y, z } = state.view;
  world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
  if ((z < FAR_Z) !== far) { far = z < FAR_Z; vp.classList.toggle('far', far); }
  // Grid: double the spacing whenever dots would get closer than ~14px, and fade it out below 40% zoom.
  let g = 24 * z; let alpha = 1;
  while (g < 14) g *= 2;
  if (z < 0.4) alpha = Math.max(0, (z - 0.2) / 0.2);
  const key = `${g.toFixed(2)}|${alpha.toFixed(2)}`;
  if (key !== lastGrid) { lastGrid = key; grid.style.backgroundSize = `${g}px ${g}px`; grid.style.opacity = String(alpha); grid.style.display = alpha > 0 ? '' : 'none'; }
  // The sheet slides by the remainder only, so a dot always sits where the board's own 24px grid puts it.
  if (alpha > 0) grid.style.transform = `translate(${wrap(x + GRID_PAD, g)}px, ${wrap(y + GRID_PAD, g)}px)`;
  bus.emit('view');
  save(false, true);
}
export function screenToWorld(sx, sy) {
  const r = vp.getBoundingClientRect();
  return { x: (sx - r.left - state.view.x) / state.view.z, y: (sy - r.top - state.view.y) / state.view.z };
}
export function viewportCenterWorld() {
  const r = vp.getBoundingClientRect();
  return screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
}
export function zoomAt(sx, sy, factor) {
  const r = vp.getBoundingClientRect();
  const px = sx - r.left, py = sy - r.top;
  const z0 = state.view.z;
  const z1 = Math.min(MAX_Z, Math.max(MIN_Z, z0 * factor));
  state.view.x = px - (px - state.view.x) * (z1 / z0);
  state.view.y = py - (py - state.view.y) * (z1 / z0);
  state.view.z = z1;
  applyView();
}
export function zoomTo(z) {
  const r = vp.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, z / state.view.z);
}
export function fitToView(pad = 80) {
  const nodes = Object.values(state.nodes);
  if (!nodes.length) { state.view = { x: 0, y: 0, z: 1 }; applyView(); return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    const el = nodeEl(n.id); const w = el ? el.offsetWidth : 300, h = el ? el.offsetHeight : 200;
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + w); y1 = Math.max(y1, n.y + h);
  }
  const r = vp.getBoundingClientRect();
  const z = Math.min(MAX_Z, Math.max(MIN_Z, Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0), 1.25)));
  state.view.z = z;
  state.view.x = (r.width - (x1 - x0) * z) / 2 - x0 * z;
  state.view.y = (r.height - (y1 - y0) * z) / 2 - y0 * z;
  applyView();
}

// A node's element, remembered. Searching the page for it each time is what made strand and group redraws slow down
// with the square of the board's size (32 ms just to find 648 nodes; this is a few hundredths).
const nodeEls = new Map();
export function nodeEl(id) {
  let el = nodeEls.get(id);
  if (el && el.isConnected && el.dataset.id === id) return el;
  el = document.querySelector(`.node[data-id="${id}"]`);
  if (el) nodeEls.set(id, el); else nodeEls.delete(id);
  return el;
}

// Glide the view so a world-space rectangle fills the viewport (never zooming past 100%).
let animFrame = 0;
export function animateToRect(rect, pad = 90, maxZ = 1, insetLeft = 0) {
  const r = vp.getBoundingClientRect();
  const availW = r.width - insetLeft;
  const z = Math.min(maxZ, Math.max(MIN_Z, Math.min((availW - pad * 2) / rect.w, (r.height - pad * 2) / rect.h)));
  const target = { z, x: insetLeft + (availW - rect.w * z) / 2 - rect.x * z, y: (r.height - rect.h * z) / 2 - rect.y * z };
  const from = { ...state.view }; const t0 = performance.now(); const dur = 380;
  cancelAnimationFrame(animFrame);
  const step = (now) => {
    const t = Math.min(1, (now - t0) / dur); const e = 1 - Math.pow(1 - t, 3);
    state.view.x = from.x + (target.x - from.x) * e; state.view.y = from.y + (target.y - from.y) * e; state.view.z = from.z + (target.z - from.z) * e;
    applyView();
    if (t < 1) animFrame = requestAnimationFrame(step);
  };
  animFrame = requestAnimationFrame(step);
}

// ---------- port geometry ----------
function portCenter(nodeId, portKey) {
  const g = collapsedGroupOf(nodeId);
  let el;
  if (g) {
    const n = state.nodes[nodeId]; const def = n && portDef(n, portKey); if (!def) return null;
    const dir = getPorts(n).inputs.some((p) => p.key === portKey) ? 'in' : 'out';
    el = document.querySelector(`.group[data-id="${g.id}"] .gport[data-dir="${dir}"][data-type="${def.type}"]`);
  } else el = document.querySelector(`.node[data-id="${nodeId}"] .port[data-port="${portKey}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
}
function bezier(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

// ---------- edges ----------
// Strands are redrawn on every pointer move while a node is dragged, so this is the hottest path in the app. Two rules
// keep it cheap on a big board:
//   1. Measure everything first, then change the page. Reading a port's position right after changing a path makes
//      the browser lay the whole board out again, once per strand (measured: 340 ms for 195 strands, against 3 ms).
//   2. Change only what is different. A strand that did not move and a port whose state did not flip are left alone.
const edgeEls = new Map(); // edge id → its <g>
function edgeEl(e) {
  let g = edgeEls.get(e.id);
  if (g && g.isConnected) return g;
  g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.dataset.edge = e.id;
  const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  hit.setAttribute('class', 'edge hit');
  const vis = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  vis.setAttribute('class', `edge type-${e.type}`);
  g.append(hit, vis);
  edgeLayer.appendChild(g);
  hit.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); state.sel.clear(); state.selEdge = e.id; bus.emit('selection'); });
  hit.addEventListener('pointerenter', () => vis.classList.add('hover'));
  hit.addEventListener('pointerleave', () => vis.classList.remove('hover'));
  hit.addEventListener('dblclick', (ev) => { ev.stopPropagation(); removeEdge(e.id); });
  edgeEls.set(e.id, g);
  return g;
}
export function renderEdges() {
  cancelAnimationFrame(edgeFrame);
  edgeFrame = requestAnimationFrame(() => {
    const edges = Object.values(state.edges);
    // New strands get their elements, and strands that are gone lose theirs, before anything is measured.
    const seen = new Set();
    for (const e of edges) { seen.add(e.id); edgeEl(e); }
    for (const g of [...edgeLayer.children]) if (!seen.has(g.dataset.edge)) { edgeEls.delete(g.dataset.edge); g.remove(); }

    // Measure.
    const vr = vp.getBoundingClientRect(); const { x: vx, y: vy, z } = state.view;
    const centre = (el) => { const r = el.getBoundingClientRect(); return { x: (r.left + r.width / 2 - vr.left - vx) / z, y: (r.top + r.height / 2 - vr.top - vy) / z }; };
    const roots = new Map();
    const portOf = (id, key) => { let root = roots.get(id); if (root === undefined) { root = nodeEl(id); roots.set(id, root); } return root ? root.querySelector(`.port[data-port="${key}"]`) : null; };
    const gportOf = (g, dir, type) => document.querySelector(`.group[data-id="${g.id}"] .gport[data-dir="${dir}"][data-type="${type}"]`);
    const on = new Set(); // every port, port row and group port that has a strand
    const folded = []; // proxy ports on folded groups that have one
    const plan = [];
    for (const e of edges) {
      const ga = collapsedGroupOf(e.from), gb = collapsedGroupOf(e.to);
      const from = state.nodes[e.from], to = state.nodes[e.to];
      const pa = portOf(e.from, e.fromPort), pb = portOf(e.to, e.toPort);
      if (pa) on.add(pa);
      if (pb) { on.add(pb); const row = pb.closest('.port-row'); if (row) on.add(row); }
      const defA = ga && from ? portDef(from, e.fromPort) : null, defB = gb && to ? portDef(to, e.toPort) : null;
      // A folded group shows one proxy port per kind; a strand to the inside attaches there.
      const ea = ga ? (defA ? gportOf(ga, getPorts(from).inputs.some((p) => p.key === e.fromPort) ? 'in' : 'out', defA.type) : null) : pa;
      const eb = gb ? (defB ? gportOf(gb, getPorts(to).inputs.some((p) => p.key === e.toPort) ? 'in' : 'out', defB.type) : null) : pb;
      if (ga !== gb) { if (ga) folded.push([ga, 'out', e.type]); if (gb && defB) folded.push([gb, 'in', defB.type]); }
      const hidden = (ga && ga === gb) || !ea || !eb; // both ends folded away together, or an end that is not on the page
      plan.push({ g: edgeEls.get(e.id), d: hidden ? null : bezier(centre(ea), centre(eb)), selected: state.selEdge === e.id, flowing: !!(to && to.data.status === 'running') });
    }

    // Change.
    for (const p of plan) {
      const g = p.g; const show = p.d ? '' : 'none';
      if (g.style.display !== show) g.style.display = show;
      if (p.d && g._d !== p.d) { g._d = p.d; g.children[0].setAttribute('d', p.d); g.children[1].setAttribute('d', p.d); }
      const vis = g.children[1];
      if (vis.classList.contains('selected') !== p.selected) vis.classList.toggle('selected', p.selected);
      if (vis.classList.contains('flowing') !== p.flowing) vis.classList.toggle('flowing', p.flowing);
    }
    bus.emit('groups:render'); // may rebuild a folded group's card, so its proxy ports are looked up after it
    for (const [g, dir, type] of folded) { const gp = gportOf(g, dir, type); if (gp) on.add(gp); }
    for (const el of document.querySelectorAll('.port.connected, .port-row.in.connected, .gport.connected')) if (!on.has(el)) el.classList.remove('connected');
    for (const el of on) if (!el.classList.contains('connected')) el.classList.add('connected');
  });
}

// ---------- pointer interactions ----------
let mode = null; // 'pan' | 'drag' | 'connect' | 'marquee' | 'resize'
let start = null;

// A link in a title or a note (a.text-link, annotate.js) is not in this list: pressing one can be the start of dragging
// its node. Let go without moving and it was a click on the link.
const INTERACTIVE = 'input, select, textarea, button, .anno-tools, .port, .cmb-grip, .cmb-out, .thumb, .preview-item, .media-frame, [contenteditable], a:not(.text-link), .results, .disclosure, .ref-chip, .cmp-stage, .cmp-bar';

// A canvas tool (tools.js: scissors, pen) takes a plain left-drag before anything else. Space and ⌥ still pan.
// It is asked on the way down to what was pressed, so the pen draws over everything on the board: a node, a note, a
// title, and the text boxes, sliders and buttons inside them, none of which get the press while a tool is on.
let toolStart = null;
export function setCanvasTool(fn) { toolStart = fn; }
vp.addEventListener('pointerdown', (ev) => {
  toolTook = false;
  if (!toolStart || ev.button !== 0 || spaceDown || ev.altKey || !toolStart(ev)) return;
  toolTook = true; ev.stopPropagation();
  // The press is cancelled, so the focus stays where it was: whatever was being typed is finished here.
  const typed = document.activeElement; if (typed && typed !== vp && isTyping(typed)) typed.blur();
}, true);
vp.addEventListener('pointerdown', (ev) => {
  if (ev.button === 2) return; // context menu handled elsewhere
  // A press that starts a drag is cancelled, so the browser does not move the focus by itself. Whatever is being typed
  // (a name, a title, a note, a prompt) is finished here instead, unless the press is on that same node's own controls.
  // Otherwise the cursor stays in a text box while another node is dragged, and the next shortcut is typed into it.
  const typed = document.activeElement;
  if (typed && typed.matches && typed.matches('[contenteditable], .note-edit, textarea, input') && !typed.contains(ev.target)
    && !(ev.target.closest && ev.target.closest(INTERACTIVE) && typed.closest('.node') && typed.closest('.node') === ev.target.closest('.node'))) typed.blur();
  const target = ev.target;
  const portEl = target.closest && target.closest('.port');
  const nodeElm = target.closest && target.closest('.node');

  if (portEl && ev.button === 0) return startConnect(ev, portEl);
  const gport = target.closest && target.closest('.gport');
  if (gport && ev.button === 0) return startGroupConnect(ev, gport);
  const grip = nodeElm && target.closest && target.closest('.node-resize');
  if (grip && ev.button === 0) return startResize(ev, nodeElm, grip.dataset.corner);

  const groupElm = !nodeElm && target.closest && target.closest('.group');
  if (groupElm && ev.button === 0 && !spaceDown) {
    const corner = target.closest('.group-resize');
    if (corner) return startGroupResize(ev, groupElm.dataset.id, corner.dataset.corner);
    if (target.closest('button, [contenteditable]')) return;
    return startGroupDrag(ev, groupElm.dataset.id);
  }

  if (nodeElm && ev.button === 0 && !spaceDown) {
    if (target.closest(INTERACTIVE)) {
      // Clicking a control still selects the node, without starting a drag.
      const id = nodeElm.dataset.id;
      if (!state.sel.has(id)) select([id], ev.shiftKey);
      return;
    }
    return startDrag(ev, nodeElm);
  }

  if (ev.button === 1 || spaceDown || (ev.button === 0 && ev.altKey)) return startPan(ev);
  if (ev.button === 0) return startMarquee(ev);
});

function startPan(ev) {
  mode = 'pan';
  start = { x: ev.clientX, y: ev.clientY, vx: state.view.x, vy: state.view.y };
  vp.classList.add('panning');
  vp.setPointerCapture(ev.pointerId);
  ev.preventDefault();
}

function startDrag(ev, nodeElm) {
  const id = nodeElm.dataset.id;
  if (!state.sel.has(id)) select([id], ev.shiftKey);
  else if (ev.shiftKey) { state.sel.delete(id); bus.emit('selection'); return; }
  bringToFront(id);
  mode = 'drag';
  const ids = [...state.sel];
  // Holding ⌘ or ⌥ drags a copy away and leaves the original where it is (Ctrl on Windows and Linux).
  const dup = ev.altKey || ev.metaKey || (ev.ctrlKey && !IS_MAC);
  start = { x: ev.clientX, y: ev.clientY, ids, orig: ids.map((i) => ({ x: state.nodes[i].x, y: state.nodes[i].y })), moved: false, dup, anchor: ids.indexOf(id), link: !ev.shiftKey && !dup && ev.target.closest ? ev.target.closest('a.text-link') : null };
  vp.setPointerCapture(ev.pointerId);
  ev.preventDefault();
}
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// Corner grips scale a node; its picture scales with it.
const MIN_W = 160, MAX_W = 2400;
// The narrowest a node can be before its controls no longer fit: measured from the node itself, so it stays right
// when a node gains buttons. The node is collapsed for one measurement and put back before anything is painted.
export function minWidthOf(el) {
  const width = el.style.width;
  const tucked = [...el.querySelectorAll('.cmp-tools [hidden], .cmp-bar[hidden], .cmp-opacity[hidden]')]; // count controls that other modes show
  tucked.forEach((x) => { x.hidden = false; });
  const bar = el.querySelector(':scope > .anno-tools'); // floats above a note; it must not set how narrow the note can go
  if (bar) bar.style.display = 'none';
  el.style.width = '0px';
  const need = el.scrollWidth;
  el.style.width = width;
  if (bar) bar.style.display = '';
  tucked.forEach((x) => { x.hidden = true; });
  return Math.min(MAX_W, Math.max(MIN_W, Math.ceil(need) + 14));
}
// A node saved narrower than its controls allow is widened to fit.
export function clampWidth(node, el) {
  if (!node.w) return false;
  const min = minWidthOf(el);
  if (node.w >= min) return false;
  node.w = min; el.style.width = min + 'px';
  return true;
}
function startResize(ev, nodeElm, corner) {
  const id = nodeElm.dataset.id; const n = state.nodes[id]; if (!n) return;
  if (!state.sel.has(id)) select([id]);
  bringToFront(id);
  mode = 'resize';
  start = { x: ev.clientX, y: ev.clientY, id, corner, w: nodeElm.offsetWidth, h: nodeElm.offsetHeight, nx: n.x, ny: n.y, min: minWidthOf(nodeElm) };
  nodeElm.classList.add('dragging', 'sized');
  vp.classList.add('resizing'); vp.style.cursor = corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize';
  vp.setPointerCapture(ev.pointerId);
  ev.preventDefault();
}
function resizeTo(ev) {
  const n = state.nodes[start.id], el = nodeEl(start.id); if (!n || !el) return;
  const sx = start.corner.includes('w') ? -1 : 1, sy = start.corner.includes('n') ? -1 : 1;
  const dx = ((ev.clientX - start.x) / state.view.z) * sx, dy = ((ev.clientY - start.y) / state.view.z) * sy;
  // Follow whichever direction the pointer has travelled further in.
  const s = Math.abs(dx) >= Math.abs(dy) ? (start.w + dx) / start.w : (start.h + dy) / start.h;
  const w = Math.round(Math.max(start.min, Math.min(MAX_W, start.w * s)));
  nodeEl(start.id).classList.toggle('at-min', w <= start.min);
  n.w = w; el.style.width = w + 'px';
  if (sx < 0) n.x = Math.round(start.nx + start.w - w);
  if (sy < 0) n.y = Math.round(start.ny + start.h - el.offsetHeight);
  el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
  renderEdges();
}
// Pressing on a node or a group captures the pointer, so that a drag keeps following it wherever it goes. The browser
// then delivers the click and the double-click to the canvas instead of to whatever was under the pointer. A
// double-click is handed back to that element here: it is what renames a node or a group, opens a note or a title
// for editing, and resets a corner grip. Not while the scissors or the pen is in use; those own the pointer.
let toolTook = false;
vp.addEventListener('dblclick', (ev) => {
  if (ev.isTrusted && ev.target === vp) {
    if (toolTook) return;
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    if (under && under !== vp && vp.contains(under)) {
      under.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, detail: 2, clientX: ev.clientX, clientY: ev.clientY, shiftKey: ev.shiftKey, altKey: ev.altKey, metaKey: ev.metaKey, ctrlKey: ev.ctrlKey }));
      return;
    }
  }
  // A corner of a group's panel: back to fitting its nodes.
  const corner = ev.target.closest && ev.target.closest('.group-resize');
  if (corner) { const g = state.groups[corner.closest('.group').dataset.id]; if (g && g.box) { setGroupBox(g.id, null); save(); } return; }
  const grip = ev.target.closest && ev.target.closest('.node-resize'); if (!grip) return;
  const el = grip.closest('.node'); const n = state.nodes[el.dataset.id]; if (!n) return;
  delete n.w; el.style.width = NODE_TYPES[n.type].width + 'px'; el.classList.remove('sized');
  save(); renderEdges();
});

function startGroupDrag(ev, groupId) {
  const g = state.groups[groupId]; if (!g) return;
  const ids = g.nodeIds.filter((id) => state.nodes[id]);
  if (g.collapsed) { state.sel.clear(); bus.emit('selection'); } else select(ids);
  state.selGroup = groupId; bus.emit('groups:render');
  mode = 'drag';
  start = { x: ev.clientX, y: ev.clientY, ids, orig: ids.map((i) => ({ x: state.nodes[i].x, y: state.nodes[i].y })), moved: false, fromGroup: true, groupId, noSnap: !!g.collapsed };
  vp.setPointerCapture(ev.pointerId);
  ev.preventDefault();
}

// Dragging a corner of a group's panel sizes it by hand. It cannot be made smaller than its nodes.
function startGroupResize(ev, groupId, corner) {
  const g = state.groups[groupId]; const rect = g && groupBounds(g), min = g && contentBounds(g); if (!rect || !min || g.collapsed) return;
  state.selGroup = groupId; bus.emit('groups:render');
  mode = 'gresize';
  start = { x: ev.clientX, y: ev.clientY, id: groupId, corner, rect, min };
  vp.classList.add('resizing'); vp.style.cursor = corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize';
  vp.setPointerCapture(ev.pointerId);
  ev.preventDefault();
}
function groupResizeTo(ev) {
  const { rect, min, corner } = start;
  const dx = (ev.clientX - start.x) / state.view.z, dy = (ev.clientY - start.y) / state.view.z;
  const grid = (v) => (snapToGrid() && !ev.shiftKey ? toGrid(v) : v);
  let l = rect.x, t = rect.y, r = rect.x + rect.w, b = rect.y + rect.h;
  if (corner.includes('w')) l = Math.min(min.x, grid(rect.x + dx)); else r = Math.max(min.x + min.w, grid(rect.x + rect.w + dx));
  if (corner.includes('n')) t = Math.min(min.y, grid(rect.y + dy)); else b = Math.max(min.y + min.h, grid(rect.y + rect.h + dy));
  setGroupBox(start.id, { x: l, y: t, w: r - l, h: b - t });
}

function startMarquee(ev) {
  mode = 'marquee';
  start = { x: ev.clientX, y: ev.clientY, additive: ev.shiftKey, moved: false };
  vp.setPointerCapture(ev.pointerId);
  vp.focus();
}

let connect = null;
// Dragging from a node that is part of a multi-selection drags a strand from every selected node that has a matching output.
function fanSources(nodeId, portKey) {
  const n = state.nodes[nodeId]; const def = n && portDef(n, portKey);
  const list = [{ node: nodeId, port: portKey }];
  if (!def || !state.sel.has(nodeId) || state.sel.size < 2) return list;
  for (const id of state.sel) {
    if (id === nodeId) continue;
    const m = state.nodes[id]; if (!m || collapsedGroupOf(id)) continue;
    const outs = getPorts(m).outputs;
    const p = outs.find((x) => x.key === portKey && x.type === def.type) || outs.find((x) => x.type === def.type);
    if (p) list.push({ node: id, port: p.key });
  }
  return list;
}
// A strand from a collapsed group's card: it stands for whichever inside port fits.
function startGroupConnect(ev, gport) {
  const gid = gport.dataset.group, dir = gport.dataset.dir, type = gport.dataset.type;
  connect = { fixed: dir === 'out' ? 'from' : 'to', group: gid, node: null, port: null, type, dir: dir === 'out' ? 'out' : 'in', anchorEl: gport, fan: [] };
  beginConnect(ev);
}
function beginConnect(ev) {
  mode = 'connect';
  vp.classList.add('connecting');
  vp.setPointerCapture(ev.pointerId);
  const sameNodeOf = (p) => (connect.node ? p.closest('.node')?.dataset.id === connect.node : false);
  document.querySelectorAll('.port').forEach((p) => {
    const okDir = p.dataset.dir !== connect.dir;
    const ok = okDir && !sameNodeOf(p) && !collapsedGroupOf(p.closest('.node')?.dataset.id) && (connect.dir === 'out' ? canConnect(connect.type, p.dataset.type) : canConnect(p.dataset.type, connect.type));
    p.classList.toggle('reject', !ok);
  });
  document.querySelectorAll('.gport').forEach((p) => {
    const okDir = p.dataset.dir !== connect.dir;
    const ok = okDir && p.dataset.group !== connect.group && (connect.dir === 'out' ? canConnect(connect.type, p.dataset.type) : canConnect(p.dataset.type, connect.type));
    p.classList.toggle('reject', !ok);
  });
  updateDraft(ev);
  ev.preventDefault();
}
function startConnect(ev, portEl) {
  const nodeElm = portEl.closest('.node');
  const nodeId = nodeElm.dataset.id;
  const key = portEl.dataset.port;
  const dir = portEl.dataset.dir; // 'in' | 'out'
  let fromNode = nodeId, fromPort = key, fromType = portEl.dataset.type, fixed = 'from';

  if (dir === 'in') {
    // Dragging from a connected single input picks the edge up and lets you re-route it.
    const existing = incomingRaw(nodeId, key);
    const def = portDef(state.nodes[nodeId], key);
    if (existing.length && !def.multi) {
      const e = existing[0];
      removeEdge(e.id);
      fromNode = e.from; fromPort = e.fromPort; fromType = e.type; fixed = 'from';
    } else {
      fixed = 'to';
    }
  }
  connect = { fixed, node: fromNode, port: fromPort, type: fromType, dir: fixed === 'from' ? 'out' : 'in', fan: fixed === 'from' ? fanSources(fromNode, fromPort) : [] };
  beginConnect(ev);
}

function elCenter(el) { const r = el.getBoundingClientRect(); return screenToWorld(r.left + r.width / 2, r.top + r.height / 2); }
function updateDraft(ev) {
  const m = screenToWorld(ev.clientX, ev.clientY);
  if (connect.anchorEl) { const a = elCenter(connect.anchorEl); draft.setAttribute('d', connect.dir === 'out' ? bezier(a, m) : bezier(m, a)); return; }
  // One strand per selected source.
  const sources = connect.fan && connect.fan.length ? connect.fan : [{ node: connect.node, port: connect.port }];
  const d = sources.map((s) => { const a = portCenter(s.node, s.port); return a ? (connect.dir === 'out' ? bezier(a, m) : bezier(m, a)) : ''; }).filter(Boolean).join(' ');
  draft.setAttribute('d', d);
}
// Make the connection(s) the drop asked for. `src` and `dst` are { node, port } or { group, type }.
function finishConnect(src, dst) {
  const pick = (title, options, cb) => bus.emit('group:pick', { title, options, cb });
  const resolve = (end, dir, cb) => {
    if (!end.group) return cb([end]);
    const g = state.groups[end.group]; if (!g) return cb([]);
    const want = dir === 'in' ? innerPorts(g, 'in').filter((p) => canConnect(end.type, p.type)) : innerPorts(g, 'out').filter((p) => canConnect(p.type, end.type));
    if (want.length <= 1) return cb(want);
    pick(dir === 'in' ? `Connect into "${g.label}" at…` : `Connect from "${g.label}"…`, want, (p) => cb([p]));
  };
  resolve(src, 'out', (sources) => resolve(dst, 'in', (targets) => {
    const t = targets[0], s0 = sources[0];
    if (!t || !s0) { bus.emit('toast', { msg: "Those ports can't be connected.", kind: 'err' }); return; }
    const def = portDef(state.nodes[t.node], t.port);
    const all = src.fan && src.fan.length > 1 && !src.group ? src.fan : sources;
    const list = def && def.multi ? all : all.slice(0, 1);
    let made = 0;
    for (const s of list) if (addEdge(s.node, s.port, t.node, t.port)) made++;
    if (!made) bus.emit('toast', { msg: "Those ports can't be connected.", kind: 'err' });
    else if (made > 1) bus.emit('toast', { msg: `Connected ${made} nodes.`, kind: 'ok' });
    else if (all.length > 1 && (!def || !def.multi)) bus.emit('toast', { msg: `${def ? def.label : 'That input'} takes one connection, so only the node you dragged from was connected.` });
  }));
}

vp.addEventListener('pointermove', (ev) => {
  if (!mode) return;
  if (mode === 'pan') {
    state.view.x = start.vx + (ev.clientX - start.x);
    state.view.y = start.vy + (ev.clientY - start.y);
    applyView();
  } else if (mode === 'drag') {
    let dx = (ev.clientX - start.x) / state.view.z, dy = (ev.clientY - start.y) / state.view.z;
    if (!start.moved && Math.hypot(dx, dy) * state.view.z > 2) {
      start.moved = true;
      if (start.dup) {
        const made = instantiate(serialize(start.ids));
        if (made.length) { start.ids = made; start.orig = made.map((i) => ({ x: state.nodes[i].x, y: state.nodes[i].y })); select(made); made.forEach(bringToFront); vp.classList.add('duplicating'); }
      }
      // Lining up (snap.js): every node is measured once, here, before anything has moved.
      start.boxes = boxesCarriedBy(start.ids); // hand-sized group panels that travel with these nodes
      if (!start.noSnap) beginSnap(start.ids, (i) => { const el = nodeEl(i); return el ? { w: el.offsetWidth, h: el.offsetHeight } : null; }, start.ids[start.anchor]);
      start.ids.forEach((i) => nodeEl(i)?.classList.add('dragging'));
    }
    if (!start.moved) return;
    ({ dx, dy } = snapMove(dx, dy, ev.shiftKey)); // ⇧ held: place it freely
    shiftBoxes(start.boxes, dx, dy);
    start.ids.forEach((id, i) => {
      const n = state.nodes[id]; if (!n) return;
      n.x = Math.round(start.orig[i].x + dx); n.y = Math.round(start.orig[i].y + dy);
      const el = nodeEl(id); if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
    });
    // Dragging a single node over a connection offers to splice it in.
    if (start.ids.length === 1 && !start.fromGroup) {
      const id = start.ids[0];
      const hit = document.elementsFromPoint(ev.clientX, ev.clientY).find((x) => x.classList && x.classList.contains('hit'));
      const g = hit && hit.parentNode; const edgeId = g && g.dataset && g.dataset.edge;
      const ok = edgeId && insertionPlan(id, state.edges[edgeId]);
      if (start.insertEdge && start.insertEdge !== (ok ? edgeId : null)) edgeLayer.querySelector(`g[data-edge="${start.insertEdge}"] .edge:not(.hit)`)?.classList.remove('insert');
      start.insertEdge = ok ? edgeId : null;
      if (start.insertEdge) g.querySelector('.edge:not(.hit)')?.classList.add('insert');
    }
    renderEdges();
  } else if (mode === 'resize') {
    resizeTo(ev);
  } else if (mode === 'gresize') {
    groupResizeTo(ev);
  } else if (mode === 'connect') {
    updateDraft(ev);
    const over = document.elementFromPoint(ev.clientX, ev.clientY);
    document.querySelectorAll('.port.target, .gport.target').forEach((p) => p.classList.remove('target'));
    const p = over && over.closest && (over.closest('.port') || over.closest('.gport'));
    if (p && !p.classList.contains('reject')) p.classList.add('target');
  } else if (mode === 'marquee') {
    const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) > 4) { start.moved = true; marqueeEl.hidden = false; }
    if (!start.moved) return;
    const r = vp.getBoundingClientRect();
    const x = Math.min(ev.clientX, start.x) - r.left, y = Math.min(ev.clientY, start.y) - r.top;
    Object.assign(marqueeEl.style, { left: x + 'px', top: y + 'px', width: Math.abs(dx) + 'px', height: Math.abs(dy) + 'px' });
    const a = screenToWorld(Math.min(ev.clientX, start.x), Math.min(ev.clientY, start.y));
    const b = screenToWorld(Math.max(ev.clientX, start.x), Math.max(ev.clientY, start.y));
    const hits = Object.values(state.nodes).filter((n) => {
      if (collapsedGroupOf(n.id)) return false;
      const el = nodeEl(n.id); const w = el ? el.offsetWidth : 300, h = el ? el.offsetHeight : 200;
      return n.x < b.x && n.x + w > a.x && n.y < b.y && n.y + h > a.y;
    }).map((n) => n.id);
    select(hits, start.additive);
  }
});

function endInteraction(ev) {
  if (!mode) return;
  if (mode === 'drag') {
    endSnap();
    start.ids.forEach((i) => nodeEl(i)?.classList.remove('dragging'));
    if (start.insertEdge) {
      edgeLayer.querySelector(`g[data-edge="${start.insertEdge}"] .edge:not(.hit)`)?.classList.remove('insert');
      if (insertNodeOnEdge(start.ids[0], start.insertEdge)) bus.emit('toast', { msg: 'Connected in line.', kind: 'ok' });
    }
    if (start.moved && !start.fromGroup) bus.emit('nodes:dropped', { ids: start.ids, clientX: ev.clientX, clientY: ev.clientY });
    if (!start.moved && start.fromGroup && state.groups[start.groupId]?.collapsed && !ev.target.closest('.group-bar')) setCollapsed(start.groupId, false);
    if (start.moved) save();
    if (!start.moved && start.link && start.link.isConnected) bus.emit('link:click', start.link.href);
    vp.classList.remove('duplicating');
  } else if (mode === 'resize') {
    nodeEl(start.id)?.classList.remove('dragging', 'at-min');
    vp.classList.remove('resizing'); vp.style.cursor = '';
    save();
  } else if (mode === 'gresize') {
    vp.classList.remove('resizing'); vp.style.cursor = '';
    save();
  } else if (mode === 'connect') {
    const over = document.elementFromPoint(ev.clientX, ev.clientY);
    let p = over && over.closest && over.closest('.port');
    // A strand let go anywhere on a Link in plugs into it: it has one input, and that input takes anything.
    if (!p && connect.dir === 'out' && over && over.closest) { const link = over.closest('.node-linkin'); if (link) p = link.querySelector('.port[data-dir="in"]'); }
    const gp = !p && over && over.closest && over.closest('.gport');
    const card = !p && !gp && over && over.closest && over.closest('.group.collapsed');
    const me = connect.group ? { group: connect.group, type: connect.type } : { node: connect.node, port: connect.port, fan: connect.fan };
    if (p && !p.classList.contains('reject')) {
      const nid = p.closest('.node').dataset.id, key = p.dataset.port;
      if (connect.dir === 'out') finishConnect(me, { node: nid, port: key });
      else finishConnect({ node: nid, port: key, fan: fanSources(nid, key) }, me);
    } else if ((gp && !gp.classList.contains('reject')) || (card && card.dataset.id !== connect.group)) {
      const other = { group: gp ? gp.dataset.group : card.dataset.id, type: gp ? gp.dataset.type : connect.type };
      if (connect.dir === 'out') finishConnect(me, other); else finishConnect(other, me);
    } else if (!p && !gp && !card) {
      bus.emit('connect:drop', { ...connect, clientX: ev.clientX, clientY: ev.clientY });
    }
    draft.setAttribute('d', '');
    document.querySelectorAll('.port, .gport').forEach((x) => x.classList.remove('reject', 'target'));
    vp.classList.remove('connecting');
    connect = null;
  } else if (mode === 'marquee') {
    marqueeEl.hidden = true;
    if (!start.moved) { state.selGroup = null; clearSelection(); bus.emit('canvas:click'); }
  } else if (mode === 'pan') {
    vp.classList.remove('panning');
  }
  mode = null; start = null;
  renderEdges();
}
vp.addEventListener('pointerup', endInteraction);
vp.addEventListener('pointercancel', endInteraction);

// The viewport is overflow:hidden, but the browser still scrolls it for focus(), scrollIntoView and text selection.
// Any such scroll moves the board under the pan transform, so undo it the moment it happens.
vp.addEventListener('scroll', () => { if (vp.scrollLeft || vp.scrollTop) { vp.scrollLeft = 0; vp.scrollTop = 0; } });

// Wheel: two-finger scroll pans; pinch / ⌘+scroll zooms. Over a text box (or a list inside a node) holding more than
// it shows, the wheel scrolls that instead of the board.
function scrollerAt(target) {
  for (let el = target; el && el !== vp && el.nodeType === 1; el = el.parentElement) {
    if (el.scrollHeight - el.clientHeight < 4) continue;
    if (el.tagName === 'TEXTAREA') return el;
    const oy = getComputedStyle(el).overflowY;
    if (oy === 'auto' || oy === 'scroll') return el;
  }
  return null;
}
// One gesture keeps doing what it started doing. Panning never stalls when a text box slides under the pointer, and
// reaching the end of a text box never starts dragging the board along.
const WHEEL_GAP = 250; // ms of quiet that ends a gesture
let wheelOwner = 'pan', wheelAt = -Infinity;
vp.addEventListener('wheel', (ev) => {
  if (ev.ctrlKey || ev.metaKey) {
    ev.preventDefault(); wheelOwner = 'pan'; wheelAt = ev.timeStamp;
    const factor = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.012 : 0.0025));
    zoomAt(ev.clientX, ev.clientY, factor);
    return;
  }
  if (ev.timeStamp - wheelAt > WHEEL_GAP) wheelOwner = (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? null : scrollerAt(ev.target)) || 'pan';
  wheelAt = ev.timeStamp;
  if (wheelOwner !== 'pan' && wheelOwner.isConnected) return; // the browser scrolls the text box itself
  ev.preventDefault();
  state.view.x -= ev.deltaX; state.view.y -= ev.deltaY;
  applyView();
}, { passive: false });

// Space to pan
// Space pans. It must never "press" whatever button happened to be focused last (Generate, a status pill, a dock button).
window.addEventListener('keydown', (ev) => {
  if (ev.code === 'Space' && !isTyping(ev.target)) { spaceDown = true; vp.classList.add('space'); ev.preventDefault(); }
});
window.addEventListener('keyup', (ev) => { if (ev.code === 'Space') { spaceDown = false; vp.classList.remove('space'); if (!isTyping(ev.target)) ev.preventDefault(); } });
// Buttons give focus back to the canvas after a click, so later key presses act on the board, not the button.
document.addEventListener('click', (ev) => { const b = ev.target.closest && ev.target.closest('button'); if (b && !b.closest('.sidebar, .sheet, #quickadd, #lightbox, #guide')) b.blur(); });
window.addEventListener('blur', () => { spaceDown = false; vp.classList.remove('space'); });
export const isTyping = (el) => !!(el && (el.matches && el.matches('input, textarea, select, [contenteditable]')));

export function bringToFront(id) {
  const el = nodeEl(id); if (!el || el.parentNode.lastElementChild === el) return;
  el.style.animation = 'none'; // moving an element in the page replays its arrival animation: the node would fade in again on every press
  el.parentNode.appendChild(el);
}

// ---------- file drop / paste ----------
let dragDepth = 0;
vp.addEventListener('dragenter', (ev) => { if (hasFiles(ev)) { dragDepth++; dropHint.hidden = false; } });
vp.addEventListener('dragleave', () => { if (dragDepth > 0) dragDepth--; if (!dragDepth) dropHint.hidden = true; });
vp.addEventListener('dragover', (ev) => { if (hasFiles(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; } });
vp.addEventListener('drop', (ev) => {
  ev.preventDefault(); dragDepth = 0; dropHint.hidden = true;
  const all = [...(ev.dataTransfer.files || [])];
  const skills = all.filter((f) => /\.(zip|skill|md|markdown)$/i.test(f.name));
  if (skills.length) bus.emit('skills:drop', { files: skills, ...screenToWorld(ev.clientX, ev.clientY) });
  const files = all.filter(isMediaFile);
  if (files.length) bus.emit('files', { files, ...screenToWorld(ev.clientX, ev.clientY) });
});
window.addEventListener('paste', (ev) => {
  if (isTyping(ev.target)) return;
  const files = [...(ev.clipboardData?.files || [])].filter(isMediaFile);
  if (files.length) { const c = viewportCenterWorld(); bus.emit('files', { files, x: c.x - 130, y: c.y - 100 }); }
});
const hasFiles = (ev) => [...(ev.dataTransfer?.types || [])].includes('Files');
// Images, videos and audio. Browsers leave the type blank for some audio formats, so the extension counts too.
const MEDIA_EXT = /\.(png|jpe?g|webp|gif|avif|heic|mp4|mov|webm|m4v|mp3|wav|m4a|ogg|oga|aac|flac|aiff?)$/i;
export const isMediaFile = (f) => /^(image|video|audio)\//.test(f.type) || (!f.type && MEDIA_EXT.test(f.name));

// Keep edges in sync when node sizes change (textarea growth, results appearing).
export const resizeObserver = new ResizeObserver(() => renderEdges());
window.addEventListener('resize', () => renderEdges());
bus.on('selection', () => {
  document.querySelectorAll('.node').forEach((el) => el.classList.toggle('selected', state.sel.has(el.dataset.id)));
  renderEdges();
});
bus.on('edge:add', renderEdges);
bus.on('edge:remove', renderEdges);
