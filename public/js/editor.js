// The large editor: any text box in a node, opened big enough to read and edit a long prompt comfortably.
// It mirrors the box it was opened from. Every keystroke goes straight back to that box, so the node, autosave and
// anything connected to it see the change exactly as if it had been typed in the small box. Nothing is kept here.
import { state, bus, NODE_TYPES } from './state.js';
import { mentionField, boxFor, writeField, refreshField } from './mentions.js';

const $ = (s) => document.querySelector(s);
const toast = (msg, kind) => bus.emit('toast', { msg, kind });
const root = $('#editor'), slot = $('#editor-slot');

let job = null; // { nodeId, field, ta, original, timer }

const LABELS = { text: 'Prompt', prompt: 'Prompt', system: 'System prompt', instructions: 'Instruction', output: 'Output' };
function labelOf(node, field) {
  if (field.startsWith('values.')) { const sec = (node.data.spec?.sections || []).find((s) => s.key === field.slice(7)); return (sec && sec.label) || 'Text'; }
  if (field === 'output' && node.type === 'template') return 'Compiled prompt';
  return LABELS[field] || 'Text';
}
const source = () => (job ? boxFor(job.nodeId, job.field, job.ta) : null);
function count() {
  if (!job) return;
  const v = job.ta.value; const words = (v.trim().match(/\S+/g) || []).length;
  $('#editor-count').textContent = `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'} · ${v.length.toLocaleString()} ${v.length === 1 ? 'character' : 'characters'}`;
  $('#editor-revert').disabled = v === job.original;
  $('#editor-copy').disabled = !v;
}

export function openEditor({ nodeId, field, mode }) {
  const node = state.nodes[nodeId]; const src = node && boxFor(nodeId, field);
  if (!src) return;
  if (job) close();
  const ta = document.createElement('textarea'); ta.className = 'editor-text'; ta.spellcheck = false;
  ta.placeholder = src.placeholder || ''; ta.value = src.value;
  job = { nodeId, field, ta, original: src.value, timer: 0 };
  const title = node.data.title || NODE_TYPES[node.type].title; const label = labelOf(node, field);
  $('#editor-title').textContent = label;
  $('#editor-sub').textContent = title === label ? '' : title;
  slot.replaceChildren(mentionField(ta, node, mode, field, { expand: false }));
  ta.addEventListener('input', () => { const s = source(); if (s) writeField(s, ta.value); count(); });
  // The box can change underneath: a run finishing writes its output, a reconnection renumbers the mentions.
  job.timer = setInterval(() => {
    const s = source();
    if (!s) { close(); return; }
    if (s.value !== ta.value) { ta.value = s.value; refreshField(ta); count(); }
  }, 400);
  root.hidden = false;
  ta.focus();
  const a = Math.min(src.selectionStart ?? ta.value.length, ta.value.length), b = Math.min(src.selectionEnd ?? a, ta.value.length);
  ta.setSelectionRange(a, b);
  if (a >= ta.value.length) ta.scrollTop = ta.scrollHeight;
  count();
}
function close() {
  if (!job) return;
  clearInterval(job.timer);
  job = null; root.hidden = true; slot.replaceChildren();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}
function revert() {
  if (!job) return;
  const s = source(); if (s) writeField(s, job.original);
  job.ta.value = job.original; refreshField(job.ta); count(); job.ta.focus();
}
async function copy() {
  if (!job || !job.ta.value) return;
  try { await navigator.clipboard.writeText(job.ta.value); toast('Copied.'); } catch { toast('The text could not be copied.', 'err'); }
  job && job.ta.focus();
}

$('#editor-done').addEventListener('click', close);
$('#editor-close').addEventListener('click', close);
$('#editor-revert').addEventListener('click', revert);
$('#editor-copy').addEventListener('click', copy);
// Clicking the dimmed board behind closes; clicking the frame of the editor keeps the cursor in the text.
root.addEventListener('pointerdown', (e) => {
  if (e.target === root) { e.preventDefault(); close(); return; }
  if (!e.target.closest('textarea, button')) e.preventDefault();
});
// The editor owns the keyboard while it is open: nothing on the board behind it reacts.
window.addEventListener('keydown', (e) => {
  if (root.hidden || !job) return;
  const dlg = $('#dialog'); if (dlg && !dlg.hidden) return;
  if (e.key === 'Escape') {
    if (document.querySelector('.mention-menu:not([hidden])')) return; // Esc closes the "@" picker first
    e.preventDefault(); e.stopImmediatePropagation(); close(); return;
  }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
  if (!root.contains(e.target)) e.stopImmediatePropagation();
}, true);
bus.on('editor:open', openEditor);
