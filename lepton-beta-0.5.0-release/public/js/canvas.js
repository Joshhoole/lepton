// Viewport: pan, zoom, node dragging, port connections, edge drawing, marquee selection, file drop.
import { state, bus, addEdge, removeEdge, portDef, getPorts, canConnect, select, clearSelection, save, incoming, insertionPlan, insertNodeOnEdge, NODE_TYPES } from './state.js';
import { serialize, instantiate } from './clipboard.js';
import { collapsedGroupOf, innerPorts, setCollapsed } from './groups.js';
import { recordMove, snapshot } from './history.js';

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
export function applyView() {
  const { x, y, z } = state.view;
  world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
  // Grid: double the spacing whenever dots would get closer than ~14px, and fade it out below 40% zoom.
  let g = 24 * z; let alpha = 1;
  while (g < 14) g *= 2;
  if (z < 0.4) alpha = Math.max(0, (z - 0.2) / 0.2);
  const key = `${g.toFixed(2)}|${alpha.toFixed(2)}`;
  if (key !== lastGrid) { lastGrid = key; vp.style.backgroundSize = `${g}px ${g}px`; vp.style.setProperty('--grid-alpha', String(alpha)); }
  // Plain background-position, never a custom property: a custom property on the viewport inherits into every node
  // and forces a full style recalculation each frame (measured at ~14 ms with 60 nodes).
  if (alpha > 0) vp.style.backgroundPosition = `${x}px ${y}px`;
  bus.emit('view');
  save();
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

export const nodeEl = (id) => document.querySelector(`.node[data-id="${id}"]`);

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
export function renderEdges() {
  cancelAnimationFrame(edgeFrame);
  edgeFrame = requestAnimationFrame(() => {
    const seen = new Set();
    for (const e of Object.values(state.edges)) {
      seen.add(e.id);
      let g = edgeLayer.querySelector(`g[data-edge="${e.id}"]`);
      if (!g) {
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
      }
      const ga = collapsedGroupOf(e.from), gb = collapsedGroupOf(e.to);
      if (ga && ga === gb) { g.style.display = 'none'; continue; } // both ends are folded away together
      const a = portCenter(e.from, e.fromPort), b = portCenter(e.to, e.toPort);
      if (!a || !b) { g.style.display = 'none'; continue; }
      g.style.display = '';
      const d = bezier(a, b);
      g.children[0].setAttribute('d', d);
      g.children[1].setAttribute('d', d);
      const to = state.nodes[e.to];
      g.children[1].classList.toggle('selected', state.selEdge === e.id);
      g.children[1].classList.toggle('flowing', !!(to && to.data.status === 'running'));
    }
    for (const g of [...edgeLayer.children]) if (!seen.has(g.dataset.edge)) g.remove();
    bus.emit('groups:render');
    // Port connected state
    document.querySelectorAll('.port').forEach((p) => p.classList.remove('connected'));
    document.querySelectorAll('.port-row.in').forEach((r) => r.classList.remove('connected'));
    document.querySelectorAll('.gport').forEach((p) => p.classList.remove('connected'));
    for (const e of Object.values(state.edges)) {
      const a = document.querySelector(`.node[data-id="${e.from}"] .port[data-port="${e.fromPort}"]`);
      const b = document.querySelector(`.node[data-id="${e.to}"] .port[data-port="${e.toPort}"]`);
      a && a.classList.add('connected'); b && b.classList.add('connected');
      b && b.closest('.port-row') && b.closest('.port-row').classList.add('connected');
      const ga = collapsedGroupOf(e.from), gb = collapsedGroupOf(e.to);
      if (ga && ga !== gb) document.querySelector(`.group[data-id="${ga.id}"] .gport[data-dir="out"][data-type="${e.type}"]`)?.classList.add('connected');
      if (gb && ga !== gb) { const def = state.nodes[e.to] && portDef(state.nodes[e.to], e.toPort); if (def) document.querySelector(`.group[data-id="${gb.id}"] .gport[data-dir="in"][data-type="${def.type}"]`)?.classList.add('connected'); }
    }
  });
}

// ---------- pointer interactions ----------
let mode = null; // 'pan' | 'drag' | 'connect' | 'marquee' | 'resize'
let start = null;

const INTERACTIVE = 'input, select, textarea, button, .port, .thumb, .preview-item, .media-frame, [contenteditable], a, .results, .disclosure, .ref-chip, .cmp-stage, .cmp-bar';

vp.addEventListener('pointerdown', (ev) => {
  if (ev.button === 2) return; // context menu handled elsewhere
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
  start = { x: ev.clientX, y: ev.clientY, ids, orig: ids.map((i) => ({ x: state.nodes[i].x, y: state.nodes[i].y })), moved: false, dup };
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
  el.style.width = '0px';
  const need = el.scrollWidth;
  el.style.width = width;
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
  start = { x: ev.clientX, y: ev.clientY, id, corner, w: nodeElm.offsetWidth, h: nodeElm.offsetHeight, nx: n.x, ny: n.y, min: minWidthOf(nodeElm), before: snapshot([id]) };
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
vp.addEventListener('dblclick', (ev) => {
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
  start = { x: ev.clientX, y: ev.clientY, ids, orig: ids.map((i) => ({ x: state.nodes[i].x, y: state.nodes[i].y })), moved: false, fromGroup: true, groupId };
  vp.setPointerCapture(ev.pointerId);
  ev.preventDefault();
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
    const existing = incoming(nodeId, key);
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
    const dx = (ev.clientX - start.x) / state.view.z, dy = (ev.clientY - start.y) / state.view.z;
    if (!start.moved && Math.hypot(dx, dy) * state.view.z > 2) {
      start.moved = true;
      if (start.dup) {
        const made = instantiate(serialize(start.ids));
        if (made.length) { start.ids = made; start.orig = made.map((i) => ({ x: state.nodes[i].x, y: state.nodes[i].y })); select(made); made.forEach(bringToFront); vp.classList.add('duplicating'); }
      }
      start.ids.forEach((i) => nodeEl(i)?.classList.add('dragging'));
    }
    if (!start.moved) return;
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
    start.ids.forEach((i) => nodeEl(i)?.classList.remove('dragging'));
    if (start.insertEdge) {
      edgeLayer.querySelector(`g[data-edge="${start.insertEdge}"] .edge:not(.hit)`)?.classList.remove('insert');
      if (insertNodeOnEdge(start.ids[0], start.insertEdge)) bus.emit('toast', { msg: 'Connected in line.', kind: 'ok' });
    }
    if (start.moved) recordMove(start.ids, start.orig.map((o, i) => ({ x: o.x, y: o.y, w: state.nodes[start.ids[i]]?.w || null })));
    if (start.moved && !start.fromGroup) bus.emit('nodes:dropped', { ids: start.ids, clientX: ev.clientX, clientY: ev.clientY });
    if (!start.moved && start.fromGroup && state.groups[start.groupId]?.collapsed && !ev.target.closest('.group-bar')) setCollapsed(start.groupId, false);
    if (start.moved) save();
    vp.classList.remove('duplicating');
  } else if (mode === 'resize') {
    nodeEl(start.id)?.classList.remove('dragging', 'at-min');
    vp.classList.remove('resizing'); vp.style.cursor = '';
    recordMove([start.id], start.before);
    save();
  } else if (mode === 'connect') {
    const over = document.elementFromPoint(ev.clientX, ev.clientY);
    const p = over && over.closest && over.closest('.port');
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

// Wheel: two-finger scroll pans; pinch / ⌘+scroll zooms.
vp.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  if (ev.ctrlKey || ev.metaKey) {
    const factor = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.012 : 0.0025));
    zoomAt(ev.clientX, ev.clientY, factor);
  } else {
    state.view.x -= ev.deltaX; state.view.y -= ev.deltaY;
    applyView();
  }
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
  const el = nodeEl(id); if (el && el.parentNode.lastElementChild !== el) el.parentNode.appendChild(el);
}

// ---------- file drop / paste ----------
let dragDepth = 0;
vp.addEventListener('dragenter', (ev) => { if (hasFiles(ev)) { dragDepth++; dropHint.hidden = false; } });
vp.addEventListener('dragleave', () => { if (dragDepth > 0) dragDepth--; if (!dragDepth) dropHint.hidden = true; });
vp.addEventListener('dragover', (ev) => { if (hasFiles(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; } });
vp.addEventListener('drop', (ev) => {
  ev.preventDefault(); dragDepth = 0; dropHint.hidden = true;
  const all = [...(ev.dataTransfer.files || [])];
  const skills = all.filter((f) => /\.(zip|md|markdown)$/i.test(f.name));
  if (skills.length) bus.emit('skills:drop', { files: skills, ...screenToWorld(ev.clientX, ev.clientY) });
  const files = all.filter((f) => /^(image|video)\//.test(f.type));
  if (files.length) bus.emit('files', { files, ...screenToWorld(ev.clientX, ev.clientY) });
});
window.addEventListener('paste', (ev) => {
  if (isTyping(ev.target)) return;
  const files = [...(ev.clipboardData?.files || [])].filter((f) => /^(image|video)\//.test(f.type));
  if (files.length) { const c = viewportCenterWorld(); bus.emit('files', { files, x: c.x - 130, y: c.y - 100 }); }
});
const hasFiles = (ev) => [...(ev.dataTransfer?.types || [])].includes('Files');

// Keep edges in sync when node sizes change (textarea growth, results appearing).
export const resizeObserver = new ResizeObserver(() => renderEdges());
window.addEventListener('resize', () => renderEdges());
bus.on('selection', () => {
  document.querySelectorAll('.node').forEach((el) => el.classList.toggle('selected', state.sel.has(el.dataset.id)));
  renderEdges();
});
bus.on('edge:add', renderEdges);
bus.on('edge:remove', renderEdges);
