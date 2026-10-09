// Node rendering: builds and refreshes the DOM for each node type.
import { state, bus, getPorts, incoming, save, isGen, isLLM, isRunnable, pruneEdges, NODE_TYPES, kindOf, RESIZABLE } from './state.js';
import { nodeEl, renderEdges, resizeObserver, clampWidth } from './canvas.js';
import {
  modelsFor, defaultModelFor, modelName, loadSchema, cachedSchema, portsFromSchema, HIDDEN_PARAMS, MAIN_PARAMS,
  labelFor, valueLabel, soundParam, durationRange, schemaParam, isMediaParam, AUTO, isAspectParam,
} from './models.js';
import { splitPrompts, SPLIT_MODES } from './split.js';
import { restoreRun, deleteRun, deleteResult } from './run.js';
import { mentionField, highlightInto, renderRefStrip, snapshotAll } from './mentions.js';
import { buildCompare } from './compare.js';
import { buildSkillNode } from './skills.js';

const container = document.getElementById('nodes');

export const ICONS = {
  prompt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 6h14M5 12h10M5 18h7"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 15.5 15.5 11l-7 8"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="6" width="12.5" height="12" rx="3"/><path d="M16 10.5 20.5 8v8L16 13.5"/></svg>',
  preview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/></svg>',
  media: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/><path d="M4 15l4.5-4.5L14 16"/><circle cx="15.5" cy="9" r="1.5"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/></svg>',
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 19h16"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  llm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  batch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h5"/><path d="M9 12c3 0 3-6 6-6h5M9 12c3 0 3 6 6 6h5M9 12h11"/></svg>',
  template: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.2"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  restore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  skill: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 18A2.5 2.5 0 0 1 6.5 15.5H19"/><path d="M9 7.5h6M9 11h4"/></svg>',
  compare: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M12 2.5v19"/><path d="M8.5 10.5 6.5 12l2 1.5M15.5 10.5l2 1.5-2 1.5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
};

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};

// ---------- mount / unmount ----------
export function mountAll() {
  container.innerHTML = '';
  for (const n of Object.values(state.nodes)) mountNode(n);
  snapshotAll();
  renderEdges();
}

export function mountNode(node) {
  const el = h('div', { class: `node node-${node.type}`, 'data-id': node.id });
  el.style.left = node.x + 'px'; el.style.top = node.y + 'px';
  el.style.width = (node.w || NODE_TYPES[node.type].width) + 'px';
  el.classList.toggle('sized', !!node.w);
  container.appendChild(el);
  buildNode(node, el);
  if (node.w && clampWidth(node, el)) save();
  resizeObserver.observe(el);
  requestAnimationFrame(renderEdges);
  return el;
}
export function unmountNode(id) {
  const el = nodeEl(id);
  if (el) { resizeObserver.unobserve(el); el.remove(); }
  renderEdges();
}

function buildNode(node, el) {
  el.innerHTML = '';
  const title = node.data.title || NODE_TYPES[node.type].title;
  const head = h('div', { class: 'node-head' },
    h('span', { class: 'node-kind', html: ICONS[node.type] }),
    h('span', { class: 'node-title', spellcheck: 'false', title: 'Double-click to rename',
      ondblclick: (e) => { e.target.setAttribute('contenteditable', 'true'); e.target.focus(); document.getSelection().selectAllChildren(e.target); },
      onblur: (e) => { e.target.removeAttribute('contenteditable'); node.data.title = e.target.textContent.trim() || NODE_TYPES[node.type].title; e.target.textContent = node.data.title; save(); },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.target.blur(); } } }, title),
    h('span', { class: 'node-status' }),
    h('button', { class: 'node-menu', html: ICONS.more, title: 'More', onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); bus.emit('ctx:node', { id: node.id, x: r.left, y: r.bottom + 4 }); } }),
  );
  const ports = getPorts(node);
  if (node.type !== 'batch') for (const p of ports.outputs) head.appendChild(portEl(p, 'out', 'hport'));
  for (const p of ports.inputs.filter((x) => node.type === 'preview')) head.appendChild(portEl(p, 'in', 'hport left'));
  el.appendChild(head);

  const body = h('div', { class: 'node-body' });
  el.appendChild(body);

  switch (node.type) {
    case 'prompt': buildPrompt(node, body); break;
    case 'image': case 'video': buildGen(node, body); break;
    case 'media': buildMedia(node, body); break;
    case 'preview': buildPreview(node, body); break;
    case 'llm': buildLLM(node, body); break;
    case 'batch': buildBatch(node, body); break;
    case 'template': buildTemplate(node, body); break;
    case 'compare': buildCompare(node, body); break;
    case 'skill': buildSkillNode(node, body); break;
  }
  // Corner grips: drag to scale the node and the picture inside it. Double-click a grip to reset.
  if (RESIZABLE.has(node.type)) for (const c of ['nw', 'ne', 'sw', 'se']) el.appendChild(h('div', { class: `node-resize ${c}`, 'data-corner': c, title: 'Drag to resize · double-click to reset' }));
}

function portEl(p, dir, extra = '') {
  return h('span', { class: `port ${extra} ${p.multi ? 'multi' : ''}`, 'data-port': p.key, 'data-dir': dir, 'data-type': p.type, title: p.label });
}

// ---------- prompt ----------
function buildPrompt(node, body) {
  const ta = h('textarea', { class: 'textarea', placeholder: 'Describe what you want to see…', spellcheck: 'false' });
  ta.value = node.data.text || '';
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(320, ta.scrollHeight + 2) + 'px'; };
  ta.addEventListener('input', () => { node.data.text = ta.value; grow(); save(); bus.emit('prompt:change', node.id); });
  ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); bus.emit('run:downstream', node.id); } });
  body.appendChild(mentionField(ta, node, 'downstream', 'text'));
  requestAnimationFrame(grow);
}

