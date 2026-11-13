// Notes and titles: things you put on the board to stay organised. They are ordinary nodes as far as moving,
// selecting, grouping, copying and saving go, but they have no ports and nothing is ever sent to a model from them.
//   Title  large text, a fixed size on the board like everything else
//   Note   a coloured sticky note; lines that start with [ ] become checkboxes
import { state, bus, save, addNode, removeNodes, select } from './state.js';
import { nodeEl, renderEdges } from './canvas.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const toast = (msg, kind) => bus.emit('toast', { msg, kind });

export const NOTE_COLORS = [
  { id: 'sand', fill: '#3a3320', line: '#5e5230', text: '#f2e5bb' },
  { id: 'rust', fill: '#3b2620', line: '#643e33', text: '#f3d0c3' },
  { id: 'moss', fill: '#22331f', line: '#3b5736', text: '#d2e8cb' },
  { id: 'teal', fill: '#1c3233', line: '#325859', text: '#c5e6e6' },
  { id: 'navy', fill: '#1f2740', line: '#384672', text: '#ccd6f5' },
  { id: 'plum', fill: '#30233a', line: '#56416c', text: '#e3d0f0' },
  { id: 'graphite', fill: '#232326', line: '#3f3f44', text: '#e4e4e7' },
];
export const TITLE_COLORS = [
  { id: 'white', text: '#ececee' }, { id: 'grey', text: '#8a8d94' }, { id: 'sand', text: '#f2e5bb' }, { id: 'rust', text: '#f3b9a6' },
  { id: 'moss', text: '#b9e0ae' }, { id: 'teal', text: '#a9dede' }, { id: 'navy', text: '#b3c2f5' }, { id: 'plum', text: '#d9bbee' },
];
export const TITLE_SIZES = [['s', 'S', 28], ['m', 'M', 48], ['l', 'L', 80], ['xl', 'XL', 128]];
const noteColor = (id) => NOTE_COLORS.find((c) => c.id === id) || NOTE_COLORS[0];
const titleColor = (id) => TITLE_COLORS.find((c) => c.id === id) || TITLE_COLORS[0];
const titleSize = (id) => (TITLE_SIZES.find((s) => s[0] === id) || TITLE_SIZES[2])[2];

// The little bar above a selected note or title. It keeps its size on screen however far the board is zoomed.
function tools(...parts) { const bar = el('div', 'anno-tools'); bar.append(...parts.filter(Boolean)); return bar; }
function swatches(colors, current, onPick) {
  const wrap = el('div', 'anno-swatches');
  for (const c of colors) {
    const b = el('button', `anno-swatch ${c.id === current ? 'on' : ''}`); b.type = 'button'; b.title = c.id[0].toUpperCase() + c.id.slice(1);
    b.style.background = c.text; /* the bright tone: the fills are too dark to tell apart at this size */ b.addEventListener('click', (e) => { e.stopPropagation(); onPick(c.id); });
    wrap.appendChild(b);
  }
  return wrap;
}
function toolBtn(label, title, onClick) { const b = el('button', 'anno-btn', label); b.type = 'button'; b.title = title; b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); }); return b; }

