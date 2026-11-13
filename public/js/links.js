// Link in and Link out: a connection without a strand.
// Plug references (images, video, audio, prompts) into a Link in and give it a name; it can sit off to the side with
// them. Anywhere else on the board, a Link out that names that link stands for everything plugged into it: connect
// its ports to the nodes beside it with short strands. No line is drawn between a Link in and its Link outs.
//
// A link holds nothing of its own. state.js looks straight through it (incoming / outgoing), so a node fed by a Link
// out sees the real Prompt, Image or upload, and follows it when it changes. This file only draws the two nodes and
// tells the nodes downstream to look again when what a link holds has changed. Links belong to one board.
import { state, bus, save, addNode, select, outgoingRaw, linkSources, linkOuts, linkWouldLoop, getPorts, LINK_KINDS, LINK_LABELS } from './state.js';
import { nodeEl, renderEdges, animateToRect } from './canvas.js';
import { picture, clip } from './thumbs.js';
import { showPeek, hidePeek } from './peek.js';
import { connectedItems } from './nodes.js';

const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };
const toast = (msg, kind) => bus.emit('toast', { msg, kind });
// Each link gets a tone, shown as a dot on the Link in and on every Link out, so the two halves are easy to pair up.
const TONES = ['#f2e5bb', '#f3b9a6', '#b9e0ae', '#a9dede', '#b3c2f5', '#d9bbee', '#f0a6c8', '#d4d6db'];
const toneOf = (link) => TONES[(link && link.data.tone) % TONES.length] || TONES[0];
const ICON = {
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 7h14M5 12h14M5 17h9"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M4 15l4.5-4 4 3.5 3-2.5 4.5 4"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="6" width="12" height="12" rx="2.5"/><path d="M15.5 10.5l5-3v9l-5-3z"/></svg>',
  jump: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>',
};

export const allLinks = () => Object.values(state.nodes).filter((n) => n.type === 'linkin');
export const linkName = (link) => (link && (link.data.name || '').trim()) || 'Untitled link';
function freeName(base, exceptId) {
  const taken = new Set(allLinks().filter((n) => n.id !== exceptId).map((n) => linkName(n).toLowerCase()));
  if (base && !taken.has(base.toLowerCase())) return base;
  const stem = (base || 'Link').replace(/\s+\d+$/, '');
  for (let i = base ? 2 : 1; ; i++) if (!taken.has(`${stem} ${i}`.toLowerCase())) return `${stem} ${i}`;
}
// The link a new Link out should start on: the one last made, named or clicked.
let recent = null;
const preferred = () => (state.nodes[recent]?.type === 'linkin' ? state.nodes[recent] : allLinks().pop() || null);