// ---------- generator (image / video) ----------
function buildGen(node, body) {
  const portsBox = h('div', { class: 'ports' });
  const promptSlot = h('div', { class: 'prompt-slot' });
  const controls = h('div', { class: 'controls', style: 'display:flex;flex-direction:column;gap:8px' });
  const results = h('div', { class: 'results' });
  const errBox = h('div', { class: 'node-error', hidden: true });
  const btn = h('button', { class: 'gen-btn', onclick: () => bus.emit('run:node', node.id) }, h('span', { class: 'gen-icon', html: ICONS.play }), h('span', { class: 'gen-label' }, 'Generate'), h('span', { class: 'cost' }));
  const histDisc = h('button', { class: 'disclosure history-disc' }, h('span', { html: ICONS.chevron }), h('span', { class: 'history-label' }, 'History'));
  const histBody = h('div', { class: 'disclosure-body history' });
  histDisc.addEventListener('click', () => histDisc.classList.toggle('open'));
  body.append(portsBox, promptSlot, controls, results, histDisc, histBody, errBox, btn);

  renderPorts(node, portsBox);
  renderPromptSlot(node, promptSlot);
  renderResults(node, results);
  renderHistory(node, histBody);
  updateStatus(node);
  ensureModel(node);

  loadControls(node, controls, portsBox);
}

function loadControls(node, controls, portsBox) {
  if (!modelsFor(kindOf(node)).groups.length || !node.data.model) {
    controls.innerHTML = '';
    const loading = state.conn && state.conn.connected && !isLLM(node);
    const sel = h('select', { disabled: true });
    sel.appendChild(h('option', {}, loading ? 'Loading models…' : node.type === 'llm' ? 'No text models yet' : 'No models yet'));
    controls.appendChild(h('div', { class: 'row' }, h('label', {}, 'Model'), h('div', { class: 'select-wrap' }, sel)));
    if (!loading) {
      const what = isLLM(node) ? 'Add an Anthropic, Google or OpenAI key to choose a model.' : 'Add an API key to choose a model.';
      controls.appendChild(h('div', { class: 'node-note' }, what, ' ', h('button', { class: 'link', onclick: () => bus.emit('open:settings') }, 'Open Settings')));
    }
    return;
  }
  const schema = cachedSchema(node.data.model);
  if (schema) applySchema(node, schema, controls, portsBox);
  else { controls.innerHTML = ''; controls.appendChild(h('div', { class: 'row' }, h('label', {}, 'Model'), h('div', { class: 'control', style: 'color:var(--text-3)' }, 'Loading…'))); }
  loadSchema(node.data.model).then((s) => applySchema(node, s, controls, portsBox)).catch((e) => {
    controls.innerHTML = '';
    controls.appendChild(modelRow(node, controls, portsBox));
    controls.appendChild(h('div', { class: 'node-error' }, `Couldn't load model settings: ${e.message}`));
  });
}

function renderPorts(node, portsBox) {
  portsBox.innerHTML = '';
  for (const p of getPorts(node).inputs) {
    portsBox.appendChild(h('div', { class: 'port-row in', 'data-port-row': p.key }, portEl(p, 'in'), h('span', { class: 'port-label' }, p.label)));
  }
  // Connected images, numbered the way "@image 1" refers to them.
  if (isGen(node) || node.type === 'llm') { portsBox.appendChild(h('div', { class: 'ref-strip', hidden: true })); renderRefStrip(node, portsBox); }
}

function applySchema(node, schema, controls, portsBox) {
  node.data.schema = schema;
  const sp = portsFromSchema(kindOf(node), schema);
  const changed = !isLLM(node) && JSON.stringify(sp) !== JSON.stringify(node.data.schemaPorts || null);
  node.data.schemaPorts = sp;
  if (changed) { renderPorts(node, portsBox); pruneEdges(node.id); renderEdges(); }
  // Drop stale params not in this schema
  for (const k of Object.keys(node.data.params)) if (!schemaParam(schema, k)) delete node.data.params[k];
  buildControls(node, schema, controls, portsBox);
  updateCostLabel(node);
}

// Credits per run, when the catalogue states them.
export function updateCostLabel(node) {
  const el = nodeEl(node.id)?.querySelector('.gen-btn .cost'); if (!el) return;
  const c = node.data.schema && Number(node.data.schema.credits);
  const n = node.type === 'image' ? (node.data.batch || 1) : 1;
  el.textContent = c > 0 ? `· ${Math.round(c * n * 100) / 100} cr` : '';
}

// If the node's model isn't in the connected catalogue (e.g. a CLI model while only the API key is set), pick the first available one.
function ensureModel(node) {
  const { all } = modelsFor(kindOf(node));
  if (!all.length) return false;
  if (all.some((m) => m.job_type === node.data.model)) return false;
  // Older boards point at a specific input-mode endpoint; map it to the merged family entry.
  const MODES = /\/(text-to-video|image-to-video|reference-to-video|first-last-frame|image-reference|video-reference|text-to-image|edit)(?=\/|$)/g;
  const family = (node.data.model || '').replace(MODES, '');
  const fam = family !== node.data.model && all.find((m) => m.job_type === family);
  if (fam) { node.data.model = fam.job_type; delete node.data.schema; delete node.data.schemaPorts; save(); return true; }
  const preferred = defaultModelFor(kindOf(node));
  node.data.model = preferred.job_type; node.data.params = {}; delete node.data.schema; delete node.data.schemaPorts;
  save();
  return true;
}

function modelRow(node, controls, portsBox) {
  const { groups } = modelsFor(kindOf(node));
  const sel = h('select');
  for (const g of groups) {
    if (!g.models.length) continue;
    const og = h('optgroup', { label: g.label });
    for (const m of g.models) og.appendChild(h('option', { value: m.job_type }, modelName(m.job_type)));
    sel.appendChild(og);
  }
  if (![...sel.options].some((o) => o.value === node.data.model)) sel.appendChild(h('option', { value: node.data.model }, modelName(node.data.model)));
  sel.value = node.data.model;
  sel.addEventListener('change', async () => {
    node.data.model = sel.value;
    node.data.params = {};
    save();
    controls.querySelectorAll('.row:not(:first-child), .disclosure, .disclosure-body').forEach((x) => x.remove());
    try { applySchema(node, await loadSchema(sel.value), controls, portsBox); }
    catch (e) { controls.appendChild(h('div', { class: 'node-error' }, `Couldn't load model settings: ${e.message}`)); }
  });
  return h('div', { class: 'row' }, h('label', {}, 'Model'), h('div', { class: 'select-wrap' }, sel));
}