// ---------- links ----------
// A web address written or pasted into a title or a note is a link while the text is not being edited: click it and
// the page opens in a new tab. Nothing about it is stored. The text is kept exactly as written, and the links are
// found again each time it is drawn, so text from a board file someone else made can only ever link to http(s) pages.
const LINK = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
function linkParts(str) {
  const parts = []; let at = 0; LINK.lastIndex = 0;
  for (let m; (m = LINK.exec(str));) {
    if (m.index > 0 && /[\w@]/.test(str[m.index - 1])) continue; // the middle of a word or an e-mail address
    let url = m[0];
    // A full stop, comma or bracket that ends the sentence is not part of the address.
    for (;;) {
      const last = url[url.length - 1], open = { ')': '(', ']': '[', '}': '{' }[last];
      if (/[.,;:!?…]/.test(last) || (open && url.split(open).length < url.split(last).length)) url = url.slice(0, -1); else break;
    }
    if (url.replace(/^(https?:\/\/|www\.)/i, '').length < 3) continue;
    if (m.index > at) parts.push({ text: str.slice(at, m.index) });
    parts.push({ text: url, href: /^www\./i.test(url) ? `https://${url}` : url });
    at = m.index + url.length; LINK.lastIndex = at;
  }
  if (at < str.length) parts.push({ text: str.slice(at) });
  return parts;
}
function linkEl(text, href) {
  const a = el('a', 'text-link', text);
  a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.draggable = false; a.title = `Open ${href}`;
  return a;
}
// A line of plain text as nodes, its addresses as links.
function linkedText(str) {
  const frag = document.createDocumentFragment();
  for (const p of linkParts(String(str))) frag.append(p.href ? linkEl(p.text, p.href) : document.createTextNode(p.text));
  return frag;
}
// Turn the addresses inside an element's text into links, and back into plain text before it is edited.
function linkify(root) {
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const found = [];
  for (let n; (n = tw.nextNode());) if (n.data.length > 6 && !n.parentElement.closest('a') && linkParts(n.data).some((p) => p.href)) found.push(n);
  for (const n of found) n.replaceWith(linkedText(n.data));
}
function unlink(root) {
  const links = root.querySelectorAll('a.text-link'); if (!links.length) return;
  links.forEach((a) => a.replaceWith(...a.childNodes)); root.normalize();
}
// The canvas says when a link was clicked (a press on a link can also be the start of dragging its node, so the
// canvas decides). The page opens a moment later, so a double-click, which edits the text, does not open it as well.
let opening = 0;
const cancelOpen = () => { clearTimeout(opening); opening = 0; };
const openLink = (href) => { if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer'); };
bus.on('link:click', (href) => { cancelOpen(); opening = setTimeout(() => { opening = 0; openLink(href); }, 260); });
// The browser's own click on a link is not used (it would open the page a second time). Return on a focused link opens it.
function guardLinks(root) {
  root.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a.text-link'); if (!a) return; e.preventDefault(); if (e.detail === 0) openLink(a.href); });
}

// ---------- title ----------
// A title is a small piece of rich text: bold, italic, underline, strike-through, a highlighter, bullet and numbered
// lists, and as many lines as you like. Double-click to write in it; Return starts a new line; Esc, ⌘⏎ or a click
// anywhere else finishes. The bar above a selected title formats the selected words, or the whole title when it is
// not being edited.
//
// The formatting is done by the browser's own editing commands, so undo, the usual shortcuts (⌘B ⌘I ⌘U) and lists
// behave as they do everywhere else. What is kept is `data.html`, and it only ever holds the handful of tags below:
// everything is passed through cleanRich() on the way in and on the way out, because a board can come from a file
// someone else made. `data.text` is the same writing as plain text.
const HL = 'rgba(242, 193, 75, 0.4)'; // the highlighter
const RICH_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'UL', 'OL', 'LI', 'BR', 'DIV', 'P', 'SPAN']);
const RICH_DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'TEMPLATE', 'SVG', 'MATH', 'TITLE', 'HEAD', 'NOSCRIPT']);
const isLit = (el) => { const v = el.style && el.style.backgroundColor; return !!v && v !== 'transparent' && !/rgba\(0, 0, 0, 0\)/.test(v); };
export function cleanRich(html) {
  const t = document.createElement('template'); t.innerHTML = String(html || ''); // inert: nothing in it runs or loads
  const walk = (parent) => {
    for (const c of [...parent.childNodes]) {
      if (c.nodeType === 3) continue;
      const tag = c.nodeType === 1 ? c.tagName.toUpperCase() : '';
      if (!tag || RICH_DROP.has(tag)) { c.remove(); continue; }
      walk(c);
      const lit = tag === 'MARK' || isLit(c); // the browser puts the highlight on whichever tag is already around the words
      if (tag === 'MARK') { const span = document.createElement('span'); span.append(...c.childNodes); span.setAttribute('style', `background-color: ${HL};`); c.replaceWith(span); continue; }
      if (!RICH_TAGS.has(tag) || (tag === 'SPAN' && !lit)) { c.replaceWith(...c.childNodes); continue; } // keep the words, drop the wrapper
      for (const a of [...c.attributes]) c.removeAttribute(a.name);
      if (lit) c.setAttribute('style', `background-color: ${HL};`);
    }
  };
  walk(t.content);
  return t.innerHTML;
}
const escapeText = (t) => String(t).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
const FMT_ICONS = {
  bullets: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6.5 4h7M6.5 8h7M6.5 12h7"/><circle cx="3" cy="4" r="0.9" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r="0.9" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="0.9" fill="currentColor" stroke="none"/></svg>',
  numbers: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M7 4h6.5M7 8h6.5M7 12h6.5"/><path d="M2.4 3l1-.6v3.4M2.2 10.2c.3-.6 1.7-.6 1.7.3 0 .7-1.2 1.2-1.8 2.2h2" stroke-width="1.1" stroke-linejoin="round"/></svg>',
  highlight: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9.6 2.6l3.8 3.8-6 6H4.6l-1-1V8.6z"/><path d="M2.5 14h11" stroke="#f2c14b" stroke-width="1.8"/></svg>',
};
let editing = null; // the title being written in, for keeping its bar in step with the selection
document.addEventListener('selectionchange', () => { if (editing) editing(); });

