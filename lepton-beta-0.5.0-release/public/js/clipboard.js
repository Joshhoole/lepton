// Copy, cut, paste and duplicate: nodes are turned into a plain payload and rebuilt from it.
import { state, addNode, addEdge, isGen, isLLM, NODE_TYPES } from './state.js';

export const CLIP_TYPE = 'application/x-lepton-nodes';

// A copy starts clean: it keeps settings and text, never results, history or a running job.
function cloneData(n) {
  const d = JSON.parse(JSON.stringify({ ...n.data, schema: undefined }));
  if (isGen(n)) { d.results = []; d.history = []; d.selected = 0; d.status = 'idle'; d.error = null; delete d.runMeta; delete d.autoRatio; }
  if (isLLM(n)) { d.status = 'idle'; d.error = null; delete d.pendingJob; }
  return d;
}

export function serialize(ids) {
  const set = new Set(ids.filter((id) => state.nodes[id] && !state.nodes[id].data.pending));
  const nodes = [...set].map((id) => { const n = state.nodes[id]; return { id, type: n.type, x: n.x, y: n.y, w: n.w || null, data: cloneData(n) }; });
  const pick = (e) => ({ from: e.from, fromPort: e.fromPort, to: e.to, toPort: e.toPort });
  const all = Object.values(state.edges);
  return {
    nodes,
    edges: all.filter((e) => set.has(e.from) && set.has(e.to)).map(pick),
    inputs: all.filter((e) => set.has(e.to) && !set.has(e.from)).map(pick), // connections arriving from nodes that were not copied
  };
}

// Rebuild a payload on the board. `inputs` also reconnects what fed the originals, when those nodes still exist.
export function instantiate(payload, { dx = 0, dy = 0, inputs = false } = {}) {
  const map = {};
  for (const n of payload.nodes || []) {
    if (!NODE_TYPES[n.type]) continue;
    const c = addNode(n.type, n.x + dx, n.y + dy, JSON.parse(JSON.stringify(n.data)), n.w ? { w: n.w } : {});
    map[n.id] = c.id;
  }
  for (const e of payload.edges || []) if (map[e.from] && map[e.to]) addEdge(map[e.from], e.fromPort, map[e.to], e.toPort);
  if (inputs) for (const e of payload.inputs || []) if (state.nodes[e.from] && map[e.to]) addEdge(e.from, e.fromPort, map[e.to], e.toPort);
  return Object.values(map);
}

export function boundsOf(payload) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of payload.nodes) { const w = n.w || NODE_TYPES[n.type]?.width || 300; x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + w); y1 = Math.max(y1, n.y + 220); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// What a copied selection reads as when pasted into another app: its text, if it has any.
export function textOf(ids) {
  return ids.map((id) => state.nodes[id]).filter(Boolean)
    .map((n) => (n.type === 'prompt' ? n.data.text : n.type === 'llm' || n.type === 'template' ? n.data.output : isGen(n) ? n.data.prompt : '') || '')
    .map((t) => t.trim()).filter(Boolean).join('\n\n');
}
