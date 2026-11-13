// Combine: several pieces of text in, one text out.
// Connect Prompt nodes, LLM outputs, a Prompt batch or a Link out's text to it. The pieces are joined in the order
// listed, with whatever you choose between them. No model is involved and nothing is reworded: the output is exactly
// the pieces, one after another. It follows its sources as they change, and its output goes anywhere a prompt can.
import { state, bus, save, incoming, removeEdge, reorderEdges, NODE_TYPES } from './state.js';
import { nodeEl, renderEdges } from './canvas.js';
import { linkedTextOf } from './nodes.js';

const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };
export const SEPARATORS = [['blank', 'A blank line', '\n\n'], ['line', 'A new line', '\n'], ['space', 'A space', ' '], ['comma', 'A comma', ', '], ['none', 'Nothing', ''], ['custom', 'Your own…', null]];
// What goes between two pieces. In your own separator, \n stands for a new line.
export function separatorOf(node) {
  const d = node.data; const found = SEPARATORS.find((s) => s[0] === d.sep) || SEPARATORS[0];
  return found[2] === null ? String(d.custom || '').replace(/\\n/g, '\n') : found[2];
}
// The pieces as they stand, in order: [{ edge, src, name, text, linked }]. A batch's "All prompts" gives one per prompt.
function piecesOf(node) {
  const out = [];
  for (const e of incoming(node.id, 'prompt')) {
    const src = state.nodes[e.from]; if (!src) continue;
    const name = src.data.title || NODE_TYPES[src.type]?.title || src.type; const linked = String(e.id).includes('~');
    if (src.type === 'batch' && e.fromPort === 'all') { const items = src.data.items || []; if (!items.length) out.push({ edge: e.id, src: src.id, name, text: '', linked }); items.forEach((t, i) => out.push({ edge: e.id, src: src.id, name: `${name} · ${i + 1}`, text: t, linked, part: i > 0 })); }
    else out.push({ edge: e.id, src: src.id, name, text: linkedTextOf(e) || '', linked });
  }
  return out;
}
export const joinPieces = (node, texts) => texts.map((t) => String(t || '').trim()).filter(Boolean).join(separatorOf(node));

const views = new Map();
export function buildCombine(node, body) {
  const d = node.data;
  const ports = el('div', 'ports');
  const row = el('div', 'port-row in'); row.dataset.portRow = 'prompt';
  const port = el('span', 'port multi'); port.dataset.port = 'prompt'; port.dataset.dir = 'in'; port.dataset.type = 'text'; port.title = 'Text to combine';
  row.append(port, el('span', 'port-label', 'Text to combine'));
  ports.appendChild(row);

  const list = el('div', 'cmb-list');
  const sepRow = el('div', 'row cmb-sep');
  const sel = el('select');
  for (const [id, label] of SEPARATORS) { const o = el('option', '', label); o.value = id; sel.appendChild(o); }
  sel.value = SEPARATORS.some((s) => s[0] === d.sep) ? d.sep : 'blank';
  const wrap = el('div', 'select-wrap'); wrap.appendChild(sel);
  const custom = el('input', 'text-input cmb-custom'); custom.type = 'text'; custom.spellcheck = false; custom.placeholder = 'e.g.  |  or \\n---\\n'; custom.value = d.custom || ''; custom.hidden = sel.value !== 'custom';
  custom.title = 'Typed between each piece. \\n stands for a new line.';
  sel.addEventListener('change', () => { d.sep = sel.value; custom.hidden = sel.value !== 'custom'; save(); recomputeCombine(node); if (!custom.hidden) custom.focus(); });
  custom.addEventListener('input', () => { d.custom = custom.value; save(); recomputeCombine(node); });
  sepRow.append(el('label', '', 'Between each'), wrap);

  const out = el('div', 'cmb-out'); out.title = 'The combined text, as it will be sent';
  const foot = el('div', 'cmb-foot');
  const count = el('span', 'cmb-count');
  const copy = el('button', 'btn small', 'Copy'); copy.type = 'button';
  copy.addEventListener('click', (e) => { e.stopPropagation(); if (!d.text) return; navigator.clipboard?.writeText(d.text); bus.emit('toast', { msg: 'Combined text copied.', kind: 'ok' }); });
  foot.append(count, copy);
  body.append(ports, list, sepRow, custom, out, foot);
  views.set(node.id, { list, out, count, copy });
  recomputeCombine(node, true);
}