export function buildTitle(node, root) {
  root.innerHTML = '';
  const d = node.data;
  root.style.setProperty('--hs', `${titleSize(d.size)}px`);
  root.style.setProperty('--hc', titleColor(d.color).text);
  const text = el('div', 'title-text'); text.spellcheck = false; text.dataset.placeholder = 'Title';
  text.title = 'Double-click to edit';
  // A title made before formatting existed was bold all through; it still is.
  text.innerHTML = typeof d.html === 'string' ? cleanRich(d.html) : (d.text ? `<b>${escapeText(d.text)}</b>` : '');
  linkify(text); guardLinks(text);

  const run = (name, value) => { document.execCommand('styleWithCSS', false, false); document.execCommand(name, false, value); };
  const isOn = (name) => { try { return document.queryCommandState(name); } catch { return false; } };
  // Is everything selected (or the spot the cursor is in) highlighted?
  const litNow = () => {
    const s = document.getSelection(); if (!s.rangeCount) return false; const r = s.getRangeAt(0); if (!text.contains(r.startContainer)) return false;
    const inMark = (n) => { for (let e = n.nodeType === 1 ? n : n.parentElement; e && e !== text; e = e.parentElement) if (isLit(e)) return true; return false; };
    if (r.collapsed) return inMark(r.startContainer);
    const tw = document.createTreeWalker(text, NodeFilter.SHOW_TEXT); let any = false, n;
    while ((n = tw.nextNode())) {
      if (!n.data.length || !r.intersectsNode(n)) continue;
      const a = n === r.startContainer ? r.startOffset : 0, b = n === r.endContainer ? r.endOffset : n.data.length; if (b <= a) continue;
      if (!inMark(n)) return false; any = true;
    }
    return any;
  };
  const FORMATS = [
    { html: '<b>B</b>', title: 'Bold (⌘B)', run: () => run('bold'), on: () => isOn('bold') },
    { html: '<i>I</i>', title: 'Italic (⌘I)', run: () => run('italic'), on: () => isOn('italic') },
    { html: '<u>U</u>', title: 'Underline (⌘U)', run: () => run('underline'), on: () => isOn('underline') },
    { html: '<s>S</s>', title: 'Strike through (⇧⌘X)', run: () => run('strikeThrough'), on: () => isOn('strikeThrough') },
    { html: FMT_ICONS.highlight, title: 'Highlight (⇧⌘E)', run: () => run('hiliteColor', litNow() ? 'transparent' : HL), on: litNow, gap: true },
    { html: FMT_ICONS.bullets, title: 'Bullet points (⇧⌘8, or start a line with "- ")', run: () => run('insertUnorderedList'), on: () => isOn('insertUnorderedList'), gap: true },
    { html: FMT_ICONS.numbers, title: 'Numbered list (⇧⌘7, or start a line with "1. ")', run: () => run('insertOrderedList'), on: () => isOn('insertOrderedList') },
  ];
  const sync = () => { const ed = text.isContentEditable; for (const f of FORMATS) f.el.classList.toggle('on', ed && f.on()); };
  const keep = () => { d.html = cleanRich(text.innerHTML); d.text = text.innerText.replace(/\n{2,}/g, '\n').trim(); save(); };

  // `at` is where the double-click landed (the cursor goes there), or 'all' to select everything. Otherwise the end.
  const startEdit = (at) => {
    if (text.isContentEditable) return;
    cancelOpen(); unlink(text); // while it is written in, an address is just text
    text.setAttribute('contenteditable', 'true'); text.focus(); editing = sync;
    const s = document.getSelection();
    const spot = at && at !== 'all' && document.caretRangeFromPoint ? document.caretRangeFromPoint(at.x, at.y) : null;
    if (at === 'all') s.selectAllChildren(text);
    else if (spot && text.contains(spot.startContainer)) { s.removeAllRanges(); s.addRange(spot); }
    else { s.selectAllChildren(text); s.collapseToEnd(); }
    if (!text.textContent) run('bold'); // a new title starts out bold
    sync();
  };
  const stopEdit = () => {
    if (!text.hasAttribute('contenteditable')) return;
    const empty = !text.textContent.replace(/[\s​]/g, '');
    if (empty) { d.html = ''; d.text = ''; } else { d.html = cleanRich(text.innerHTML); d.text = text.innerText.replace(/\n{2,}/g, '\n').trim(); }
    text.removeAttribute('contenteditable'); if (editing === sync) editing = null;
    text.innerHTML = d.html; linkify(text); sync();
    save(); renderEdges(); bus.emit('groups:render');
  };
  // A format button works on the selected words while the title is being written in, and on all of it otherwise.
  const format = (f) => {
    if (text.isContentEditable) { f.run(); keep(); sync(); return; }
    if (!text.textContent) return;
    startEdit('all'); f.run(); text.blur();
  };

  text.addEventListener('dblclick', (e) => { if (text.isContentEditable) return; e.stopPropagation(); startEdit({ x: e.clientX, y: e.clientY }); });
  text.addEventListener('blur', stopEdit);
  text.addEventListener('keydown', (e) => {
    if (!text.isContentEditable) return;
    e.stopPropagation(); // the board's own shortcuts stay out of the way; ⌘Z here undoes typing
    const meta = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape' || (meta && e.key === 'Enter')) { e.preventDefault(); text.blur(); return; }
    if (e.key === 'Tab') { e.preventDefault(); if (isOn('insertUnorderedList') || isOn('insertOrderedList')) { run(e.shiftKey ? 'outdent' : 'indent'); keep(); } return; }
    if (!meta || !e.shiftKey) return;
    const f = e.code === 'KeyX' ? FORMATS[3] : e.code === 'KeyE' ? FORMATS[4] : e.code === 'Digit8' ? FORMATS[5] : e.code === 'Digit7' ? FORMATS[6] : null;
    if (f) { e.preventDefault(); format(f); }
  });
  text.addEventListener('paste', (e) => { // pasted writing comes in plain; the formatting is yours to add
    if (!text.isContentEditable) return;
    e.preventDefault(); e.stopPropagation();
    document.execCommand('insertText', false, (e.clipboardData?.getData('text/plain') || '').slice(0, 20000));
  });
  text.addEventListener('input', (e) => {
    // "- " or "* " at the start of a line begins a bullet list, and "1. " a numbered one.
    if (e.inputType === 'insertText' && e.data === ' ') {
      const s = document.getSelection(); const r = s.rangeCount ? s.getRangeAt(0) : null; const n = r && r.startContainer;
      const m = n && n.nodeType === 3 && r.collapsed ? /^(?:([-*])|1[.)])[  ]$/.exec(n.data.slice(0, r.startOffset)) : null;
      let first = !!m;
      for (let x = n; first && x && x !== text; x = x.parentNode) { // nothing before it on its line, and not already in a list
        if (x.nodeType === 1 && /^(DIV|P)$/.test(x.tagName)) break;
        if (x.nodeType === 1 && x.tagName === 'LI') first = false;
        else if (x.previousSibling && x.previousSibling.nodeName !== 'BR' && !/^(DIV|P|UL|OL)$/.test(x.previousSibling.nodeName)) first = false;
      }
      if (first) {
        const bold = isOn('bold');
        const mark = document.createRange(); mark.setStart(n, 0); mark.setEnd(n, r.startOffset); s.removeAllRanges(); s.addRange(mark);
        run('delete'); run(m[1] ? 'insertUnorderedList' : 'insertOrderedList');
        if (bold !== isOn('bold')) run('bold');
      }
    }
    keep(); sync();
  });

  const setLook = () => {
    root.style.setProperty('--hs', `${titleSize(d.size)}px`); root.style.setProperty('--hc', titleColor(d.color).text);
    sizes.querySelectorAll('.anno-btn').forEach((b, k) => b.classList.toggle('on', TITLE_SIZES[k][0] === (d.size || 'l')));
    colors.querySelectorAll('.anno-swatch').forEach((b, k) => b.classList.toggle('on', TITLE_COLORS[k].id === (d.color || 'white')));
    save(); renderEdges(); bus.emit('groups:render');
  };
  const sizes = el('div', 'anno-sizes');
  for (const [id, label] of TITLE_SIZES) sizes.appendChild(Object.assign(toolBtn(label, `Size ${label}`, () => { d.size = id; setLook(); }), { className: `anno-btn ${id === (d.size || 'l') ? 'on' : ''}` }));
  const colors = swatches(TITLE_COLORS, d.color || 'white', (c) => { d.color = c; setLook(); });
  const formats = el('div', 'anno-sizes anno-formats');
  for (const f of FORMATS) {
    f.el = toolBtn('', f.title, () => format(f)); f.el.innerHTML = f.html; f.el.classList.add('anno-fmt'); if (f.gap) f.el.classList.add('gap');
    formats.appendChild(f.el);
  }
  const bar = tools(sizes, colors, formats);
  bar.addEventListener('mousedown', (e) => e.preventDefault()); // a press on the bar must not take the cursor out of the text
  root.append(bar, text);
  root._edit = () => startEdit();
  applyInv(root);
}