function getParam(node, schema, key) {
  const p = schemaParam(schema, key);
  return node.data.params[key] !== undefined ? node.data.params[key] : (p ? p.default : undefined);
}
function setParam(node, key, value) {
  node.data.params[key] = value; save();
}

function enumControl(node, schema, p) {
  const sel = h('select');
  const aspect = isAspectParam(p.name) && (node.type === 'image' || node.type === 'video');
  if (aspect) sel.appendChild(h('option', { value: AUTO }, 'Auto'));
  for (const v of p.enum) { if (aspect && String(v).toLowerCase() === 'auto') continue; sel.appendChild(h('option', { value: String(v) }, valueLabel(v))); }
  let cur = getParam(node, schema, p.name);
  if (aspect && node.data.params[p.name] === undefined) cur = AUTO; // new nodes start on Auto
  sel.value = cur === null || cur === undefined ? String(p.enum[0]) : String(cur);
  if (aspect && node.data.params[p.name] === undefined) node.data.params[p.name] = AUTO;
  sel.addEventListener('change', () => setParam(node, p.name, p.type.startsWith('integer') || p.type.startsWith('number') ? Number(sel.value) : sel.value));
  return h('div', { class: 'select-wrap' }, sel);
}
function boolControl(node, schema, p) {
  const sw = h('button', { class: 'switch', role: 'switch' });
  const set = (v) => sw.classList.toggle('on', !!v);
  set(getParam(node, schema, p.name));
  sw.addEventListener('click', () => { const v = !sw.classList.contains('on'); set(v); setParam(node, p.name, v); });
  return sw;
}
function stepperControl(node, schema, p, range, unit = 's') {
  const [min, max] = range;
  const input = h('input', { type: 'number', min, max, step: 1 });
  input.value = getParam(node, schema, p.name) ?? min;
  const clamp = (v) => Math.max(min, Math.min(max, Math.round(Number(v) || min)));
  const commit = (v) => { input.value = clamp(v); setParam(node, p.name, Number(input.value)); };
  input.addEventListener('change', () => commit(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  return h('div', { class: 'stepper' },
    h('button', { onclick: () => commit(Number(input.value) - 1), title: `Min ${min}` }, '−'),
    input, h('span', { class: 'unit' }, unit),
    h('button', { onclick: () => commit(Number(input.value) + 1), title: `Max ${max}` }, '+'));
}
const controlFor = (node, schema, p) => {
  if (p.enum) return enumControl(node, schema, p);
  if (p.type.startsWith('boolean')) return boolControl(node, schema, p);
  if (p.name === 'duration') return stepperControl(node, schema, p, durationRange(node.data.model, p));
  if (p.type.startsWith('integer') || p.type.startsWith('number')) return stepperControl(node, schema, p, [0, 100], '');
  return null;
};

function buildControls(node, schema, controls, portsBox) {
  controls.innerHTML = '';
  controls.appendChild(modelRow(node, controls, portsBox));
  const used = new Set();
  for (const key of MAIN_PARAMS[kindOf(node)] || []) {
    const p = schemaParam(schema, key); if (!p) continue;
    const c = controlFor(node, schema, p); if (!c) continue;
    used.add(key);
    controls.appendChild(h('div', { class: 'row' }, h('label', {}, labelFor(key)), c));
  }
  if (node.type === 'video') {
    const sp = soundParam(schema);
    if (sp) {
      used.add(sp.key);
      const sw = h('button', { class: 'switch', role: 'switch', title: 'Generate sound' });
      const cur = getParam(node, schema, sp.key);
      sw.classList.toggle('on', cur === sp.on || cur === true || cur === 'on');
      sw.addEventListener('click', () => { const on = !sw.classList.contains('on'); sw.classList.toggle('on', on); setParam(node, sp.key, on ? sp.on : sp.off); });
      controls.appendChild(h('div', { class: 'row' }, h('label', {}, 'Sound'), sw));
    }
  }
  if (node.type === 'image') {
    const seg = h('div', { class: 'segmented' });
    for (let i = 1; i <= 4; i++) {
      const b = h('button', { class: node.data.batch === i ? 'on' : '' }, String(i));
      b.addEventListener('click', () => { node.data.batch = i; seg.querySelectorAll('button').forEach((x, j) => x.classList.toggle('on', j + 1 === i)); save(); updateCostLabel(node); });
      seg.appendChild(b);
    }
    controls.appendChild(h('div', { class: 'row' }, h('label', {}, 'Batch'), seg));
  }
  // Advanced: everything else that is a simple enum / boolean / integer
  const extra = (schema.params || []).filter((p) => !used.has(p.name) && !HIDDEN_PARAMS.has(p.name) && !isMediaParam(schema, p.name) && !(MAIN_PARAMS[kindOf(node)] || []).includes(p.name) && (p.enum || String(p.type).startsWith('boolean')));
  if (extra.length) {
    const disc = h('button', { class: 'disclosure' }, h('span', { html: ICONS.chevron }), `Advanced · ${extra.length}`);
    const bodyEl = h('div', { class: 'disclosure-body' });
    disc.addEventListener('click', () => disc.classList.toggle('open'));
    for (const p of extra) { const c = controlFor(node, schema, p); if (c) bodyEl.appendChild(h('div', { class: 'row' }, h('label', { title: p.name }, labelFor(p.name)), c)); }
    controls.append(disc, bodyEl);
  }
}

// Prompt slot: linked prompt preview when connected, otherwise an inline textarea.
export function renderPromptSlot(node, slot) {
  slot = slot || nodeEl(node.id)?.querySelector('.prompt-slot'); if (!slot) return;
  const links = incoming(node.id, 'prompt');
  slot.innerHTML = '';
  if (links.length) {
    const text = links.map((e) => { const n = state.nodes[e.from]; if (!n) return ''; if (n.type === 'llm') return n.data.output || ''; if (n.type === 'batch') return (n.data.items || [])[Number(String(e.fromPort).replace('out', '')) || 0] || ''; return n.data.text || ''; }).map((t) => t.trim()).filter(Boolean).join('\n\n');
    const fromLLM = links.some((e) => ['llm', 'batch'].includes(state.nodes[e.from]?.type));
    const linked = h('div', { class: `linked-prompt ${text ? '' : 'empty'}`, title: text }, text || (fromLLM ? 'Waiting for the LLM output' : 'Linked prompt is empty'));
    if (text) highlightInto(linked, text, node);
    slot.appendChild(linked);
  } else {
    const ta = h('textarea', { class: 'textarea', placeholder: node.type === 'image' ? 'Prompt — or connect a Prompt node' : 'Describe the motion — or connect a Prompt node', spellcheck: 'false', style: 'min-height:64px' });
    ta.value = node.data.prompt || '';
    ta.addEventListener('input', () => { node.data.prompt = ta.value; save(); });
    ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); bus.emit('run:node', node.id); } });
    slot.appendChild(mentionField(ta, node, 'self', 'prompt'));
  }
}

