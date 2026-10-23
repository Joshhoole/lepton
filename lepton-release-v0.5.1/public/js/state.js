// Shared store, node/edge model and a tiny event bus.

export const state = {
  nodes: {},
  edges: {},
  groups: {},
  view: { x: 0, y: 0, z: 1 },
  sel: new Set(),
  selEdge: null,
  selGroup: null,
  name: 'Untitled board',
  project: null,   // { id, path, name, savedAt, savedHash } when a project folder is open
  dirty: false,
};

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);

const listeners = {};
export const bus = {
  on(evt, fn) { (listeners[evt] ||= []).push(fn); return () => bus.off(evt, fn); },
  off(evt, fn) { listeners[evt] = (listeners[evt] || []).filter((f) => f !== fn); },
  emit(evt, ...args) { (listeners[evt] || []).forEach((f) => { try { f(...args); } catch (e) { console.error(e); } }); },
};

// ---------- node types ----------

export const NODE_TYPES = {
  prompt: { title: 'Prompt', width: 300 },
  image: { title: 'Image', width: 300 },
  video: { title: 'Video', width: 300 },
  preview: { title: 'Preview', width: 340 },
  media: { title: 'Media', width: 260 },
  llm: { title: 'LLM', width: 320 },
  batch: { title: 'Prompt batch', width: 320 },
  template: { title: 'Template', width: 380 },
  compare: { title: 'Compare', width: 420 },
  skill: { title: 'Skill', width: 300 },
};
// Nodes whose corners can be dragged to scale them.
export const RESIZABLE = new Set(['media', 'preview', 'compare']);

export const GEN_TYPES = new Set(['image', 'video']);
export const isGen = (n) => n && GEN_TYPES.has(n.type);
export const isLLM = (n) => n && (n.type === 'llm' || n.type === 'template');
// The model catalogue kind a node picks from.
export const kindOf = (n) => (n.type === 'template' ? 'llm' : n.type);
export const isRunnable = (n) => isGen(n) || isLLM(n);

export function defaultData(type) {
  switch (type) {
    case 'prompt': return { text: '' };
    case 'image': return { model: '', params: {}, batch: 1, prompt: '', results: [], history: [], selected: 0, status: 'idle', error: null };
    case 'video': return { model: '', params: {}, batch: 1, prompt: '', results: [], history: [], selected: 0, status: 'idle', error: null };
    case 'preview': return {};
    case 'media': return { url: '', name: '', kind: 'image', jobId: null, w: 0, h: 0 };
    case 'llm': return { model: '', params: {}, system: '', instructions: '', output: '', status: 'idle', error: null };
    case 'batch': return { mode: 'auto', separator: '', items: [] };
    case 'compare': return { mode: 'slider', split: 0.5, opacity: 0.5, vertical: false };
    case 'skill': return { skill: '', name: '', description: '', chars: 0, files: 0 };
    case 'template': return { template: '', spec: null, model: '', params: {}, values: {}, compact: false, output: '', status: 'idle', error: null };
    default: return {};
  }
}

// Port definitions. Generator ports depend on the model schema (set on node.data.schemaPorts by nodes.js).
export function getPorts(node) {
  switch (node.type) {
    case 'prompt':
      return { inputs: [], outputs: [{ key: 'out', type: 'text', label: 'Prompt' }] };
    case 'image': {
      const sp = node.data.schemaPorts || { refs: true };
      const inputs = [{ key: 'prompt', type: 'text', label: 'Prompt', multi: true }];
      if (sp.refs) inputs.push({ key: 'refs', type: 'image', label: 'References', multi: true });
      return { inputs, outputs: [{ key: 'out', type: 'image', label: 'Image' }] };
    }
    case 'video': {
      const sp = node.data.schemaPorts || { start: true, end: true, refs: true };
      const inputs = [{ key: 'prompt', type: 'text', label: 'Prompt', multi: true }];
      if (sp.start) inputs.push({ key: 'start', type: 'image', label: 'Start frame' });
      if (sp.end) inputs.push({ key: 'end', type: 'image', label: 'End frame' });
      if (sp.refs) inputs.push({ key: 'refs', type: 'image', label: 'References', multi: true });
      if (sp.vrefs) inputs.push({ key: 'vrefs', type: 'video', label: 'Video refs', multi: true });
      return { inputs, outputs: [{ key: 'out', type: 'video', label: 'Video' }] };
    }
    case 'preview':
      return { inputs: [{ key: 'in', type: 'media', label: 'Source' }], outputs: [] };
    case 'media': {
      const k = node.data.kind === 'video' ? 'video' : node.data.kind === 'audio' ? 'audio' : 'image';
      return { inputs: [], outputs: [{ key: 'out', type: k, label: k[0].toUpperCase() + k.slice(1) }] };
    }
    case 'llm':
      return {
        inputs: [{ key: 'prompt', type: 'text', label: 'Prompt', multi: true }, { key: 'media', type: 'any', label: 'Image · video · audio', multi: true }, { key: 'skills', type: 'skill', label: 'Skills', multi: true }],
        outputs: [{ key: 'out', type: 'text', label: 'Text' }],
      };
    case 'template': {
      const spec = node.data.spec || { sections: [] };
      const inputs = [];
      for (const sec of spec.sections) {
        if (sec.type === 'images') inputs.push({ key: `i_${sec.key}`, type: 'image', label: sec.label, multi: sec.multi !== false });
        else inputs.push({ key: `s_${sec.key}`, type: 'text', label: sec.label, multi: true });
      }
      return { inputs, outputs: [{ key: 'out', type: 'text', label: 'Text' }] };
    }
    case 'skill':
      return { inputs: [], outputs: [{ key: 'out', type: 'skill', label: 'Skill' }] };
    case 'compare':
      return { inputs: [{ key: 'a', type: 'media', label: 'A' }, { key: 'b', type: 'media', label: 'B' }], outputs: [] };
    case 'batch': {
      const items = node.data.items || [];
      const outputs = (items.length ? items : ['']).map((t, i) => ({ key: `out${i}`, type: 'text', label: `Prompt ${i + 1}`, text: t }));
      return { inputs: [{ key: 'prompt', type: 'text', label: 'Prompt', multi: true }], outputs };
    }
    default:
      return { inputs: [], outputs: [] };
  }
}

