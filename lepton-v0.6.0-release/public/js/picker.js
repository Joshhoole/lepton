// Model picker: a two-column menu. Providers on the left; hover or click one and its models appear on the right,
// grouped by family (Kling, Seedream, Nano Banana…). Search across everything at the top, and a "Latest only" switch
// hides superseded versions so the list stays short.
import { modelsFor, modelName, PROVIDER_ORDER, PROVIDER_LABEL } from './models.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };
const LS_LATEST = 'lepton.latestOnly';
export const latestOnly = () => { try { return localStorage.getItem(LS_LATEST) !== '0'; } catch { return true; } };
const setLatestOnly = (v) => { try { localStorage.setItem(LS_LATEST, v ? '1' : '0'); } catch { /* ignore */ } };

// "Kling 3.0 Omni · Text to video" → family "Kling", version 3, task "Text to video".
export function describeModel(m) {
  const name = m.display_name || m.job_type;
  let [head, ...rest] = name.split(' · ');
  // A maker's name in front ("Google · Imagen 4", "Bytedance Seedance 2.0 Mini") is not the family.
  const mk = /^(Google|OpenAI|Anthropic|ByteDance|Alibaba|xAI)\s*/i.exec(head);
  const maker = mk ? mk[1] : '';
  head = head.slice(mk ? mk[0].length : 0);
  if (!head.trim() && rest.length) head = rest.shift();
  const short = [head, ...rest].join(' · ').trim();
  // A task phrase may sit inside the head too ("Kling 4.0 Reference to Video", "Kling 2.6 motion-control").
  const TASK = /\b((?:text|image|reference|keyframe|video|audio|speech|first-last-frame|first & last frame)[ -]to[ -](?:image|video|audio)|motion[ -]control|motion[ -]transfer|video[ -]edit|video[ -]extend|transformation|image[ -]edit|edit|remix|upscale|lip[ -]sync|avatar)\b.*$/i;
  const tm = TASK.exec(head);
  if (tm && tm.index > 0) { rest.unshift(tm[0]); head = head.slice(0, tm.index); }
  const vm = /(?:^|\s)v?(\d+(?:\.\d+)?)(?=\s|$)/i.exec(head);
  const version = vm ? parseFloat(vm[1]) : null;
  let family = (vm ? head.slice(0, vm.index) : head).replace(/\s+(Pro|Lite|Flash|Standard|Std|Max|Ultra|Turbo|Fast|Master|Mini|Omni|Prime|Video|Image|AI)\b.*$/i, '').trim();
  if (!family) family = /bytedance/i.test(maker) ? 'Seedance' : maker || head.trim() || name;
  const task = rest.join(' · ').toLowerCase().replace(/[-·]/g, ' ').replace(/\s+/g, ' ').trim();
  return { name, short, family, version, task };
}
// Drop versions that a newer one of the same family and task has replaced.
export function filterLatest(models) {
  const best = new Map();
  const info = models.map((m) => ({ m, d: describeModel(m) }));
  for (const { m, d } of info) { if (d.version === null) continue; const k = `${m.provider}|${d.family.toLowerCase()}|${d.task}`; best.set(k, Math.max(best.get(k) ?? -Infinity, Math.floor(d.version))); }
  return info.filter(({ m, d }) => d.version === null || Math.floor(d.version) >= (best.get(`${m.provider}|${d.family.toLowerCase()}|${d.task}`) ?? 0)).map((x) => x.m);
}

let open = null;
export function closePicker() { if (!open) return; open.el.remove(); window.removeEventListener('pointerdown', open.outside, true); window.removeEventListener('keydown', open.key, true); window.removeEventListener('resize', closePicker); open = null; }

