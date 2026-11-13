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
  // The browser owns the pointer during a native resize, so the change is noticed by size, not by mouse events. A new
  // size counts as chosen by hand only while the corner is being held: a box that changes height because it was
  // hidden and shown again, or because the page laid it out afresh, goes back to fitting its text and nothing is saved.
  // (It used to be saved as if it had been dragged, which pinned the box at that height and stopped it growing.)
  let settle = null, held = false, refit = 0;
  ta.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !inCorner(e)) return;
    held = true;
    const up = () => { window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true); setTimeout(() => { held = false; }, 300); };
    window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
  });
  const observer = new ResizeObserver(() => {
    const h = ta.offsetHeight;
    if (!h || Math.abs(h - lastSet) < 2) return;
    if (!held) { cancelAnimationFrame(refit); refit = requestAnimationFrame(fit); return; } // on the next frame: resizing inside the observer makes the browser complain
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
