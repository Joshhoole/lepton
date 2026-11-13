// Peek: a small floating card that shows what sits on the other end of a strand. Hover a connected-image chip,
// a linked prompt or a port that has something plugged in, and the image, clip or full text appears beside the node.
let el = null, timer = null, anchor = null, suppressed = false;
const $el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };

function media(kind, url) {
  const box = $el('div', `peek-media ${kind}`);
  if (kind === 'video') { const v = document.createElement('video'); v.src = url; v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true; v.preload = 'metadata'; box.appendChild(v); }
  else { const i = document.createElement('img'); i.src = url; i.draggable = false; box.appendChild(i); }
  return box;
}
function build(spec) {
  const card = $el('div', 'peek');
  if (spec.title) { const head = $el('div', 'peek-head'); head.appendChild($el('span', 'peek-title', spec.title)); if (spec.subtitle) head.appendChild($el('span', 'peek-sub', spec.subtitle)); card.appendChild(head); }
  if (spec.url && spec.kind !== 'audio') card.appendChild(media(spec.kind || 'image', spec.url));
  else if (spec.text !== undefined) card.appendChild($el('div', 'peek-text', spec.text || '(empty)'));
  if (spec.items) {
    const list = $el('div', 'peek-list');
    for (const it of spec.items) {
      const row = $el('div', 'peek-row');
      if (it.url && it.kind !== 'audio') { const m = media(it.kind || 'image', it.url); m.classList.add('small'); row.appendChild(m); }
      const body = $el('div', 'peek-row-body');
      body.appendChild($el('div', 'peek-row-name', it.name || ''));
      if (it.text) body.appendChild($el('div', 'peek-row-text', it.text.replace(/\s+/g, ' ').slice(0, 220)));
      row.appendChild(body); list.appendChild(row);
    }
    card.appendChild(list);
  }
  if (spec.hint) card.appendChild($el('div', 'peek-hint', spec.hint));
  return card;
}
function place(card, a) {
  const r = a.getBoundingClientRect();
  const nr = (a.closest('.node') || a).getBoundingClientRect();
  const w = card.offsetWidth, h = card.offsetHeight, M = 8;
  let x, y = Math.min(Math.max(M, r.top - 6), Math.max(M, innerHeight - h - M));
  if (nr.right + 10 + w <= innerWidth - M) x = nr.right + 10;
  else if (nr.left - 10 - w >= M) x = nr.left - 10 - w;
  else { x = Math.min(Math.max(M, r.left), Math.max(M, innerWidth - w - M)); y = r.top - h - 8 >= M ? r.top - h - 8 : Math.min(r.bottom + 8, innerHeight - h - M); }
  card.style.left = `${Math.round(x)}px`; card.style.top = `${Math.round(y)}px`;
}
export function hidePeek() {
  clearTimeout(timer); timer = null; anchor = null;
  if (el) { el.remove(); el = null; }
}
// `spec`: { title, subtitle, kind, url, text, items: [{ kind, url, name, text }], hint }
export function showPeek(anchorEl, spec, delay = 200) {
  if (suppressed) return;
  clearTimeout(timer); anchor = anchorEl;
  timer = setTimeout(() => {
    timer = null;
    if (anchor !== anchorEl || !document.body.contains(anchorEl)) return;
    if (el) el.remove();
    el = build(spec); document.body.appendChild(el); place(el, anchorEl);
  }, delay);
}
export function peekSuppressed(on) { suppressed = on; if (on) hidePeek(); }
// Anything that moves the board, or a press anywhere, takes the card away.
window.addEventListener('pointerdown', hidePeek, true);
window.addEventListener('wheel', hidePeek, { capture: true, passive: true });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePeek(); }, true);
window.addEventListener('resize', hidePeek);