// Work the combined text out again, redraw the node, and tell whatever uses it when the text has changed.
export function recomputeCombine(node, quiet = false) {
  const pieces = piecesOf(node);
  const text = joinPieces(node, pieces.map((p) => p.text));
  const changed = text !== (node.data.text || '');
  node.data.text = text;
  if (changed) save();
  draw(node, pieces);
  if (changed && !quiet) bus.emit('prompt:change', node.id);
  return changed;
}
function draw(node, pieces) {
  const v = views.get(node.id); if (!v || !v.list.isConnected) return;
  v.list.innerHTML = '';
  if (!pieces.length) v.list.appendChild(el('div', 'node-note', 'Connect two or more Prompt or LLM nodes. Their text is joined into one, in the order shown here.'));
  const strands = [...new Set(pieces.map((p) => String(p.edge).split('~')[0]))].length;
  pieces.forEach((p, i) => {
    const row = el('div', `cmb-row ${p.text.trim() ? '' : 'empty'}`); row.dataset.edge = p.edge;
    const grip = el('span', 'cmb-grip'); grip.innerHTML = '<svg viewBox="0 0 8 12" width="8" height="12"><g fill="currentColor"><circle cx="2" cy="2" r="1"/><circle cx="6" cy="2" r="1"/><circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/><circle cx="2" cy="10" r="1"/><circle cx="6" cy="10" r="1"/></g></svg>';
    grip.title = strands > 1 ? 'Drag to change the order' : ''; grip.classList.toggle('off', strands < 2);
    if (strands > 1) grip.addEventListener('pointerdown', (e) => startSort(e, node, row, v.list));
    const body = el('span', 'cmb-piece');
    body.append(el('b', '', p.name), el('span', '', p.text.trim() ? p.text.trim().replace(/\s+/g, ' ') : 'No text yet'));
    body.title = p.text.trim() || 'No text yet';
    row.append(grip, el('span', 'cmb-n', String(i + 1)), body);
    // A piece that arrives through a Link out, or is one prompt of a batch, is unplugged where it comes from.
    if (!p.linked && !p.part) {
      const x = el('button', 'cmb-x'); x.type = 'button'; x.title = `Disconnect ${p.name}`; x.textContent = '×';
      x.addEventListener('click', (e) => { e.stopPropagation(); removeEdge(p.edge); });
      row.appendChild(x);
    }
    row.addEventListener('pointerenter', () => nodeEl(p.src)?.classList.add('mention-hl')); // light up where the piece comes from
    row.addEventListener('pointerleave', () => nodeEl(p.src)?.classList.remove('mention-hl'));
    v.list.appendChild(row);
  });
  const text = node.data.text || '';
  v.out.textContent = text; v.out.classList.toggle('empty', !text);
  if (!text) v.out.textContent = pieces.length ? 'The connected nodes have no text yet.' : 'The combined text appears here.';
  const used = pieces.filter((p) => p.text.trim()).length;
  v.count.textContent = text ? `${used} piece${used === 1 ? '' : 's'} · ${text.length.toLocaleString()} character${text.length === 1 ? '' : 's'}` : '';
  v.copy.disabled = !text;
  renderEdges();
}

// Drag a row by its grip to change the order the pieces are joined in. The list holds the pointer, not the row:
// a row is moved in the page as it is dragged, and an element that is moved lets go of the pointer.
function startSort(e, node, row, list) {
  if (e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  list.setPointerCapture(e.pointerId); row.classList.add('sorting');
  const move = (ev) => {
    const rows = [...list.querySelectorAll('.cmb-row')].filter((r) => r !== row);
    const after = rows.find((r) => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
    if (after) { if (row.nextElementSibling !== after) list.insertBefore(row, after); } else if (list.lastElementChild !== row) list.appendChild(row);
  };
  const up = () => {
    list.removeEventListener('pointermove', move); list.removeEventListener('pointerup', up); list.removeEventListener('pointercancel', up);
    row.classList.remove('sorting');
    const ids = [...list.querySelectorAll('.cmb-row')].map((r) => r.dataset.edge);
    if (!reorderEdges(node.id, 'prompt', ids)) recomputeCombine(node); // nothing moved: put the rows back as they were
  };
  list.addEventListener('pointermove', move); list.addEventListener('pointerup', up); list.addEventListener('pointercancel', up);
}

bus.on('edges:reorder', ({ id }) => { const n = state.nodes[id]; if (n && n.type === 'combine') recomputeCombine(n); });
bus.on('node:renamed', () => { for (const n of Object.values(state.nodes)) if (n.type === 'combine') recomputeCombine(n); });
bus.on('node:remove', (n) => views.delete(n.id));