export function openModelPicker({ anchor, kind, current, onPick }) {
  closePicker();
  const all = modelsFor(kind).all;
  const box = el('div', 'picker');
  const head = el('div', 'picker-head');
  const search = el('input', 'picker-search'); search.placeholder = 'Search models…'; search.spellcheck = false;
  const latest = el('label', 'picker-latest'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = latestOnly(); latest.append(cb, el('span', '', 'Latest only'));
  head.append(search, latest);
  const cols = el('div', 'picker-cols'); const left = el('div', 'picker-providers'); const right = el('div', 'picker-models');
  cols.append(left, right); box.append(head, cols);
  document.body.appendChild(box);
  open = { el: box };

  let provider = (all.find((m) => m.job_type === current) || {}).provider || PROVIDER_ORDER.find((p) => all.some((m) => m.provider === p));
  const visible = () => { let list = cb.checked ? filterLatest(all) : all; if (current && !list.some((m) => m.job_type === current)) { const cur = all.find((m) => m.job_type === current); if (cur) list = [...list, cur]; } return list; };
  const providers = () => { const ids = [...PROVIDER_ORDER, ...all.map((m) => m.provider).filter((p) => !PROVIDER_ORDER.includes(p))]; return [...new Set(ids)].filter((p) => all.some((m) => m.provider === p)); };

  function renderLeft() {
    left.innerHTML = '';
    const list = visible();
    for (const p of providers()) {
      const n = list.filter((m) => m.provider === p).length;
      const row = el('button', `picker-provider ${p === provider ? 'on' : ''}`); row.type = 'button';
      row.append(el('span', 'picker-provider-name', PROVIDER_LABEL[p] || p), el('span', 'picker-count', String(n)));
      row.addEventListener('pointerenter', () => { if (provider !== p) { provider = p; renderLeft(); renderRight(); } });
      row.addEventListener('click', () => { provider = p; renderLeft(); renderRight(); });
      left.appendChild(row);
    }
  }
  function renderRight() {
    right.innerHTML = '';
    const q = search.value.trim().toLowerCase();
    let list = visible();
    if (q) list = list.filter((m) => `${m.display_name} ${PROVIDER_LABEL[m.provider] || m.provider} ${m.job_type}`.toLowerCase().includes(q));
    else list = list.filter((m) => m.provider === provider);
    if (!list.length) { right.appendChild(el('div', 'picker-empty', q ? 'No model matches.' : 'No models from this provider.')); return; }
    // Group by family, in catalogue order; search results also show the provider.
    const groups = new Map();
    for (const m of list) { const d = describeModel(m); const key = q ? `${PROVIDER_LABEL[m.provider] || m.provider} · ${d.family}` : d.family; (groups.get(key) || groups.set(key, []).get(key)).push({ m, d }); }
    for (const [fam, items] of groups) {
      const sec = el('div', 'picker-group');
      sec.appendChild(el('div', 'picker-family', fam));
      for (const { m, d } of items) {
        const row = el('button', `picker-model ${m.job_type === current ? 'on' : ''}`); row.type = 'button';
        // Inside a family group the family name is implied: "Kling 3.0 Omni · Text to video" → "3.0 Omni · Text to video".
        let label = d.short || d.name; if (!q && label.toLowerCase().startsWith(d.family.toLowerCase())) label = label.slice(d.family.length).replace(/^\s*·?\s*/, '') || label;
        row.append(el('span', 'picker-model-name', label));
        if (m.credits) row.appendChild(el('span', 'picker-credits', `${m.credits} cr`));
        row.addEventListener('click', () => { closePicker(); onPick(m.job_type); });
        sec.appendChild(row);
      }
      right.appendChild(sec);
    }
    const cur = right.querySelector('.picker-model.on'); if (cur) cur.scrollIntoView({ block: 'center' });
  }
  cb.addEventListener('change', () => { setLatestOnly(cb.checked); renderLeft(); renderRight(); });
  search.addEventListener('input', () => { renderLeft(); renderRight(); });
  renderLeft(); renderRight();

  // Beside the node (right, else left) so the node's own controls stay visible; below or above the control as a last resort.
  const r = anchor.getBoundingClientRect();
  const nr = (anchor.closest('.node') || anchor).getBoundingClientRect();
  const w = box.offsetWidth, h = box.offsetHeight;
  let x, y = Math.min(Math.max(8, r.top - 12), Math.max(8, innerHeight - h - 8));
  if (nr.right + 10 + w <= innerWidth - 8) x = nr.right + 10;
  else if (nr.left - 10 - w >= 8) x = nr.left - 10 - w;
  else { x = Math.min(Math.max(8, r.left), Math.max(8, innerWidth - w - 8)); y = r.bottom + 6 + h <= innerHeight - 8 ? r.bottom + 6 : Math.max(8, r.top - h - 6); }
  box.style.left = `${x}px`; box.style.top = `${y}px`;
  open.outside = (e) => { if (!box.contains(e.target)) closePicker(); };
  open.key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePicker(); }
    else if (e.key === 'Enter' && document.activeElement === search) { const first = right.querySelector('.picker-model'); if (first) { e.preventDefault(); first.click(); } }
    else if (e.key === 'ArrowDown' && document.activeElement === search) { const first = right.querySelector('.picker-model'); if (first) { e.preventDefault(); first.focus(); } }
  };
  window.addEventListener('pointerdown', open.outside, true);
  window.addEventListener('keydown', open.key, true);
  window.addEventListener('resize', closePicker);
  setTimeout(() => search.focus(), 20);
}
export { modelName };
