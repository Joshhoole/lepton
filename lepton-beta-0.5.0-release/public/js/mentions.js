// Mentions: "@image 2" in a prompt points at one of the images connected to the node that will use that prompt.
// Tags follow connection order. Typing "@" in a prompt lists what is connected; the text stays plain and portable.
import { state, bus, incoming, outgoing, isGen, isLLM, save, NODE_TYPES } from './state.js';
import { nodeEl, renderEdges } from './canvas.js';

const mentionRe = () => /(?<![\w@.])@(image|video|audio)[  ]?(\d{1,3}|\?)(?!\w)|(?<![\w@.])@(start|end)[  ]?frame\b/gi;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const titleOf = (n) => n.data.title || NODE_TYPES[n.type].title;

// ---------- what a node has connected, in the order it is sent ----------
const kindOfSource = (src) => (src.type === 'media' ? (src.data.kind || 'image') : src.type);
function sourceInfo(src) {
  if (src.type === 'media') {
    const d = src.data; const custom = d.title && d.title !== NODE_TYPES.media.title ? d.title : '';
    return { thumb: d.kind === 'audio' ? null : d.url, name: d.name || custom || 'Media' };
  }
  const res = src.data.results || [];
  const sel = res[src.data.selected]?.status === 'completed' ? res[src.data.selected] : res.find((r) => r.status === 'completed' && r.url);
  return { thumb: sel ? (sel.thumb || sel.url) : null, name: titleOf(src), waiting: !sel };
}
export function targetsOf(node) {
  const out = []; const count = {};
  const push = (e, kind, role, fixed) => {
    const src = state.nodes[e.from]; if (!src) return;
    const n = fixed ? null : (count[kind] = (count[kind] || 0) + 1);
    out.push({ key: `${e.from}:${e.fromPort}:${e.toPort}`, edge: e.id, src: src.id, port: e.toPort, kind, n, tag: fixed || `${kind} ${n}`, role, ...sourceInfo(src) });
  };
  if (!node) return out;
  if (node.type === 'image') for (const e of incoming(node.id, 'refs')) push(e, 'image', 'Reference');
  else if (node.type === 'video') {
    for (const e of incoming(node.id, 'start')) push(e, 'image', 'Start frame', 'start frame');
    for (const e of incoming(node.id, 'end')) push(e, 'image', 'End frame', 'end frame');
    for (const e of incoming(node.id, 'refs')) push(e, 'image', 'Reference');
    for (const e of incoming(node.id, 'vrefs')) push(e, 'video', 'Video reference');
  } else if (node.type === 'llm') {
    for (const e of incoming(node.id, 'media')) { const src = state.nodes[e.from]; if (src) push(e, kindOfSource(src), cap(kindOfSource(src))); }
  } else if (node.type === 'template' && node.data.spec) {
    for (const sec of node.data.spec.sections) if (sec.type === 'images') for (const e of incoming(node.id, `i_${sec.key}`)) push(e, 'image', sec.label);
  }
  return out;
}

// Nodes that will use this node's text (looking through Prompt batch nodes).
function consumersOf(node) {
  const seen = new Set(); const out = [];
  const walk = (id) => {
    for (const e of outgoing(id)) {
      const t = state.nodes[e.to]; if (!t || seen.has(t.id)) continue;
      if (e.toPort !== 'prompt' && !String(e.toPort).startsWith('s_')) continue;
      seen.add(t.id);
      if (t.type === 'batch') walk(t.id); else if (isGen(t) || isLLM(t)) out.push(t);
    }
  };
  walk(node.id);
  return out;
}
// The node whose connections a text field's mentions refer to.
export function contextFor(node, mode) {
  if (!node) return null;
  if (mode === 'self') return node;
  const c = consumersOf(node);
  return c.find((n) => targetsOf(n).length) || c[0] || null;
}