// ---------- what a link holds ----------
// One entry per thing plugged in, in order: { kind, url, name, text }.
const itemsOf = (link) => (link ? connectedItems(link, 'in').map((it) => ({ ...it, kind: it.kind || 'text' })) : []);
const kindsOf = (link) => linkSources(link && link.id).map((e) => e.type);
function summary(kinds) {
  const one = { image: 'image', video: 'video', audio: 'audio clip', text: 'text' };
  const parts = LINK_KINDS.map((k) => [k, kinds.filter((x) => x === k).length]).filter(([, n]) => n).map(([k, n]) => `${n} ${one[k]}${n === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
function tiles(box, items, empty) {
  box.innerHTML = '';
  if (!items.length) { box.appendChild(el('div', 'link-empty', empty)); return; }
  for (const it of items) {
    const tile = el('span', `mention-thumb link-tile ${it.kind}`);
    if (it.url && it.kind === 'video') tile.appendChild(clip(it.url));
    else if (it.url && it.kind === 'image') tile.appendChild(picture(it.url));
    else tile.innerHTML = ICON[it.kind] || ICON.text;
    const about = it.kind === 'text' ? { text: (it.text || '').trim() || 'No text yet' } : { kind: it.kind, url: it.url || undefined, text: it.url ? undefined : (it.text || (it.kind === 'audio' ? 'Audio' : 'Nothing generated yet')) };
    tile.addEventListener('pointerenter', () => showPeek(tile, { title: it.name, subtitle: it.kind === 'text' ? 'Text' : it.kind[0].toUpperCase() + it.kind.slice(1), ...about }));
    tile.addEventListener('pointerleave', hidePeek);
    box.appendChild(tile);
  }
}
function jumpTo(id) {
  const n = state.nodes[id], e = nodeEl(id); if (!n || !e) return;
  select([id]);
  animateToRect({ x: n.x, y: n.y, w: e.offsetWidth, h: e.offsetHeight }, 240, Math.min(1, Math.max(0.5, state.view.z)));
}

// ---------- Link in ----------
const views = new Map(); // nodeId → the parts of a mounted link node that are redrawn

export function buildLinkIn(node, body) {
  const d = node.data;
  if (!(d.name || '').trim()) { d.name = freeName('', node.id); d.tone = (allLinks().length - 1 + TONES.length) % TONES.length; save(); }
  recent = node.id;
  const ports = el('div', 'ports');
  const row = el('div', 'port-row in'); row.dataset.portRow = 'in';
  const port = el('span', 'port multi'); port.dataset.port = 'in'; port.dataset.dir = 'in'; port.dataset.type = 'link'; port.title = 'Connect images, video, audio or text';
  row.append(port, el('span', 'port-label', 'Connect what this link should carry'));
  ports.appendChild(row);

  const nameRow = el('div', 'link-name-row');
  const dot = el('span', 'link-dot'); dot.style.background = toneOf(node); dot.title = 'Click to change the colour';
  dot.addEventListener('click', (e) => { e.stopPropagation(); d.tone = ((d.tone || 0) + 1) % TONES.length; save(); dot.style.background = toneOf(node); drawOuts(); });
  const name = el('input', 'text-input link-name'); name.type = 'text'; name.spellcheck = false; name.maxLength = 60; name.placeholder = 'Name this link'; name.value = d.name;
  name.addEventListener('input', () => { d.name = name.value; recent = node.id; save(); drawOuts(); });
  name.addEventListener('change', () => { d.name = freeName(name.value.replace(/\s+/g, ' ').trim(), node.id); name.value = d.name; save(); drawOuts(); });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); name.blur(); } });
  nameRow.append(dot, name);

  const items = el('div', 'link-items');
  const foot = el('div', 'link-foot');
  const used = el('button', 'link-used'); used.type = 'button';
  let turn = 0;
  used.addEventListener('click', (e) => { e.stopPropagation(); const outs = linkOuts(node.id); if (outs.length) jumpTo(outs[turn++ % outs.length].id); });
  const add = el('button', 'btn small', 'Add Link out'); add.type = 'button'; add.title = 'A Link out for this link. Move it to where you need these, or press ⇧K anywhere on the board.';
  add.addEventListener('click', (e) => {
    e.stopPropagation();
    const me = nodeEl(node.id); const out = addNode('linkout', node.x + (me ? me.offsetWidth : 260) + 60, node.y, { link: node.id });
    select([out.id]); toast(`Link out for "${linkName(node)}". Drag it to where you need it.`, 'ok');
  });
  foot.append(used, add);
  body.append(ports, nameRow, items, foot);
  views.set(node.id, { items, used, name, dot });
  drawIn(node);
}
function drawIn(node) {
  const v = views.get(node.id); if (!v || !v.items.isConnected) return;
  const kinds = kindsOf(node);
  tiles(v.items, itemsOf(node), 'Nothing connected yet. Drag a strand from an image, a video, an audio clip or a prompt onto this node.');
  const outs = linkOuts(node.id).length;
  v.used.textContent = `${summary(kinds) || 'Empty'} · ${outs ? `used in ${outs} place${outs === 1 ? '' : 's'}` : 'not used yet'}`;
  v.used.disabled = !outs; v.used.title = outs ? 'Click to go to a Link out that uses this' : '';
  if (document.activeElement !== v.name) v.name.value = node.data.name || '';
  v.dot.style.background = toneOf(node);
}

// ---------- Link out ----------
export function buildLinkOut(node, body) {
  const d = node.data;
  // A new one starts on the link you were last working with.
  if (!d.link) { const p = preferred(); if (p && !linkWouldLoop(node.id, p.id)) { d.link = p.id; save(); } }
  const pick = el('div', 'link-name-row');
  const dot = el('span', 'link-dot');
  const sel = el('select');
  sel.addEventListener('change', () => {
    if (sel.value && linkWouldLoop(node.id, sel.value)) { toast('That would make the link feed itself, so it was left as it was.', 'err'); drawOut(node); return; }
    d.link = sel.value; if (sel.value) recent = sel.value; save();
    drawOut(node); drawIns(); nudgeConsumers(node.id);
  });
  const wrap = el('div', 'select-wrap'); wrap.appendChild(sel);
  const go = el('button', 'link-go'); go.type = 'button'; go.innerHTML = ICON.jump; go.title = 'Go to this link\'s Link in';
  go.addEventListener('click', (e) => { e.stopPropagation(); if (state.nodes[d.link]) jumpTo(d.link); });
  pick.append(dot, wrap, go);
  const items = el('div', 'link-items');
  const ports = el('div', 'ports link-outs');
  body.append(pick, items, ports);
  views.set(node.id, { sel, dot, go, items, ports, shown: null });
  drawOut(node);
}
function drawOut(node) {
  const v = views.get(node.id); if (!v || !v.items.isConnected) return;
  const d = node.data; const link = state.nodes[d.link]?.type === 'linkin' ? state.nodes[d.link] : null;
  const links = allLinks().sort((a, b) => linkName(a).localeCompare(linkName(b)));
  v.sel.innerHTML = '';
  const first = el('option', '', link ? '' : d.link ? 'That link was removed' : links.length ? 'Choose a link…' : 'No links on this board yet'); first.value = ''; if (!link) v.sel.appendChild(first);
  for (const l of links) { const o = el('option', '', linkName(l)); o.value = l.id; v.sel.appendChild(o); }
  v.sel.value = link ? link.id : '';
  v.dot.style.background = link ? toneOf(link) : 'transparent'; v.dot.classList.toggle('none', !link);
  v.go.disabled = !link;
  tiles(v.items, itemsOf(link), link ? 'This link is empty. Connect something to its Link in.' : links.length ? 'Choose which link this stands for.' : 'Add a Link in (K) and connect your references to it first.');
  // One output per kind of thing in the link.
  const kinds = kindsOf(link); const defs = getPorts(node).outputs; const key = defs.map((p) => `${p.key}${kinds.filter((k) => k === p.key).length}`).join();
  if (key !== v.shown) {
    v.shown = key; v.ports.innerHTML = '';
    for (const p of defs) {
      const n = kinds.filter((k) => k === p.key).length;
      const row = el('div', 'port-row out'); row.dataset.portRow = p.key;
      const port = el('span', 'port multi'); port.dataset.port = p.key; port.dataset.dir = 'out'; port.dataset.type = p.type; port.title = LINK_LABELS[p.key];
      row.append(el('span', 'port-label', n ? `${LINK_LABELS[p.key]}${p.key === 'text' || n === 1 ? '' : ` · ${n}`}` : `${LINK_LABELS[p.key]} · none now`), port);
      row.classList.toggle('stale', !n);
      v.ports.appendChild(row);
    }
    renderEdges();
  }
}
const drawIns = () => { for (const n of allLinks()) drawIn(n); };
const drawOuts = () => { for (const n of Object.values(state.nodes)) if (n.type === 'linkout') drawOut(n); };

// ---------- keeping everything in step ----------
// The nodes fed by a Link out look again: their previews, reference strips, prompt slots and costs.
function nudgeConsumers(linkOutId) { for (const e of outgoingRaw(linkOutId)) bus.emit('edge:refresh', e); }
const dirty = new Set(); let frame = 0;
// What `linkInId` holds has changed (a strand, a new result, edited text). Redraw it, its Link outs, and what they feed.
function touch(linkInId, seen = new Set()) {
  if (!linkInId || seen.has(linkInId)) return; seen.add(linkInId);
  dirty.add(linkInId);
  for (const lo of linkOuts(linkInId)) for (const e of outgoingRaw(lo.id)) if (state.nodes[e.to]?.type === 'linkin') touch(e.to, seen); // a link fed by a link
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0; const ids = [...dirty]; dirty.clear();
    for (const id of ids) {
      const link = state.nodes[id]; if (link) drawIn(link);
      for (const lo of linkOuts(id)) { drawOut(lo); nudgeConsumers(lo.id); }
    }
    renderEdges();
  });
}
// A source changed: every link it is plugged into.
const sourceChanged = (id) => { for (const e of outgoingRaw(id)) if (state.nodes[e.to]?.type === 'linkin') touch(e.to); };
for (const evt of ['results', 'prompt:change', 'llm:output', 'status']) bus.on(evt, sourceChanged);
bus.on('node:renamed', ({ id }) => sourceChanged(id));
bus.on('edges:reorder', ({ id }) => { if (state.nodes[id]?.type === 'linkin') touch(id); });
const edgeChanged = (e) => {
  if (state.nodes[e.to]?.type === 'linkin') touch(e.to);
  const from = state.nodes[e.from]; if (from && from.type === 'linkout') requestAnimationFrame(() => { if (state.nodes[from.id]) drawOut(from); });
};
bus.on('edge:add', edgeChanged);
bus.on('edge:remove', edgeChanged);
bus.on('node:add', (n) => {
  if (n.type === 'linkin') {
    // A copy of a link is a new link: it takes a name of its own.
    if ((n.data.name || '').trim()) { const name = freeName(linkName(n), n.id); if (name !== n.data.name) { n.data.name = name; save(); } }
    requestAnimationFrame(() => { drawIn(n); drawOuts(); });
  } else if (n.type === 'linkout') requestAnimationFrame(drawIns);
});
bus.on('node:remove', (n) => {
  views.delete(n.id);
  if (n.type === 'linkin') requestAnimationFrame(() => { for (const lo of Object.values(state.nodes)) if (lo.type === 'linkout') { drawOut(lo); if (lo.data.link === n.id) nudgeConsumers(lo.id); } renderEdges(); });
  else if (n.type === 'linkout') requestAnimationFrame(drawIns);
});
bus.on('selection', () => { if (state.sel.size === 1) { const n = state.nodes[[...state.sel][0]]; if (n && n.type === 'linkin') recent = n.id; } });

// A Link out for the link you were last working with (or the one that is selected), for the K shortcut and the menus.
export function linkOutData() { const p = preferred(); return p ? { link: p.id } : {}; }