export function renderResults(node, box) {
  box = box || nodeEl(node.id)?.querySelector('.results'); if (!box) return;
  box.innerHTML = '';
  const res = node.data.results || [];
  res.forEach((r, i) => {
    let t;
    if (r.status === 'completed' && r.url) {
      t = h('div', { class: `thumb ${i === node.data.selected ? 'selected' : ''}`, title: 'Click to use as output · double-click to enlarge' },
        node.type === 'video' ? h('video', { src: r.url, muted: true, loop: true, playsinline: true, preload: 'metadata' }) : h('img', { src: r.thumb || r.url, loading: 'lazy', draggable: 'false' }));
      if (node.type === 'video') { t.addEventListener('pointerenter', () => t.querySelector('video').play().catch(() => {})); t.addEventListener('pointerleave', () => t.querySelector('video').pause()); }
      t.addEventListener('click', () => { node.data.selected = i; save(); renderResults(node, box); bus.emit('results', node.id); });
      t.addEventListener('dblclick', () => bus.emit('lightbox', { items: completed(node), index: completed(node).findIndex((x) => x.url === r.url), source: node.id }));
      t.appendChild(h('button', { class: 'thumb-x', title: 'Delete this result', html: ICONS.x, onclick: (e) => { e.stopPropagation(); deleteResult(node, null, i); } }));
    } else if (r.status === 'failed' || r.status === 'nsfw' || r.status === 'cancelled' || r.status === 'canceled') {
      t = h('div', { class: 'thumb failed', title: r.error || r.status }, r.status === 'nsfw' ? 'Blocked' : 'Failed');
    } else {
      t = h('div', { class: 'thumb pending', title: r.status || 'queued' });
    }
    box.appendChild(t);
  });
}
export const completed = (node) => (node.data.results || []).filter((r) => r.status === 'completed' && r.url).map((r) => ({ ...r, kind: node.type, model: node.data.model }));