export function parseMentions(text) {
  const out = []; const re = mentionRe(); let m;
  while ((m = re.exec(String(text || '')))) {
    out.push(m[3] ? { index: m.index, length: m[0].length, raw: m[0], tag: `${m[3].toLowerCase()} frame`, fixed: true }
      : { index: m.index, length: m[0].length, raw: m[0], kind: m[1].toLowerCase(), n: m[2] === '?' ? null : Number(m[2]), tag: `${m[1].toLowerCase()} ${m[2]}` });
  }
  return out;
}

// ---------- run time: check every mention, then phrase it the way the model expects ----------
const styleFor = (node) => (node.type === 'video' && String(node.data.model || '').startsWith('hf:') ? 'at' : node.type === 'image' || node.type === 'video' ? 'plain' : 'keep');
const labelOf = (t) => (t.n ? `${cap(t.kind)} ${t.n}` : cap(t.tag));
export function resolveMentions(node, text, { lenient = false } = {}) {
  const found = parseMentions(text);
  const targets = targetsOf(node);
  const labels = {}; for (const t of targets) labels[t.edge] = labelOf(t);
  if (!found.length || (lenient && !targets.length)) return { text, used: false, labels };
  const byTag = new Map(targets.map((t) => [t.tag, t]));
  for (const m of found) {
    if (byTag.has(m.tag)) continue;
    if (m.fixed) throw new Error(`The prompt mentions @${m.tag}, but nothing is connected to ${cap(m.tag)} on "${titleOf(node)}".`);
    if (m.n === null) throw new Error(`The prompt mentions an ${m.kind === 'image' ? 'image' : `${m.kind} clip`} that is no longer connected (@${m.kind} ?). Type @ to pick it again, or remove the mention.`);
    const have = targets.filter((t) => t.kind === m.kind && t.n).length;
    const noun = m.kind === 'image' ? 'image' : `${m.kind} clip`;
    throw new Error(`The prompt mentions @${m.tag}, but ${have ? `only ${have} ${noun}${have === 1 ? ' is' : 's are'}` : `no ${noun} is`} connected to "${titleOf(node)}".`);
  }
  const style = styleFor(node);
  const out = style === 'keep' ? text : String(text).replace(mentionRe(), (raw, kind, n, se) => {
    if (se) return `the ${se.toLowerCase()} frame`;
    return style === 'at' ? `@${cap(kind.toLowerCase())} ${n}` : `${kind.toLowerCase()} ${n}`;
  });
  return { text: out, used: true, labels };
}

