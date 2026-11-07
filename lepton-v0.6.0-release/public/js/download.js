// Multi-download: collect the media held by the selected nodes and fetch it as one zip.
import { state, bus, incoming, isGen } from './state.js';
import { modelName } from './models.js';
import { api } from './api.js';

const $ = (s) => document.querySelector(s);
const bar = $('#selbar'), text = $('#selbar-text'), btn = $('#selbar-download'), label = $('#selbar-label');
const toast = (msg, kind) => bus.emit('toast', { msg, kind });

const extOf = (url, kind) => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(String(url).split('?')[0]);
  if (m) return m[1].toLowerCase();
  return kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'png';
};
const slug = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();

function resultsOf(node) {
  return (node.data.results || []).filter((r) => r.status === 'completed' && r.url).map((r) => ({ url: r.url, kind: node.type, model: node.data.model, title: node.data.title }));
}
// Every file the node represents.
function filesOfNode(node) {
  if (!node) return [];
  if (node.type === 'media' && node.data.url && !node.data.pending) return [{ url: node.data.url, kind: node.data.kind || 'image', original: node.data.name, model: node.data.model, title: node.data.title }];
  if (isGen(node)) return resultsOf(node);
  if (node.type === 'compare') return ['a', 'b'].flatMap((p) => { const link = incoming(node.id, p)[0]; return link ? filesOfNode(state.nodes[link.from]) : []; });
  if (node.type === 'preview') { const link = incoming(node.id, 'in')[0]; return link ? filesOfNode(state.nodes[link.from]) : []; }
  return [];
}
export function selectedFiles() {
  const seen = new Set(); const out = [];
  for (const id of state.sel) for (const f of filesOfNode(state.nodes[id])) { if (seen.has(f.url)) continue; seen.add(f.url); out.push(f); }
  // Names: keep the original file name for uploads; otherwise "<node or model name> 01.ext".
  const counters = {};
  return out.map((f) => {
    const ext = extOf(f.url, f.kind);
    if (f.original && !f.model) return { url: f.url, name: slug(f.original), kind: f.kind };
    const base = slug((f.title && !/^(Image|Video|Media)$/.test(f.title) ? f.title : '') || (f.model ? modelName(f.model) : '') || f.kind);
    counters[base] = (counters[base] || 0) + 1;
    return { url: f.url, name: `${base} ${String(counters[base]).padStart(2, '0')}.${ext}`, kind: f.kind };
  });
}

function refresh() {
  const files = selectedFiles();
  const show = files.length >= 2;
  bar.hidden = !show;
  if (!show) return;
  const kinds = files.reduce((a, f) => ((a[f.kind] = (a[f.kind] || 0) + 1), a), {});
  const parts = Object.entries(kinds).map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`);
  text.textContent = `${state.sel.size} node${state.sel.size === 1 ? '' : 's'} selected · ${parts.join(', ')}`;
  label.textContent = `Download ${files.length} as .zip`;
}

let busy = false;
export async function downloadSelection() {
  if (busy) return;
  const files = selectedFiles();
  if (!files.length) { toast('Select nodes that hold images, video or audio first.'); return; }
  if (files.length === 1) { bus.emit('download', { url: files[0].url, kind: files[0].kind }); return; }
  busy = true; btn.classList.add('busy'); label.textContent = 'Preparing…';
  try {
    const stamp = new Date().toISOString().slice(0, 10);
    const r = await api.zip(files.map(({ url, name }) => ({ url, name })), `${slug(state.name) || 'Lepton'} ${stamp}`);
    const a = document.createElement('a'); a.href = r.url; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
    toast(r.skipped && r.skipped.length ? `Downloading ${r.count} files. ${r.skipped.length} could not be read.` : `Downloading ${r.count} files.`, r.skipped && r.skipped.length ? 'err' : 'ok');
  } catch (e) { toast(e.message, 'err'); }
  finally { busy = false; btn.classList.remove('busy'); refresh(); }
}

btn.addEventListener('click', downloadSelection);
bus.on('selection', refresh);
bus.on('results', refresh);
bus.on('node:remove', refresh);
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); e.stopPropagation(); downloadSelection(); }
}, true);