// ---------- generation history ----------
const fmtAgo = (t) => { const d = (Date.now() - t) / 1000; if (d < 60) return 'just now'; if (d < 3600) return `${Math.round(d / 60)} min ago`; if (d < 86400) return `${Math.round(d / 3600)} h ago`; return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
export function renderHistory(node, box) {
  box = box || nodeEl(node.id)?.querySelector('.history'); if (!box) return;
  const el = nodeEl(node.id); const disc = el?.querySelector('.history-disc');
  const runs = node.data.history || [];
  if (disc) { disc.hidden = !runs.length; disc.querySelector('.history-label').textContent = `History · ${runs.length} run${runs.length === 1 ? '' : 's'}`; }
  box.innerHTML = '';
  if (!runs.length) return;
  for (const run of runs) {
    const row = h('div', { class: 'hrun' });
    const head = h('div', { class: 'hrun-head' },
      h('span', { class: 'hrun-meta', title: run.prompt || '' }, `${fmtAgo(run.at)} · ${modelName(run.model)}${run.params?.aspect_ratio && run.params.aspect_ratio !== '__auto__' ? ` · ${run.params.aspect_ratio}` : ''}`),
      h('span', { class: 'hrun-tools' },
        h('button', { title: 'Make this the active result', html: ICONS.restore, onclick: () => restoreRun(node, run.id) }),
        h('button', { title: 'Delete this run', html: ICONS.trash, onclick: () => deleteRun(node, run.id) })));
    const strip = h('div', { class: 'results hstrip' });
    const items = run.results.map((r) => ({ ...r, kind: node.type, model: run.model }));
    run.results.forEach((r, i) => {
      const t = h('div', { class: 'thumb', title: run.prompt || '' }, node.type === 'video' ? h('video', { src: r.url, muted: true, loop: true, playsinline: true, preload: 'metadata' }) : h('img', { src: r.thumb || r.url, loading: 'lazy', draggable: 'false' }));
      if (node.type === 'video') { t.addEventListener('pointerenter', () => t.querySelector('video').play().catch(() => {})); t.addEventListener('pointerleave', () => t.querySelector('video').pause()); }
      t.addEventListener('click', () => bus.emit('lightbox', { items, index: i, source: node.id }));
      t.appendChild(h('button', { class: 'thumb-x', title: 'Delete this result', html: ICONS.x, onclick: (e) => { e.stopPropagation(); deleteResult(node, run.id, i); } }));
      strip.appendChild(t);
    });
    row.append(head, strip);
    box.appendChild(row);
  }
  const clear = h('button', { class: 'btn small danger', onclick: () => { node.data.history = []; save(true); bus.emit('history', node.id); } }, 'Clear history');
  box.appendChild(h('div', { class: 'hrun-foot' }, clear));
}
bus.on('history', (id) => { const n = state.nodes[id]; if (n) { renderHistory(n); renderEdges(); } });
bus.on('generated', (id) => { const n = state.nodes[id]; if (n) renderHistory(n); });

export function updateStatus(node) {
  const el = nodeEl(node.id); if (!el) return;
  const st = el.querySelector('.node-status');
  const btn = el.querySelector('.gen-btn');
  const err = el.querySelector('.node-error');
  const s = node.data.status;
  el.classList.toggle('running', s === 'running');
  el.classList.toggle('error', s === 'error');
  if (st) {
    st.className = 'node-status';
    if (s === 'running') { st.textContent = progressText(node); }
    else if (s === 'done') { st.textContent = node.data.autoRatio ? `Done · ${node.data.autoRatio}` : 'Done'; st.classList.add('ok'); }
    else if (s === 'error') { st.textContent = 'Failed'; st.classList.add('err'); }
    else st.textContent = '';
  }
  if (btn) {
    btn.classList.toggle('running', s === 'running');
    btn.disabled = s === 'running';
    btn.querySelector('.gen-label').textContent = node.type === 'template' ? (s === 'running' ? 'Compiling…' : 'Compile') : isLLM(node) ? (s === 'running' ? 'Thinking…' : 'Run') : (s === 'running' ? 'Generating…' : 'Generate');
    const icon = btn.querySelector('.gen-icon');
    icon.innerHTML = s === 'running' ? '<span class="spinner"></span>' : ICONS.play;
  }
  if (err) { err.hidden = !(s === 'error' && node.data.error); err.textContent = node.data.error || ''; }
}
function progressText(node) {
  if (isLLM(node)) return 'Thinking';
  const res = node.data.results || [];
  const done = res.filter((r) => r.status === 'completed').length;
  return res.length > 1 ? `${done}/${res.length}` : 'Running';
}

// ---------- LLM ----------
function buildLLM(node, body) {
  const portsBox = h('div', { class: 'ports' });
  // System prompt: how the model should think. Collapsed unless it has content.
  const sysDisc = h('button', { class: `disclosure ${node.data.system ? 'open' : ''}` }, h('span', { html: ICONS.chevron }), 'System prompt');
  const sysBody = h('div', { class: 'disclosure-body' });
  const sys = h('textarea', { class: 'textarea', placeholder: 'How the model should think: its role, rules, style and output format. e.g. "You are a cinematographer. Answer only with the final prompt, no preamble."', spellcheck: 'false', style: 'min-height:84px' });
  sys.value = node.data.system || '';
  const growSys = () => { sys.style.height = 'auto'; sys.style.height = Math.min(260, Math.max(84, sys.scrollHeight + 2)) + 'px'; };
  sys.addEventListener('input', () => { node.data.system = sys.value; growSys(); save(); sysDisc.classList.toggle('has', !!sys.value.trim()); });
  sysDisc.classList.toggle('has', !!(node.data.system || '').trim());
  sysDisc.addEventListener('click', () => { sysDisc.classList.toggle('open'); if (sysDisc.classList.contains('open')) { growSys(); sys.focus(); } });
  sysBody.appendChild(mentionField(sys, node, 'self', 'system'));
  const instr = h('textarea', { class: 'textarea', placeholder: 'Instruction for this input, e.g. "Write a Seedance prompt for a slow push-in through this scene."', spellcheck: 'false', style: 'min-height:72px' });
  instr.value = node.data.instructions || '';
  instr.addEventListener('input', () => { node.data.instructions = instr.value; save(); });
  instr.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); bus.emit('run:node', node.id); } });
  const controls = h('div', { class: 'controls', style: 'display:flex;flex-direction:column;gap:8px' });
  const outHead = h('div', { class: 'llm-output-head' }, h('span', {}, 'Output'), h('button', { title: 'Copy output', onclick: () => { navigator.clipboard?.writeText(node.data.output || ''); bus.emit('toast', { msg: 'Copied.' }); } }, 'Copy'));
  const out = h('textarea', { class: 'llm-output', placeholder: 'The model\u2019s text appears here and feeds whatever is connected to the Text port. You can edit it.', spellcheck: 'false' });
  out.value = node.data.output || '';
  const grow = () => { out.style.height = 'auto'; out.style.height = Math.min(260, Math.max(72, out.scrollHeight + 2)) + 'px'; };
  out.addEventListener('input', () => { node.data.output = out.value; grow(); save(); bus.emit('prompt:change', node.id); });
  const errBox = h('div', { class: 'node-error', hidden: true });
  const btn = h('button', { class: 'gen-btn', onclick: () => bus.emit('run:node', node.id) }, h('span', { class: 'gen-icon', html: ICONS.play }), h('span', { class: 'gen-label' }, 'Run'), h('span', { class: 'cost' }));
  body.append(portsBox, sysDisc, sysBody, h('div', { class: 'llm-output-head' }, h('span', {}, 'Instruction')), mentionField(instr, node, 'self', 'instructions'), controls, outHead, mentionField(out, node, 'downstream', 'output'), errBox, btn);
  renderPorts(node, portsBox);
  updateStatus(node);
  ensureModel(node);
  loadControls(node, controls, portsBox);
  requestAnimationFrame(() => { grow(); if (node.data.system) growSys(); });
  bus.on('llm:output', (id) => { if (id === node.id) { out.value = node.data.output || ''; grow(); } });
}