// ---------- text fields ----------
const fields = new Set();
const liveFields = () => { for (const f of fields) if (!f.ta.isConnected) fields.delete(f); return [...fields]; };
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const METRICS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'];
function copyMetrics(ta, layer) {
  const cs = getComputedStyle(ta);
  for (const p of METRICS) layer.style[p] = cs[p];
  const bw = parseFloat(cs.borderLeftWidth) || 0;
  layer.style.borderWidth = `${bw}px`;
  layer.style.right = `${Math.max(0, ta.offsetWidth - ta.clientWidth - bw * 2)}px`; // leave room for a scrollbar
}
// Mark mentions as connected (ok), not connected (bad) or not yet attached to anything (idle).
function markup(text, node, mode) {
  const found = parseMentions(text); if (!found.length) return null;
  const ctx = contextFor(node, mode);
  const tags = new Map(targetsOf(ctx).map((t) => [t.tag, t]));
  let html = '', at = 0;
  for (const m of found) {
    const t = tags.get(m.tag);
    html += esc(text.slice(at, m.index)) + `<span class="mention ${t ? 'ok' : ctx ? 'bad' : 'idle'}"${t ? ` data-src="${t.src}"` : ''}>${esc(m.raw)}</span>`;
    at = m.index + m.length;
  }
  return html + esc(text.slice(at));
}
function renderField(f) {
  const text = f.ta.value;
  const html = text.includes('@') ? markup(text, state.nodes[f.nodeId], f.mode) : null;
  if (!html) { if (f.layer.firstChild) f.layer.textContent = ''; return; }
  copyMetrics(f.ta, f.layer);
  f.layer.innerHTML = html + '​';
  f.layer.scrollTop = f.ta.scrollTop;
}
// Wrap a textarea so mentions are highlighted and "@" opens the picker. Returns the element to insert.
export function mentionField(ta, node, mode, field) {
  const wrap = document.createElement('div'); wrap.className = 'mention-wrap';
  const layer = document.createElement('div'); layer.className = 'mention-layer'; layer.setAttribute('aria-hidden', 'true');
  wrap.append(ta, layer);
  const f = { ta, layer, wrap, nodeId: node.id, mode, field, caret: null, focused: 0, skip: false };
  fields.add(f);
  ta.addEventListener('input', () => { renderField(f); f.caret = ta.selectionStart; if (f.skip) { f.skip = false; return; } detect(f); });
  ta.addEventListener('scroll', () => { layer.scrollTop = ta.scrollTop; if (menu.field === f) closeMenu(); });
  ta.addEventListener('keydown', (e) => onKey(f, e));
  ta.addEventListener('keyup', (e) => { f.caret = ta.selectionStart; if (menu.field === f && /^(Arrow(Left|Right)|Home|End)$/.test(e.key)) detect(f); });
  ta.addEventListener('click', () => { f.caret = ta.selectionStart; if (menu.field === f) detect(f); });
  ta.addEventListener('focus', () => { f.focused = Date.now(); });
  ta.addEventListener('blur', () => { f.caret = ta.selectionStart; setTimeout(() => { if (menu.field === f && document.activeElement !== ta) closeMenu(); }, 120); });
  requestAnimationFrame(() => renderField(f));
  return wrap;
}
// Read-only text (a linked prompt shown inside another node) with its mentions marked.
export function highlightInto(el, text, node) {
  const html = String(text).includes('@') ? markup(String(text), node, 'self') : null;
  if (html) el.innerHTML = html; else el.textContent = text;
}
function refreshFields(nodeId) { for (const f of liveFields()) if (!nodeId || f.nodeId === nodeId) renderField(f); }