export function portDef(node, key) {
  const p = getPorts(node);
  return p.inputs.find((x) => x.key === key) || p.outputs.find((x) => x.key === key) || null;
}

const MEDIA_TYPES = new Set(['image', 'video', 'audio']);
export function canConnect(fromType, toType) {
  if (toType === 'media' || toType === 'any') return MEDIA_TYPES.has(fromType);
  return fromType === toType;
}

// ---------- mutations ----------

export function addNode(type, x, y, data = {}, extra = {}) {
  const id = uid();
  const node = { id, type, x: Math.round(x), y: Math.round(y), ...extra, data: { ...defaultData(type), ...data } };
  state.nodes[id] = node;
  bus.emit('node:add', node);
  save();
  return node;
}

export function removeNodes(ids) {
  const set = new Set(ids);
  for (const e of Object.values(state.edges)) {
    if (set.has(e.from) || set.has(e.to)) removeEdge(e.id, false);
  }
  for (const id of set) {
    const n = state.nodes[id];
    if (!n) continue;
    delete state.nodes[id];
    state.sel.delete(id);
    for (const g of Object.values(state.groups)) g.nodeIds = g.nodeIds.filter((x) => x !== id);
    bus.emit('node:remove', n);
  }
  save();
}

export function incoming(nodeId, portKey) {
  return Object.values(state.edges).filter((e) => e.to === nodeId && (portKey === undefined || e.toPort === portKey));
}
export function outgoing(nodeId, portKey) {
  return Object.values(state.edges).filter((e) => e.from === nodeId && (portKey === undefined || e.fromPort === portKey));
}

function createsCycle(from, to) {
  // Would adding from→to create a cycle? Walk downstream from `to` looking for `from`.
  const seen = new Set(); const stack = [to];
  while (stack.length) {
    const n = stack.pop();
    if (n === from) return true;
    if (seen.has(n)) continue; seen.add(n);
    for (const e of outgoing(n)) stack.push(e.to);
  }
  return false;
}

export function addEdge(from, fromPort, to, toPort) {
  if (from === to) return null;
  const a = state.nodes[from], b = state.nodes[to];
  if (!a || !b) return null;
  const pa = portDef(a, fromPort), pb = portDef(b, toPort);
  if (!pa || !pb || !canConnect(pa.type, pb.type)) return null;
  if (createsCycle(from, to)) return null;
  const dupe = Object.values(state.edges).find((e) => e.from === from && e.fromPort === fromPort && e.to === to && e.toPort === toPort);
  if (dupe) return dupe;
  if (!pb.multi) for (const e of incoming(to, toPort)) removeEdge(e.id, false);
  const id = uid();
  const edge = { id, from, fromPort, to, toPort, type: pa.type };
  state.edges[id] = edge;
  bus.emit('edge:add', edge);
  save();
  return edge;
}

export function removeEdge(id, doSave = true) {
  const e = state.edges[id];
  if (!e) return;
  delete state.edges[id];
  if (state.selEdge === id) state.selEdge = null;
  bus.emit('edge:remove', e);
  if (doSave) save();
}