// ---------- prompt batch ----------
// Text from an LLM or Prompt node arriving on this node's input.
function batchSourceText(node) {
  return incoming(node.id, 'prompt').map((e) => { const n = state.nodes[e.from]; return n ? (n.type === 'llm' ? n.data.output : n.type === 'batch' ? '' : n.data.text) || '' : ''; }).map((t) => t.trim()).filter(Boolean).join('\n\n');
}
export function recomputeBatch(node) {
  const items = splitPrompts(batchSourceText(node), node.data.mode, node.data.separator);
  const changed = JSON.stringify(items) !== JSON.stringify(node.data.items || []);
  node.data.items = items;
  if (changed) { save(); pruneEdges(node.id); }
  renderBatchList(node);
  renderEdges();
  if (changed) bus.emit('prompt:change', node.id);
}
function renderBatchList(node) {
  const el = nodeEl(node.id); if (!el) return;
  const list = el.querySelector('.batch-list'); const count = el.querySelector('.batch-count'); if (!list) return;
  list.innerHTML = '';
  const items = node.data.items || [];
  count.textContent = items.length ? `${items.length} prompt${items.length === 1 ? '' : 's'}` : '';
  if (!items.length) {
    list.appendChild(h('div', { class: 'node-note' }, incoming(node.id, 'prompt').length ? 'Waiting for text from the connected node.' : 'Connect an LLM or Prompt node. Each prompt it contains becomes its own output.'));
    return;
  }
  items.forEach((t, i) => {
    const row = h('div', { class: 'port-row out batch-row', 'data-port-row': `out${i}`, title: t },
      h('span', { class: 'batch-index' }, String(i + 1)),
      h('span', { class: 'batch-text' }, t.replace(/\s+/g, ' ')),
      portEl({ key: `out${i}`, type: 'text', label: `Prompt ${i + 1}` }, 'out'));
    list.appendChild(row);
  });
  el.querySelector('.batch-fan').hidden = items.length === 0;
}
function buildBatch(node, body) {
  const portsBox = h('div', { class: 'ports' });
  renderPorts(node, portsBox);
  const modeSel = h('select');
  for (const m of SPLIT_MODES) modeSel.appendChild(h('option', { value: m.id }, m.label));
  modeSel.value = node.data.mode || 'auto';
  const sepWrap = h('div', { class: 'row', hidden: node.data.mode !== 'custom' }, h('label', {}, 'Separator'));
  const sepInput = h('input', { class: 'text-input', placeholder: 'e.g. ###', spellcheck: 'false' });
  sepInput.value = node.data.separator || '';
  sepInput.addEventListener('input', () => { node.data.separator = sepInput.value; recomputeBatch(node); });
  sepWrap.appendChild(sepInput);
  modeSel.addEventListener('change', () => { node.data.mode = modeSel.value; sepWrap.hidden = modeSel.value !== 'custom'; recomputeBatch(node); });
  const head = h('div', { class: 'llm-output-head' }, h('span', {}, 'Prompts'), h('span', { class: 'batch-count' }));
  const list = h('div', { class: 'batch-list' });
  const fan = h('div', { class: 'batch-fan', hidden: true },
    h('button', { class: 'btn small', onclick: () => bus.emit('batch:fanout', { id: node.id, type: 'image' }) }, h('span', { html: ICONS.image }), 'Image per prompt'),
    h('button', { class: 'btn small', onclick: () => bus.emit('batch:fanout', { id: node.id, type: 'video' }) }, h('span', { html: ICONS.video }), 'Video per prompt'));
  body.append(portsBox, h('div', { class: 'row' }, h('label', {}, 'Split by'), h('div', { class: 'select-wrap' }, modeSel)), sepWrap, head, list, fan);
  renderBatchList(node);
}

// ---------- template (one port per section, compiled by the template's system prompt) ----------
function buildTemplate(node, body) {
  const spec = node.data.spec;
  if (!spec) { body.appendChild(h('div', { class: 'node-note' }, 'This template is missing its definition.')); return; }
  if (spec.description) body.appendChild(h('div', { class: 'tpl-desc' }, spec.description));
  const tools = h('div', { class: 'tpl-tools' },
    h('button', { class: `disclosure ${node.data.compact ? '' : 'open'}`, onclick: (e) => { node.data.compact = !node.data.compact; e.currentTarget.classList.toggle('open', !node.data.compact); list.classList.toggle('compact', node.data.compact); save(); renderEdges(); } }, h('span', { html: ICONS.chevron }), 'Descriptions'));
  const list = h('div', { class: `tpl-sections ${node.data.compact ? 'compact' : ''}` });
  for (const sec of spec.sections) list.appendChild(buildSection(node, sec));
  const controls = h('div', { class: 'controls', style: 'display:flex;flex-direction:column;gap:8px' });
  const outHead = h('div', { class: 'llm-output-head' }, h('span', {}, 'Compiled prompt'), h('button', { title: 'Copy output', onclick: () => { navigator.clipboard?.writeText(node.data.output || ''); bus.emit('toast', { msg: 'Copied.' }); } }, 'Copy'));
  const out = h('textarea', { class: 'llm-output', placeholder: 'The compiled prompt appears here and feeds the Text port. You can edit it.', spellcheck: 'false' });
  out.value = node.data.output || '';
  const grow = () => { out.style.height = 'auto'; out.style.height = Math.min(320, Math.max(72, out.scrollHeight + 2)) + 'px'; };
  out.addEventListener('input', () => { node.data.output = out.value; grow(); save(); bus.emit('prompt:change', node.id); });
  const errBox = h('div', { class: 'node-error', hidden: true });
  const btn = h('button', { class: 'gen-btn', onclick: () => bus.emit('run:node', node.id) }, h('span', { class: 'gen-icon', html: ICONS.play }), h('span', { class: 'gen-label' }, 'Compile'), h('span', { class: 'cost' }));
  body.append(tools, list, controls, outHead, mentionField(out, node, 'downstream', 'output'), spec.outputNote ? h('div', { class: 'tpl-note' }, spec.outputNote) : '', errBox, btn);
  updateStatus(node);
  ensureModel(node);
  loadControls(node, controls, list);
  requestAnimationFrame(grow);
  bus.on('llm:output', (id) => { if (id === node.id) { out.value = node.data.output || ''; grow(); } });
}
function buildSection(node, sec) {
  const isImg = sec.type === 'images';
  const port = { key: isImg ? `i_${sec.key}` : `s_${sec.key}`, type: isImg ? 'image' : 'text', label: sec.label, multi: isImg ? sec.multi !== false : true };
  const row = h('div', { class: `tpl-section ${isImg ? 'img' : 'txt'}`, 'data-port-row': port.key });
  const info = sec.guide ? h('button', { class: 'tpl-info', title: 'What goes here?', html: ICONS.info, onclick: (e) => { e.stopPropagation(); bus.emit('guide', { title: sec.label, description: sec.description, optional: !sec.required, guide: sec.guide }); } }) : null;
  row.appendChild(h('div', { class: 'port-row in tpl-head' }, portEl(port, 'in'), h('span', { class: 'port-label' }, sec.label), info, sec.required ? h('span', { class: 'tpl-req' }, 'recommended') : h('span', { class: 'tpl-opt' }, 'optional')));
  if (sec.description) row.appendChild(h('div', { class: 'tpl-help' }, sec.description));
  const slot = h('div', { class: 'tpl-slot' });
  row.appendChild(slot);
  renderSectionSlot(node, sec, slot);
  return row;
}
function renderSectionSlot(node, sec, slot) {
  slot = slot || nodeEl(node.id)?.querySelector(`.tpl-section[data-port-row="${sec.type === 'images' ? 'i_' : 's_'}${sec.key}"] .tpl-slot`); if (!slot) return;
  slot.innerHTML = '';
  if (sec.type === 'images') {
    slot.appendChild(h('div', { class: 'ref-strip', 'data-port': `i_${sec.key}`, 'data-empty': 'No image connected' }));
    renderRefStrip(node, slot);
    return;
  }
  const links = incoming(node.id, `s_${sec.key}`);
  if (links.length) {
    const text = links.map((e) => { const s = state.nodes[e.from]; if (!s) return ''; if (s.type === 'batch') return (s.data.items || [])[Number(String(e.fromPort).replace('out', '')) || 0] || ''; return (isLLM(s) ? s.data.output : s.data.text) || ''; }).map((t) => t.trim()).filter(Boolean).join('\n\n');
    const linked = h('div', { class: `linked-prompt ${text ? '' : 'empty'}`, title: text }, text || 'Linked text is empty');
    if (text) highlightInto(linked, text, node);
    slot.appendChild(linked);
  }
  const ta = h('textarea', { class: 'textarea tpl-input', placeholder: links.length ? 'Extra notes (added to the linked text)…' : 'Type here, or connect a Prompt or LLM node…', spellcheck: 'false', rows: 1 });
  ta.value = node.data.values?.[sec.key] || '';
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(220, Math.max(34, ta.scrollHeight + 2)) + 'px'; renderEdges(); };
  ta.addEventListener('input', () => { (node.data.values ||= {})[sec.key] = ta.value; grow(); save(); });
  ta.addEventListener('focus', grow);
  slot.appendChild(mentionField(ta, node, 'self', `values.${sec.key}`));
  if (ta.value) requestAnimationFrame(grow);
}
function refreshTemplateSlots(node) {
  if (!node.data.spec) return;
  for (const sec of node.data.spec.sections) renderSectionSlot(node, sec);
  renderEdges();
}