// ---------- the "@" picker ----------
const menu = { el: null, field: null, items: [], index: 0, trig: null };
function trigger(ta) {
  const pos = ta.selectionStart; if (pos !== ta.selectionEnd) return null;
  const before = ta.value.slice(Math.max(0, pos - 16), pos);
  const at = before.lastIndexOf('@'); if (at < 0) return null;
  const q = before.slice(at + 1);
  if (!/^[a-z0-9 ]*$/i.test(q) || /^ | {2}/.test(q)) return null;
  const start = pos - before.length + at;
  if (start > 0 && /[\w@.]/.test(ta.value[start - 1])) return null; // part of a word or an address, not a mention
  return { start, end: pos, q };
}
const squash = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
function detect(f) {
  const trig = trigger(f.ta);
  if (!trig) return closeMenu();
  const ctx = contextFor(state.nodes[f.nodeId], f.mode);
  const targets = targetsOf(ctx);
  const q = squash(trig.q);
  const items = !q ? targets : targets.filter((t) => squash(t.tag).startsWith(q) || (t.n && String(t.n) === q) || squash(t.name).includes(q));
  if (q && !items.length) return closeMenu();
  if (/\s$/.test(trig.q) && items.some((t) => squash(t.tag) === q)) return closeMenu(); // already written out in full
  openMenu(f, trig, items, ctx);
}
function caretRect(f, index) {
  const probe = document.createElement('div'); probe.className = 'mention-layer'; probe.style.visibility = 'hidden';
  copyMetrics(f.ta, probe);
  const mark = document.createElement('span'); mark.textContent = '@';
  probe.append(document.createTextNode(f.ta.value.slice(0, index)), mark, document.createTextNode(f.ta.value.slice(index + 1) + '​'));
  f.wrap.appendChild(probe); probe.scrollTop = f.ta.scrollTop;
  const r = mark.getBoundingClientRect(); probe.remove();
  return r;
}
const KIND_ICON = {
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 15.5 15.5 11l-7 8"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="6" width="12.5" height="12" rx="3"/><path d="M16 10.5 20.5 8v8L16 13.5"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
};
function thumbEl(t) {
  const box = document.createElement('span'); box.className = `mention-thumb ${t.kind}`;
  if (t.thumb && t.kind === 'video') { const v = document.createElement('video'); v.src = t.thumb; v.muted = true; v.preload = 'metadata'; box.appendChild(v); }
  else if (t.thumb && t.kind === 'image') { const i = document.createElement('img'); i.src = t.thumb; i.draggable = false; box.appendChild(i); }
  else box.innerHTML = KIND_ICON[t.kind] || KIND_ICON.image;
  return box;
}
function openMenu(f, trig, items, ctx) {
  if (!menu.el) {
    menu.el = document.createElement('div'); menu.el.className = 'mention-menu';
    menu.el.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the caret in the text field
    document.body.appendChild(menu.el);
  }
  const keep = menu.field === f && menu.items[menu.index] ? menu.items[menu.index].key : null;
  Object.assign(menu, { field: f, trig, items, index: Math.max(0, items.findIndex((t) => t.key === keep)) });
  const el = menu.el; el.innerHTML = ''; el.hidden = false;
  const head = document.createElement('div'); head.className = 'mention-head';
  head.textContent = ctx ? `Connected to ${titleOf(ctx)}` : 'Mentions';
  el.appendChild(head);
  if (!items.length) {
    const note = document.createElement('div'); note.className = 'mention-empty';
    note.textContent = !ctx ? 'Connect this prompt to an Image, Video or LLM node. The images connected to that node can then be mentioned here.'
      : ctx.type === 'llm' ? 'Nothing is connected yet. Connect an image, video or audio clip to this node to mention it.'
        : 'No image is connected yet. Connect one to this node to mention it.';
    el.appendChild(note);
  } else {
    items.forEach((t, i) => {
      const row = document.createElement('button'); row.className = `mention-row ${i === menu.index ? 'on' : ''}`; row.type = 'button';
      const text = document.createElement('span'); text.className = 'mention-text';
      const tag = document.createElement('span'); tag.className = 'mention-tag'; tag.textContent = `@${t.tag}`;
      const sub = document.createElement('span'); sub.className = 'mention-sub'; sub.textContent = [t.n ? t.role : '', t.name, t.waiting ? 'not generated yet' : ''].filter(Boolean).join(' · ');
      text.append(tag, sub);
      row.append(thumbEl(t), text);
      row.addEventListener('pointerenter', () => { setIndex(i); });
      row.addEventListener('click', () => choose(i));
      el.appendChild(row);
    });
    const foot = document.createElement('div'); foot.className = 'mention-foot'; foot.textContent = '↑↓ choose · ↵ insert · esc close';
    el.appendChild(foot);
    spotlight(items[menu.index].src);
  }
  const r = caretRect(f, trig.start);
  const w = el.offsetWidth, hgt = el.offsetHeight;
  let top = r.bottom + 6; if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 6);
  el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  el.style.top = `${top}px`;
}
function setIndex(i) {
  if (!menu.items.length) return;
  menu.index = (i + menu.items.length) % menu.items.length;
  menu.el.querySelectorAll('.mention-row').forEach((r, j) => { r.classList.toggle('on', j === menu.index); if (j === menu.index) r.scrollIntoView({ block: 'nearest' }); });
  spotlight(menu.items[menu.index].src);
}
function closeMenu() {
  if (!menu.field) return;
  menu.field = null; menu.items = []; menu.trig = null;
  if (menu.el) menu.el.hidden = true;
  spotlight(null);
}
function insertAt(f, start, end, tag) {
  const ta = f.ta; const next = ta.value[end] || ''; const prev = start > 0 ? ta.value[start - 1] : '';
  const text = `${prev && !/\s|[(\[“"']/.test(prev) ? ' ' : ''}@${tag}${next && /[\s.,;:!?)\]]/.test(next) ? '' : ' '}`;
  ta.focus(); ta.setRangeText(text, start, end, 'end');
  f.skip = true; ta.dispatchEvent(new Event('input', { bubbles: true }));
}
function choose(i) {
  const t = menu.items[i], f = menu.field, trig = menu.trig; if (!t || !f) return;
  closeMenu();
  insertAt(f, trig.start, trig.end, t.tag);
}
function onKey(f, e) {
  if (menu.field !== f) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
  if (!menu.items.length || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setIndex(menu.index + (e.key === 'ArrowDown' ? 1 : -1)); }
  else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); choose(menu.index); }
}
bus.on('view', closeMenu);
window.addEventListener('resize', closeMenu);