// ---------- note ----------
const CHECK = /^(\s*)(?:[-*]\s*)?\[( |x|X)\]\s?(.*)$/;
const hasChecks = (text) => String(text || '').split('\n').some((l) => CHECK.test(l));
export function buildNote(node, root) {
  root.innerHTML = '';
  const d = node.data; const c = noteColor(d.color);
  root.style.setProperty('--nf', c.fill); root.style.setProperty('--nl', c.line); root.style.setProperty('--nt', c.text);
  const view = el('div', 'note-view'); view.title = 'Double-click to edit';
  const ta = el('textarea', 'note-edit'); ta.spellcheck = false; ta.placeholder = 'Write a note…  Start a line with [ ] for a checkbox.'; ta.hidden = true;

  const renderView = () => {
    view.innerHTML = '';
    const lines = String(d.text || '').split('\n');
    if (!String(d.text || '').trim()) { view.appendChild(el('div', 'note-empty', 'Double-click to write')); return; }
    lines.forEach((line, i) => {
      const m = CHECK.exec(line);
      if (!m) { const row = el('div', line.trim() ? 'note-line' : 'note-gap'); row.append(linkedText(line)); view.appendChild(row); return; }
      const row = el('div', `note-check ${m[2] !== ' ' ? 'done' : ''}`);
      const box = el('button', 'note-box'); box.type = 'button'; box.title = m[2] !== ' ' ? 'Mark as not done' : 'Mark as done';
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        const all = String(d.text || '').split('\n'); const mm = CHECK.exec(all[i]); if (!mm) return;
        all[i] = `${mm[1]}[${mm[2] === ' ' ? 'x' : ' '}] ${mm[3]}`; d.text = all.join('\n'); save(); renderView();
      });
      const words = el('span'); words.append(linkedText(m[3])); row.append(box, words); view.appendChild(row);
    });
  };
  const fit = () => { ta.style.height = 'auto'; ta.style.height = `${Math.max(64, ta.scrollHeight + 2)}px`; renderEdges(); };
  // Where in the note's text a point on screen falls, so a double-click puts the cursor on the word that was clicked.
  const offsetAt = (x, y) => {
    const pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(x, y) : null;
    const range = pos ? null : (document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null);
    const at = pos ? pos.offsetNode : range && range.startContainer; let k = pos ? pos.offset : range ? range.startOffset : 0;
    if (!at || at.nodeType !== 3 || !view.contains(at)) return null;
    const row = [...view.children].find((c) => c.contains(at)); const i = row ? [...view.children].indexOf(row) : -1; if (i < 0) return null;
    // A line with a link in it is several pieces of text: count the ones before the piece that was clicked.
    const tw = document.createTreeWalker(row, NodeFilter.SHOW_TEXT); for (let n; (n = tw.nextNode()) && n !== at;) k += n.data.length;
    const lines = String(d.text || '').split('\n'); if (i >= lines.length) return null;
    const m = CHECK.exec(lines[i]); const lead = m ? lines[i].length - m[3].length : 0; // "[ ] " is not drawn as text
    return lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0) + lead + Math.min(k, lines[i].length - lead);
  };
  const startEdit = (point) => {
    cancelOpen();
    const at = point && !view.hidden ? offsetAt(point.x, point.y) : null;
    view.hidden = true; ta.hidden = false; ta.value = d.text || ''; fit(); ta.focus();
    const end = at === null ? ta.value.length : at; ta.setSelectionRange(end, end);
  };
  const stopEdit = () => { if (ta.hidden) return; d.text = ta.value.replace(/\s+$/, ''); ta.hidden = true; view.hidden = false; save(); renderView(); renderEdges(); bus.emit('groups:render'); };
  view.addEventListener('dblclick', (e) => { e.stopPropagation(); startEdit({ x: e.clientX, y: e.clientY }); });
  ta.addEventListener('input', () => { d.text = ta.value; save(); fit(); });
  ta.addEventListener('blur', stopEdit);
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); ta.blur(); return; }
    if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey) return;
    // Return on a checkbox line starts the next checkbox; on an empty one it ends the list.
    const at = ta.selectionStart; const before = ta.value.slice(0, at); const lineStart = before.lastIndexOf('\n') + 1; const line = before.slice(lineStart);
    const m = CHECK.exec(line); if (!m) return;
    e.preventDefault();
    if (!m[3].trim()) { ta.value = ta.value.slice(0, lineStart) + ta.value.slice(at); ta.setSelectionRange(lineStart, lineStart); }
    else { const ins = `\n${m[1]}[ ] `; ta.value = before + ins + ta.value.slice(ta.selectionEnd); ta.setSelectionRange(at + ins.length, at + ins.length); }
    d.text = ta.value; save(); fit();
  });

  const toggleChecklist = () => {
    const lines = String(ta.hidden ? d.text || '' : ta.value).split('\n');
    d.text = hasChecks(lines.join('\n'))
      ? lines.map((l) => { const m = CHECK.exec(l); return m ? m[1] + m[3] : l; }).join('\n')
      : (lines.some((l) => l.trim()) ? lines.map((l) => (l.trim() ? `[ ] ${l.trim()}` : l)).join('\n') : '[ ] ');
    save();
    if (!ta.hidden || d.text === '[ ] ') startEdit(); else renderView();
    renderEdges();
  };
  const toPrompt = () => {
    const text = String(d.text || '').split('\n').map((l) => { const m = CHECK.exec(l); return m ? m[3] : l; }).join('\n').trim();
    const p = addNode('prompt', node.x, node.y, { text });
    removeNodes([node.id]); select([p.id]);
    toast('Turned into a Prompt node. Connect it to an Image, Video or LLM node.', 'ok');
  };
  root.append(
    tools(swatches(NOTE_COLORS, d.color || 'sand', (id) => { d.color = id; save(); const cc = noteColor(id); root.style.setProperty('--nf', cc.fill); root.style.setProperty('--nl', cc.line); root.style.setProperty('--nt', cc.text); root.querySelectorAll('.anno-swatch').forEach((s, k) => s.classList.toggle('on', NOTE_COLORS[k].id === id)); }),
      toolBtn('Checklist', 'Turn the lines into checkboxes, or back into plain text', toggleChecklist),
      toolBtn('To prompt', 'Turn this note into a Prompt node', toPrompt)),
    view, ta);
  for (const corner of ['nw', 'ne', 'sw', 'se']) { const g = el('div', `node-resize ${corner}`); g.dataset.corner = corner; g.title = 'Drag to resize · double-click to reset'; root.appendChild(g); }
  renderView(); guardLinks(view);
  root._edit = () => startEdit();
  applyInv(root);
}