// ---------- media ----------
function buildMedia(node, body) {
  const frame = h('div', { class: 'media-frame', title: 'Click to enlarge' });
  const meta = h('div', { class: 'media-meta' });
  body.append(frame, meta);
  renderMedia(node, frame, meta);
}
function renderMedia(node, frame, meta) {
  frame.innerHTML = '';
  const d = node.data;
  if (d.kind === 'video') {
    const v = h('video', { src: d.url, muted: true, loop: true, playsinline: true, preload: 'metadata' });
    v.addEventListener('loadedmetadata', () => { d.w = v.videoWidth; d.h = v.videoHeight; meta.textContent = ''; meta.append(h('span', {}, `${d.w}×${d.h}`), h('span', {}, fmtDur(v.duration))); save(); renderEdges(); });
    frame.addEventListener('pointerenter', () => v.play().catch(() => {}));
    frame.addEventListener('pointerleave', () => v.pause());
    frame.append(v, h('span', { class: 'badge' }, 'Video'));
  } else if (d.kind === 'audio') {
    const a = h('audio', { src: d.url, controls: true, preload: 'metadata' });
    a.addEventListener('loadedmetadata', () => { meta.textContent = ''; meta.append(h('span', {}, fmtDur(a.duration)), h('span', {}, d.name || '')); renderEdges(); });
    frame.style.cursor = 'default';
    frame.append(h('div', { class: 'audio-wrap' }, h('span', { class: 'audio-icon', html: ICONS.audio }), a));
  } else {
    const img = h('img', { src: d.url, draggable: 'false' });
    img.addEventListener('load', () => { d.w = img.naturalWidth; d.h = img.naturalHeight; meta.textContent = ''; meta.append(h('span', {}, `${d.w}×${d.h}`), h('span', {}, d.jobId ? modelName(d.model || '') : (d.name || ''))); save(); renderEdges(); });
    frame.appendChild(img);
  }
  if (d.kind !== 'audio') frame.addEventListener('click', () => bus.emit('lightbox', { items: [{ url: d.url, kind: d.kind, jobId: d.jobId, name: d.name, model: d.model }], index: 0, source: node.id }));
  meta.append(h('span', {}, d.w ? `${d.w}×${d.h}` : ''), h('span', {}, d.name || ''));
}
const fmtDur = (s) => (isFinite(s) ? `${Math.round(s * 10) / 10}s` : '');