// Point out the node a tag refers to.
let lit = null;
function spotlight(id) {
  if (lit === id) return;
  if (lit) nodeEl(lit)?.classList.remove('mention-hl');
  lit = id || null;
  if (lit) nodeEl(lit)?.classList.add('mention-hl');
}

// ---------- the numbered strip inside a node ----------
const badgeOf = (t) => (t.n ? (t.kind === 'image' ? String(t.n) : `${t.kind[0].toUpperCase()}${t.n}`) : t.tag === 'start frame' ? 'Start' : 'End');
// The text field a tag should be typed into when its chip is clicked.
function fieldFor(node) {
  const live = liveFields();
  const own = live.filter((f) => f.nodeId === node.id && f.mode === 'self');
  const upstream = live.filter((f) => f.mode === 'downstream' && contextFor(state.nodes[f.nodeId], 'downstream') === node);
  const pool = own.length ? own : upstream;
  if (!pool.length) return null;
  const recent = [...pool].sort((a, b) => b.focused - a.focused)[0];
  if (recent.focused) return recent;
  return pool.find((f) => ['prompt', 'instructions', 'text'].includes(f.field)) || (pool.length === 1 ? pool[0] : null);
}
export function renderRefStrip(node, root) {
  const el = root || nodeEl(node.id); if (!el) return;
  const all = targetsOf(node);
  el.querySelectorAll('.ref-strip').forEach((strip) => {
    const items = strip.dataset.port ? all.filter((t) => t.port === strip.dataset.port) : all;
    strip.innerHTML = '';
    strip.hidden = !items.length && !strip.dataset.empty;
    if (!items.length) { if (strip.dataset.empty) { const c = document.createElement('div'); c.className = 'tpl-chip'; c.textContent = strip.dataset.empty; strip.appendChild(c); } return; }
    for (const t of items) {
      const chip = document.createElement('div'); chip.className = 'ref-chip';
      chip.title = `@${t.tag} · ${t.name}${t.waiting ? ' (not generated yet)' : ''}\nClick to mention it in the prompt`;
      const badge = document.createElement('span'); badge.className = 'ref-badge'; badge.textContent = badgeOf(t);
      chip.append(thumbEl(t), badge);
      chip.addEventListener('pointerenter', () => spotlight(t.src));
      chip.addEventListener('pointerleave', () => spotlight(null));
      chip.addEventListener('click', () => {
        const f = fieldFor(node);
        if (!f) { bus.emit('toast', { msg: `Type @${t.tag} in the prompt to refer to this ${t.kind}.` }); return; }
        const at = f.caret === null ? f.ta.value.length : Math.min(f.caret, f.ta.value.length);
        insertAt(f, at, at, t.tag);
      });
      strip.appendChild(chip);
    }
  });
}

