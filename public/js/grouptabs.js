// Group tabs: one tab per group, in a column down the left edge of the board.
//   Click   glides the view to that group and selects it.
//   Drag    moves the tab up or down the column; the others slide out of its way, and the order is kept with the board.
//   ⌥↑ ⌥↓   move the focused tab one place.
// The Groups button in the dock (or G) shows and hides the column. That choice belongs to this browser, not the board.
import { state, bus } from './state.js';
import { animateToRect } from './canvas.js';
import { groupBounds, selectGroup, reorderGroups, GROUP_COLORS } from './groups.js';

const rail = document.getElementById('group-tabs');
const KEY = 'lepton.groupTabs';
const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };

let shown = true;
try { shown = localStorage.getItem(KEY) !== '0'; } catch { /* private window: the setting lasts for this visit */ }
export const groupTabsShown = () => shown;
export function setGroupTabsShown(on) {
  shown = !!on;
  try { localStorage.setItem(KEY, shown ? '1' : '0'); } catch { /* as above */ }
  render(); bus.emit('grouptabs:shown', shown);
}

let drag = null;   // the tab being dragged, once it has moved
let held = false;  // a drag is in progress or settling: the column is not rebuilt under the pointer
let stale = false; // the groups changed while it was held

function render() {
  if (held) { stale = true; return; }
  stale = false;
  const groups = Object.values(state.groups);
  rail.hidden = !shown || !groups.length;
  if (rail.hidden) { rail.innerHTML = ''; return; }
  const focused = document.activeElement?.closest?.('.group-tab')?.dataset.id;
  const top = rail.scrollTop;
  rail.innerHTML = '';
  for (const g of groups) {
    const c = GROUP_COLORS.find((x) => x.id === g.color) || GROUP_COLORS[0];
    const n = g.nodeIds.filter((id) => state.nodes[id]).length;
    const tab = el('button', 'group-tab'); tab.type = 'button'; tab.dataset.id = g.id;
    tab.classList.toggle('on', state.selGroup === g.id);
    const dot = el('span', 'group-tab-dot'); dot.style.background = c.line; dot.style.boxShadow = `0 0 0 1px ${c.text}55`;
    tab.append(dot, el('span', 'group-tab-name', g.label), el('span', 'group-tab-count', String(n)));
    tab.title = `${g.label} · ${n} node${n === 1 ? '' : 's'}${g.collapsed ? ' · folded' : ''}\nClick to go to it · drag to reorder`;
    tab.addEventListener('pointerdown', (e) => press(e, tab));
    tab.addEventListener('click', (e) => { if (e.detail === 0) jump(g.id); }); // Return or Space; a pointer click is handled on release
    tab.addEventListener('keydown', (e) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault(); e.stopPropagation();
      const ids = Object.keys(state.groups); const i = ids.indexOf(g.id), j = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (j < 0 || j >= ids.length) return;
      ids.splice(j, 0, ids.splice(i, 1)[0]);
      reorderGroups(ids);
    });
    rail.appendChild(tab);
  }
  fit();
  rail.scrollTop = top;
  if (focused) rail.querySelector(`.group-tab[data-id="${focused}"]`)?.focus();
}

// Does the column hold more tabs than the window has room for? Measured without the fade's extra padding.
function fit() { rail.classList.remove('scrolls'); rail.classList.toggle('scrolls', rail.scrollHeight > rail.clientHeight + 1); }
window.addEventListener('resize', () => { if (!rail.hidden && !held) fit(); });

function jump(id) {
  const g = state.groups[id]; const b = g && groupBounds(g); if (!b) return;
  animateToRect(b, 90, 1, rail.getBoundingClientRect().right + 16);
  selectGroup(id);
}

// A press on a tab. Let go without moving and it is a click; move a few pixels and the tab is being dragged.
// The column holds the pointer, so the drag carries on when the pointer leaves the tab or the column.
function press(e, tab) {
  if (e.button !== 0 || held) return;
  e.preventDefault(); // no text selection, and the click that follows is ours to make
  const id = tab.dataset.id, pointer = e.pointerId, y0 = e.clientY, scroll0 = rail.scrollTop;
  let y = y0, frame = 0;
  try { rail.setPointerCapture(pointer); } catch { /* the pointer is already gone */ }

  const begin = () => {
    const tabs = [...rail.querySelectorAll('.group-tab')];
    const from = tabs.indexOf(tab);
    const step = tabs.length > 1 ? tabs[1].offsetTop - tabs[0].offsetTop : tab.offsetHeight;
    drag = { tabs, from, to: from, step };
    held = true;
    tab.classList.add('dragging'); rail.classList.add('sorting');
    frame = requestAnimationFrame(edge);
  };
  // Where the tab is, and which place that is: every tab between its old place and the new one moves over by one.
  const place = () => {
    const { tabs, from, step } = drag;
    const dy = Math.max(-from * step, Math.min((tabs.length - 1 - from) * step, y - y0 + rail.scrollTop - scroll0));
    const to = Math.max(0, Math.min(tabs.length - 1, from + Math.round(dy / step)));
    drag.to = to;
    tab.style.transform = `translateY(${dy}px)`;
    tabs.forEach((t, i) => { if (t !== tab) t.style.transform = i > from && i <= to ? `translateY(${-step}px)` : i < from && i >= to ? `translateY(${step}px)` : ''; });
  };
  // A column taller than the window scrolls while the pointer is held near its top or bottom.
  const edge = () => {
    if (!drag) return;
    const r = rail.getBoundingClientRect(); const reach = 28;
    const push = y < r.top + reach ? -Math.ceil((r.top + reach - y) / 4) : y > r.bottom - reach ? Math.ceil((y - (r.bottom - reach)) / 4) : 0;
    if (push) { const was = rail.scrollTop; rail.scrollTop = was + Math.max(-12, Math.min(12, push)); if (rail.scrollTop !== was) place(); }
    frame = requestAnimationFrame(edge);
  };
  const move = (ev) => {
    if (ev.pointerId !== pointer) return;
    y = ev.clientY;
    if (!drag && Math.abs(y - y0) > 4) begin();
    if (drag) place();
  };
  const up = (ev) => {
    if (ev.pointerId !== pointer) return;
    rail.removeEventListener('pointermove', move); rail.removeEventListener('pointerup', up); rail.removeEventListener('pointercancel', up);
    cancelAnimationFrame(frame);
    try { rail.releasePointerCapture(pointer); } catch { /* already released */ }
    if (!drag) { if (ev.type === 'pointerup') jump(id); return; }
    const { tabs, from, to, step } = drag; drag = null;
    const ids = tabs.map((t) => t.dataset.id);
    if (ev.type === 'pointerup') ids.splice(to, 0, ids.splice(from, 1)[0]);
    // The tab slides the last few pixels into its place, then the column is drawn again in the new order.
    tab.classList.remove('dragging'); tab.classList.add('settling');
    tab.style.transform = `translateY(${(ev.type === 'pointerup' ? to - from : 0) * step}px)`;
    if (ev.type !== 'pointerup') tabs.forEach((t) => { if (t !== tab) t.style.transform = ''; });
    reorderGroups(ids);
    setTimeout(() => { held = false; rail.classList.remove('sorting'); render(); }, 160);
  };
  rail.addEventListener('pointermove', move); rail.addEventListener('pointerup', up); rail.addEventListener('pointercancel', up);
}

bus.on('groups:list', render);
bus.on('selection', () => { for (const t of rail.children) t.classList.toggle('on', state.selGroup === t.dataset.id); });
render();