// Can `nodeId` be spliced into `edge` (from → node → to)? Returns the plan or null.
export function insertionPlan(nodeId, edge) {
  const node = state.nodes[nodeId]; if (!node || !edge) return null;
  if (edge.from === nodeId || edge.to === nodeId) return null;
  const ports = getPorts(node);
  const target = state.nodes[edge.to]; if (!target) return null;
  const targetPort = portDef(target, edge.toPort); if (!targetPort) return null;
  // Input side: the first port of this node that accepts what flows along the edge, preferring an unused one.
  const candidates = ports.inputs.filter((p) => canConnect(edge.type, p.type));
  const inPort = candidates.find((p) => p.multi || !incoming(nodeId, p.key).length) || candidates[0];
  if (!inPort) return null;
  const outPort = ports.outputs[0];
  if (!outPort) return { inPort, outPort: null, replace: false };
  // Output side: back into the same target port if compatible, otherwise any target port that takes our output.
  if (canConnect(outPort.type, targetPort.type)) return { inPort, outPort, targetPortKey: edge.toPort, replace: true };
  const alt = getPorts(target).inputs.find((p) => canConnect(outPort.type, p.type) && (p.multi || !incoming(edge.to, p.key).length));
  return { inPort, outPort, targetPortKey: alt ? alt.key : null, replace: false };
}
export function insertNodeOnEdge(nodeId, edgeId) {
  const edge = state.edges[edgeId];
  const plan = insertionPlan(nodeId, edge);
  if (!plan) return false;
  if (plan.replace) removeEdge(edgeId, false);
  addEdge(edge.from, edge.fromPort, nodeId, plan.inPort.key);
  if (plan.outPort && plan.targetPortKey) addEdge(nodeId, plan.outPort.key, edge.to, plan.targetPortKey);
  save();
  return true;
}

// Drop edges that no longer point at an existing port (after a model change).
export function pruneEdges(nodeId) {
  const n = state.nodes[nodeId]; if (!n) return;
  const ports = getPorts(n);
  const keys = new Set([...ports.inputs, ...ports.outputs].map((p) => p.key));
  for (const e of Object.values(state.edges)) {
    if ((e.to === nodeId && !keys.has(e.toPort)) || (e.from === nodeId && !keys.has(e.fromPort))) removeEdge(e.id, false);
  }
}

// ---------- selection ----------
export function select(ids, additive = false) {
  if (!additive) state.sel.clear();
  for (const id of ids) state.sel.add(id);
  state.selEdge = null;
  bus.emit('selection');
}
export function clearSelection() { state.sel.clear(); state.selEdge = null; bus.emit('selection'); }

// ---------- persistence ----------
const KEY = 'lepton.board.v1';
// Carry a board saved under the old app name across the rename.
try { if (!localStorage.getItem(KEY) && localStorage.getItem('strand.board.v1')) { localStorage.setItem(KEY, localStorage.getItem('strand.board.v1')); localStorage.removeItem('strand.board.v1'); } } catch { /* ignore */ }
let saveTimer = null;
export function save(immediate = false) {
  clearTimeout(saveTimer);
  const write = () => {
    try {
      const nodes = {};
      for (const n of Object.values(state.nodes)) {
        const d = { ...n.data };
        delete d.schemaPorts; delete d.schema;
        if (d.status === 'running') d.status = 'idle';
        nodes[n.id] = { ...n, data: d };
      }
      localStorage.setItem(KEY, JSON.stringify({ nodes, edges: state.edges, groups: state.groups, view: state.view, name: state.name, project: state.project }));
      const dirty = state.project ? boardHash() !== state.project.savedHash : false;
      if (dirty !== state.dirty) { state.dirty = dirty; bus.emit('project'); }
    } catch (e) { console.warn('save failed', e); }
  };
  if (immediate) write(); else saveTimer = setTimeout(write, 250);
}
// Flush before the page goes away so an in-flight job id is never lost.
window.addEventListener('beforeunload', () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; save(true); } });
export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    applyBoard(d);
    return true;
  } catch { return false; }
}
export function applyBoard(d) {
  state.nodes = d.nodes || {};
  state.edges = d.edges || {};
  state.groups = d.groups || {};
  state.selGroup = null;
  state.project = d.project || null;
  state.view = d.view || { x: 0, y: 0, z: 1 };
  state.name = d.name || 'Untitled board';
  state.sel.clear(); state.selEdge = null;
  for (const n of Object.values(state.nodes)) {
    n.data = { ...defaultData(n.type), ...n.data };
    if (n.data.status === 'running') n.data.status = 'idle';
    // Placeholders that never became jobs (a failed submit) must not reload as spinners.
    if (Array.isArray(n.data.results)) n.data.results = n.data.results.filter((r) => r.jobId);
    // Boards saved before providers were namespaced: Higgsfield ids had no prefix.
    if (n.data.model && !n.data.model.includes(':') && n.data.model.includes('/')) n.data.model = 'hf:' + n.data.model;
  }
}
export function exportBoard() {
  const nodes = {};
  for (const n of Object.values(state.nodes)) { const d = { ...n.data }; delete d.schemaPorts; delete d.schema; nodes[n.id] = { ...n, data: d }; }
  return { version: 1, name: state.name, nodes, edges: state.edges, groups: state.groups, view: state.view };
}

// Cheap content fingerprint (view excluded) used for the unsaved-changes indicator.
export function boardHash() {
  const nodes = {};
  for (const n of Object.values(state.nodes)) { const d = { ...n.data }; delete d.schemaPorts; delete d.schema; delete d.status; nodes[n.id] = { x: n.x, y: n.y, w: n.w, data: d }; }
  const str = JSON.stringify({ nodes, edges: state.edges, groups: state.groups, name: state.name });
  let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return `${str.length}:${h}`;
}