// Put the cursor in a note or title that was just added.
export function editAnnotation(id) { const root = nodeEl(id); if (root && root._edit) requestAnimationFrame(() => root._edit()); }

// ---------- the tools bar keeps its size on screen ----------
// Set on each note and title only (a handful of elements), never on the canvas, so zooming stays cheap.
let inv = 1;
function applyInv(root) { root.style.setProperty('--inv', String(inv)); }
bus.on('view', () => {
  const next = Math.round((1 / state.view.z) * 100) / 100;
  if (next === inv) return; inv = next;
  document.querySelectorAll('.node-sticky, .node-heading').forEach(applyInv);
  placeTools();
});

// The tools bar shows for a lone selection only; several selected notes would stack bars on top of each other.
bus.on('selection', () => { document.body.classList.toggle('one-selected', state.sel.size === 1); placeTools(); });

// A note or title at the top of a group has its bar exactly where the group's label and buttons are. The bar is
// lifted clear of any group label it would cover, so the two sit one above the other. Both keep their size on screen
// while the board zooms, so this is looked at again when the zoom changes.
let lifted = null, placing = 0;
function placeTools() {
  if (placing) return;
  placing = requestAnimationFrame(() => {
    placing = 0;
    const bar = state.sel.size === 1 ? document.querySelector('.node.selected > .anno-tools') : null;
    if (lifted && lifted !== bar) lifted.style.removeProperty('--lift');
    lifted = bar; if (!bar) return;
    bar.style.removeProperty('--lift');
    if (!bar.offsetParent) return; // hidden while its node is dragged
    const labels = [...document.querySelectorAll('.group-bar')].map((b) => b.getBoundingClientRect()).filter((r) => r.width && r.height);
    let lift = 0;
    for (let i = 0; i < 4 && labels.length; i++) { // lifting over one label can land it on the next one up
      const r = bar.getBoundingClientRect();
      const hit = labels.filter((o) => r.left < o.right + 6 && r.right > o.left - 6 && r.top < o.bottom + 4 && r.bottom > o.top - 4);
      if (!hit.length) break;
      lift += (r.bottom - Math.min(...hit.map((o) => o.top)) + 6) / state.view.z;
      bar.style.setProperty('--lift', `${lift.toFixed(1)}px`);
    }
  });
}
bus.on('groups:render', placeTools);

// ---------- a starting layout for a film ----------
const FILM = [
  ['References', 'Mood, lighting and style references. Drop images and clips here.'],
  ['Characters', 'Character sheets and wardrobe. Group the nodes for each character.'],
  ['Locations', 'Environment references and establishing frames.'],
  ['Shots', 'Image and Video nodes, shot by shot.'],
  ['Finals', 'The takes you are keeping.'],
];
export function addFilmLayout(at) {
  const ids = []; const colors = ['sand', 'rust', 'moss', 'teal', 'navy'];
  FILM.forEach(([title, hint], i) => {
    const x = at.x + i * 1200;
    ids.push(addNode('heading', x, at.y, { text: title, size: 'l' }).id);
    ids.push(addNode('sticky', x, at.y + 130, { text: hint, color: colors[i] }).id);
  });
  select(ids);
  document.getElementById('empty').hidden = true;
  return ids;
}
