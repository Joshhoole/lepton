// Text boxes that grow with their text and can be pulled taller by hand. A box grows on its own up to a cap; drag its
// bottom-right corner to make it any height you like (saved with the board); double-click the corner to let it grow
// on its own again.
import { save } from './state.js';
import { renderEdges } from './canvas.js';

const GRIP = 22; // px from the bottom-right corner that counts as the handle
// `store` is where the chosen height lives: an object and a key (node.data.heights, 'prompt').
export function textbox(ta, { min = 40, cap = 320, store = null, key = '', onGrow = null } = {}) {
  ta.classList.add('resizable');
  ta.style.minHeight = `${min}px`;
  const saved = () => (store && store[key]) || null;
  let lastSet = 0; // the height this code chose; anything else is the user's doing
  const setH = (h) => { lastSet = h; ta.style.height = `${h}px`; };
  const fit = () => {
    if (saved()) { setH(saved()); return; }
    ta.style.height = 'auto';
    setH(Math.min(cap, Math.max(min, ta.scrollHeight + 2)));
    if (onGrow) onGrow();
  };
  const inCorner = (e) => { const r = ta.getBoundingClientRect(); return e.clientX > r.right - GRIP && e.clientY > r.bottom - GRIP; };
  // The browser owns the pointer during a native resize, so the change is noticed by size, not by mouse events.
  let settle = null;
  const observer = new ResizeObserver(() => {
    const h = ta.offsetHeight;
    if (!h || Math.abs(h - lastSet) < 2) return;
    clearTimeout(settle);
    settle = setTimeout(() => { lastSet = h; if (store) { store[key] = h; save(); } renderEdges(); }, 150);
  });
  observer.observe(ta);
  // Double-click the corner: back to fitting the text.
  ta.addEventListener('dblclick', (e) => { if (!inCorner(e)) return; e.preventDefault(); if (store) { delete store[key]; save(); } fit(); renderEdges(); });
  ta.addEventListener('input', fit);
  ta.addEventListener('focus', fit);
  requestAnimationFrame(fit);
  return fit;
}
// A home for saved heights on a node.
export const heightsOf = (node) => (node.data.heights ||= {});