// ---------- keeping tags pointing at the same image when connections change ----------
const snapshots = new Map(); // nodeId → [{ key, tag }]
const snap = (node) => targetsOf(node).map((t) => ({ key: t.key, tag: t.tag, fixed: !t.n }));
export function snapshotAll() {
  snapshots.clear();
  for (const n of Object.values(state.nodes)) if (isGen(n) || isLLM(n)) snapshots.set(n.id, snap(n));
}
function retag(text, map) {
  if (!text || !text.includes('@')) return text;
  return text.replace(mentionRe(), (raw, kind, n, se) => {
    if (se) return raw;
    const from = `${kind.toLowerCase()} ${n}`;
    if (!(from in map)) return raw;
    return map[from] ? `@${kind} ${map[from].split(' ')[1]}` : `@${kind} ?`;
  });
}
function setText(node, field, value) {
  if (field.startsWith('values.')) (node.data.values ||= {})[field.slice(7)] = value; else node.data[field] = value;
  for (const f of liveFields()) if (f.nodeId === node.id && f.field === field) { f.ta.value = value; renderField(f); }
}
function reconcile(id) {
  const node = state.nodes[id];
  const before = snapshots.get(id) || [];
  if (!node) { snapshots.delete(id); return; }
  const now = snap(node); snapshots.set(id, now);
  const map = {}; let moved = false;
  for (const o of before) {
    if (o.fixed) continue;
    const n = now.find((x) => x.key === o.key);
    map[o.tag] = n ? n.tag : null;
    if (!n || n.tag !== o.tag) moved = true;
  }
  if (!moved) return;
  let changed = 0;
  const apply = (n, field, text) => { const next = retag(text, map); if (next !== text) { setText(n, field, next); changed++; return true; } return false; };
  if (isGen(node)) apply(node, 'prompt', node.data.prompt);
  else if (node.type === 'llm') { apply(node, 'instructions', node.data.instructions); apply(node, 'system', node.data.system); }
  else if (node.type === 'template') for (const [k, v] of Object.entries(node.data.values || {})) apply(node, `values.${k}`, v);
  // Text nodes feeding this node, when this is the node their mentions refer to.
  const seen = new Set();
  const up = (nid) => {
    for (const e of incoming(nid)) {
      if (e.toPort !== 'prompt' && !String(e.toPort).startsWith('s_')) continue;
      const src = state.nodes[e.from]; if (!src || seen.has(src.id)) continue; seen.add(src.id);
      if (src.type === 'batch') { up(src.id); continue; }
      if (contextFor(src, 'downstream') !== node) continue;
      const field = src.type === 'prompt' ? 'text' : isLLM(src) ? 'output' : null;
      if (field && apply(src, field, src.data[field])) bus.emit('prompt:change', src.id);
    }
  };
  up(id);
  if (changed) {
    save();
    const lost = Object.values(map).some((v) => v === null);
    bus.emit('toast', { msg: lost ? 'A mentioned image was disconnected. Its tag now reads "@image ?" in your prompt; the other tags still point at the same images.' : 'Image order changed, so the @ tags in your prompt were updated to keep pointing at the same images.' });
  }
}
const pending = new Set(); let timer = null;
function schedule(id) {
  pending.add(id);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null; const ids = [...pending]; pending.clear();
    for (const nid of ids) reconcile(nid);
    for (const nid of ids) { const n = state.nodes[nid]; if (n) renderRefStrip(n); }
    refreshFields(); renderEdges();
    // Linked prompt previews show mention state too.
    for (const nid of ids) if (state.nodes[nid]) bus.emit('mentions:change', nid);
  }, 0);
}
const isTextPort = (p) => p === 'prompt' || String(p).startsWith('s_');
bus.on('edge:add', (e) => { if (isTextPort(e.toPort)) { setTimeout(() => refreshFields(e.from), 0); return; } if (e.toPort !== 'in') schedule(e.to); });
bus.on('edge:remove', (e) => { if (isTextPort(e.toPort)) { setTimeout(() => refreshFields(e.from), 0); return; } if (e.toPort !== 'in') schedule(e.to); });
bus.on('node:add', (n) => { if (isGen(n) || isLLM(n)) snapshots.set(n.id, snap(n)); });
bus.on('node:remove', (n) => { snapshots.delete(n.id); if (lit === n.id) lit = null; });
// A source's picture changed (new result, another result selected): refresh the strips that show it.
bus.on('results', (id) => { for (const e of outgoing(id)) { const n = state.nodes[e.to]; if (n && e.toPort !== 'in' && !isTextPort(e.toPort)) renderRefStrip(n); } });
bus.on('llm:output', (id) => setTimeout(() => refreshFields(id), 0));