// ---------- preview ----------
function buildPreview(node, body) {
  const grid = h('div', { class: 'preview-grid' });
  body.appendChild(grid);
  renderPreview(node, grid);
}
export function renderPreview(node, grid) {
  grid = grid || nodeEl(node.id)?.querySelector('.preview-grid'); if (!grid) return;
  grid.innerHTML = '';
  const link = incoming(node.id, 'in')[0];
  const src = link && state.nodes[link.from];
  if (!src) { grid.className = 'preview-grid'; grid.appendChild(h('div', { class: 'preview-empty' }, 'Connect an Image, Video or Media node to preview it here.')); return; }
  if (isLLM(src)) { grid.className = 'preview-grid'; grid.appendChild(h('div', { class: 'preview-empty', style: 'text-align:left;white-space:pre-wrap;color:var(--text-2)' }, src.data.output || 'Run the LLM node to see its text here.')); return; }
  let items = [];
  if (src.type === 'media') items = [{ url: src.data.url, kind: src.data.kind, jobId: src.data.jobId, name: src.data.name, status: 'completed' }];
  else if (isGen(src)) items = (src.data.results || []).map((r) => ({ ...r, kind: src.type, model: src.data.model }));
  if (!items.length) { grid.className = 'preview-grid'; grid.appendChild(h('div', { class: 'preview-empty' }, src.data.status === 'running' ? 'Generating…' : 'Nothing generated yet. Run the connected node.')); return; }
  grid.className = `preview-grid n${Math.min(4, items.length)}`;
  const done = items.filter((r) => r.status === 'completed' && r.url);
  items.forEach((r) => {
    if (r.status !== 'completed' || !r.url) {
      grid.appendChild(h('div', { class: `preview-item ${/fail|nsfw|cancel/.test(r.status || '') ? 'failed' : 'pending'}`, title: r.error || r.status }, /fail|nsfw|cancel/.test(r.status || '') ? h('span', { style: 'color:var(--danger);font-size:12px' }, r.status === 'nsfw' ? 'Blocked' : 'Failed') : null));
      return;
    }
    const item = h('div', { class: 'preview-item' });
    if (r.kind === 'audio') {
      item.classList.add('audio');
      item.appendChild(h('div', { class: 'audio-wrap' }, h('span', { class: 'audio-icon', html: ICONS.audio }), h('audio', { src: r.url, controls: true, preload: 'metadata' })));
      grid.appendChild(item);
      return;
    }
    if (r.kind === 'video') {
      const v = h('video', { src: r.url, muted: true, loop: true, playsinline: true, preload: 'metadata' });
      v.addEventListener('loadedmetadata', () => { item.style.setProperty('--ar', `${v.videoWidth}/${v.videoHeight}`); renderEdges(); });
      item.addEventListener('pointerenter', () => v.play().catch(() => {})); item.addEventListener('pointerleave', () => v.pause());
      item.appendChild(v);
    } else {
      const img = h('img', { src: r.thumb || r.url, draggable: 'false', loading: 'lazy' });
      img.addEventListener('load', () => { item.style.setProperty('--ar', `${img.naturalWidth}/${img.naturalHeight}`); renderEdges(); });
      item.appendChild(img);
    }
    const idx = done.findIndex((x) => x.url === r.url);
    const open = () => bus.emit('lightbox', { items: done, index: idx, source: src.id, preview: node.id });
    item.addEventListener('click', open);
    item.appendChild(h('div', { class: 'pi-actions' },
      h('button', { title: 'Enlarge', html: ICONS.expand, onclick: (e) => { e.stopPropagation(); open(); } }),
      h('button', { title: 'Import to board as a node', html: ICONS.plus, onclick: (e) => { e.stopPropagation(); bus.emit('import', { item: r, near: node.id }); } }),
      h('button', { title: 'Download', html: ICONS.download, onclick: (e) => { e.stopPropagation(); bus.emit('download', r); } }),
    ));
    grid.appendChild(item);
  });
}

// ---------- refresh hooks ----------
export function refreshNode(id) {
  const node = state.nodes[id]; if (!node) return;
  if (isGen(node)) { renderResults(node); updateStatus(node); renderHistory(node); }
  if (isLLM(node)) updateStatus(node);
  if (node.type === 'preview') renderPreview(node);
  renderEdges();
}

// Previews that watch a given source node.
function previewsOf(sourceId) {
  return Object.values(state.edges).filter((e) => e.from === sourceId && state.nodes[e.to]?.type === 'preview').map((e) => state.nodes[e.to]);
}
bus.on('results', (id) => { previewsOf(id).forEach((p) => renderPreview(p)); refreshNode(id); });
bus.on('status', (id) => { const n = state.nodes[id]; if (n) { updateStatus(n); previewsOf(id).forEach((p) => renderPreview(p)); renderEdges(); } });
bus.on('prompt:change', (promptId) => {
  for (const e of Object.values(state.edges)) if (e.from === promptId && (e.toPort === 'prompt' || e.toPort.startsWith('s_'))) {
    const n = state.nodes[e.to]; if (!n) continue;
    if (n.type === 'batch') recomputeBatch(n);
    else if (n.type === 'template') refreshTemplateSlots(n);
    else if (!isLLM(n)) renderPromptSlot(n);
  }
  previewsOf(promptId).forEach((p) => renderPreview(p));
});
bus.on('batch:update', (id) => { const n = state.nodes[id]; if (n) { renderBatchList(n); pruneEdges(id); renderEdges(); bus.emit('prompt:change', id); } });
bus.on('edge:add', (e) => { const n = state.nodes[e.to]; if (!n) return; if (n.type === 'template') refreshTemplateSlots(n); else if (n.type === 'batch') recomputeBatch(n); else if (e.toPort === 'prompt') renderPromptSlot(n); if (n.type === 'preview') renderPreview(n); });
bus.on('edge:remove', (e) => { const n = state.nodes[e.to]; if (!n) return; if (n.type === 'template') refreshTemplateSlots(n); else if (n.type === 'batch') recomputeBatch(n); else if (e.toPort === 'prompt') renderPromptSlot(n); if (n.type === 'preview') renderPreview(n); });
// Connected images changed: linked prompt previews show whether their mentions still resolve.
bus.on('mentions:change', (id) => { const n = state.nodes[id]; if (n && isGen(n) && incoming(id, 'prompt').length) renderPromptSlot(n); });
bus.on('node:add', (n) => mountNode(n));
bus.on('node:remove', (n) => unmountNode(n.id));
bus.on('models', () => {
  for (const n of Object.values(state.nodes)) {
    if (!isRunnable(n)) continue;
    const el = nodeEl(n.id); if (!el) continue;
    ensureModel(n);
    delete n.data.schema;
    loadControls(n, el.querySelector('.controls'), el.querySelector('.ports'));
  }
});
