// Hints: rest the pointer on a button or a setting and a small card says what it does, sometimes with a tip.
// One card for the whole app. The words live in the two lists below (HINTS for parts of the interface, PARAMS for a
// model's settings); anything not listed that carries a plain `title` shows that title in the same card, so the
// browser's own grey tooltip never appears beside it.
// Settings → Hints turns the cards off (kept per browser). With them off, the browser's plain tooltips are back.
const KEY = 'lepton.hints';
let on = true;
try { on = localStorage.getItem(KEY) !== '0'; } catch { /* private window: on for this visit */ }
export const hintsOn = () => on;

// A port's card carries the port's own name: "Input · References".
const named = (what, el) => { const own = (el.getAttribute('title') || el.dataset.hintTitle || '').trim(); return own && own.length < 40 ? `${what} · ${own}` : what; };
// [selector, { title, key, text, tip }] or a function of the element. The deepest element under the pointer that
// matches one of these wins; a plain `title` on something deeper still wins over a listed thing around it.
const HINTS = [
  // the dock
  ['.dock-btn[data-tool="select"]', { title: 'Select', key: 'Esc', text: 'The normal pointer: move, select and connect nodes.' }],
  ['.dock-btn[data-tool="cut"]', { title: 'Scissors', key: 'X', text: 'Drag a line across strings to cut every one it crosses, or click a single string.', tip: '⌘Z brings a cut back.' }],
  ['.dock-btn[data-tool="pen"]', { title: 'Pen', key: 'D', text: 'Draw on the board, over the nodes too. Colours, sizes and an eraser appear above the dock.' }],
  ['.dock-btn[data-add="prompt"]', { title: 'Prompt', key: 'P', text: 'A text box. Its text feeds every node you connect it to.', tip: 'One Prompt can feed many nodes: change it once, re-run them all.' }],
  ['.dock-btn[data-add="image"]', { title: 'Image', key: 'I', text: 'Makes pictures from a prompt, with reference images if you connect some.', tip: 'Type @ in its prompt to point at a connected image: “@image 1 as the style”.' }],
  ['.dock-btn[data-add="video"]', { title: 'Video', key: 'V', text: 'Makes a clip from a prompt, a start frame, an end frame or references, depending on the model.' }],
  ['.dock-btn[data-add="audio"]', { title: 'Audio', key: 'A', text: 'Turns text into speech in a voice you pick.', tip: 'For two voices in one take, start a line with a voice’s name and a colon: “Zephyr: Hello.”' }],
  ['.dock-btn[data-add="llm"]', { title: 'LLM', key: 'L', text: 'A text model. Give it an instruction and connect prompts, images, video or audio; its answer feeds the next node.', tip: 'Try: “Describe this image as a video prompt.”' }],
  ['.dock-btn[data-add="batch"]', { title: 'Prompt batch', key: 'B', text: 'Splits one text into separate prompts, each with its own port.', tip: 'Ask an LLM for five numbered shots, then connect All prompts to one Image node.' }],
  ['.dock-btn[data-add="preview"]', { title: 'Preview', key: 'O', text: 'Shows the results of the node connected to it, large.' }],
  ['.dock-btn[data-add="compare"]', { title: 'Compare', key: 'C', text: 'Two images or videos under a slider, side by side or overlaid.' }],
  ['.dock-btn[data-add="linkin"]', { title: 'Link in', key: 'K', text: 'Gathers references under a name, so they can be used far away without long strings.' }],
  ['#btn-linkout', { title: 'Link out', key: '⇧K', text: 'Stands for everything in a Link in. Put one wherever those references are needed.' }],
  ['#btn-notes', { title: 'Notes and titles', key: 'N · T', text: 'Sticky notes and large titles for planning. They are never sent to a model.', tip: 'A web address in a note or a title becomes a link.' }],
  ['#btn-upload', { title: 'Upload', key: 'U', text: 'Add images, video or audio from your computer.', tip: 'Files can also be dropped or pasted straight onto the board.' }],
  ['#btn-projects', { title: 'Projects', key: '⌘O', text: 'Save the board to a folder with all its files, or open another one.' }],
  ['#btn-skills', { title: 'Skills', key: '⇧S', text: 'Folders of instructions and reference files that you connect to an LLM node.' }],
  ['#btn-groups', { title: 'Group tabs', key: 'G', text: 'Shows or hides the tabs on the left, one per group.', tip: 'Select nodes and press ⌘G to make a group.' }],
  // top bar, zoom, selection
  ['#status-pill', { title: 'Connections', text: 'Which services are connected and how many models they offer. Click to add or change a key.' }],
  ['#btn-settings', { title: 'Settings', text: 'Keys, folders, storage, hints, import and export, and the list of shortcuts.' }],
  ['#board-name', { title: 'Board name', text: 'Double-click to rename.' }],
  ['#zoom-out', { title: 'Zoom out', key: '−', text: 'See more of the board.', tip: '⌘ + scroll zooms where the pointer is.' }],
  ['#zoom-in', { title: 'Zoom in', key: '+', text: 'Look closer.', tip: '⌘ + scroll zooms where the pointer is.' }],
  ['#zoom-level', { title: 'Zoom', key: '⌘0', text: 'Click to go back to 100%.' }],
  ['#zoom-fit', { title: 'Fit to view', key: '⇧1', text: 'Shows the whole board.' }],
  ['#snap-grid', { title: 'Snap to grid', key: '⇧G', text: 'Dragged nodes land on an invisible grid.', tip: 'Hold ⇧ while dragging to place one freely.' }],
  ['#selbar-download', { title: 'Download', key: '⇧⌘D', text: 'Every file in the selected nodes, as one zip.' }],
  ['#selbar-tidy', { title: 'Tidy up', text: 'Straightens the selected nodes into rows and columns, keeping their places.', tip: '⌘Z puts them back.' }],
  // a node
  ['.node-title', { title: 'Name', text: 'Double-click to rename. @ mentions and lists use this name.' }],
  ['.node-menu', { title: 'More', text: 'Run, rename, copy, duplicate, group or delete this node.' }],
  ['.port[data-dir="out"], .gport[data-dir="out"]', (el) => ({ title: named('Output', el), text: 'Drag from here to another node’s input.', tip: 'Let go on empty board to add a node that fits.' })],
  ['.port[data-dir="in"], .gport[data-dir="in"]', (el) => ({ title: named('Input', el), text: `Drop a string here from another node’s output.${el.classList.contains('multi') ? ' It takes several.' : ''}`, tip: 'Select several nodes and drag one string: they all connect.' })],
  ['.node-resize', { title: 'Resize', text: 'Drag to resize. Double-click to go back to the usual size.' }],
  ['.model-btn', { title: 'Model', text: 'The model this node uses. Click to search every model from your connected services.', tip: '“Latest only” hides versions a newer one has replaced.' }],
  ['.gen-btn', { title: 'Run', text: 'Runs this node. What it makes is kept: a new run never overwrites the last one.', tip: 'While it is running, the same button stops it.' }],
  ['.disclosure.history-disc', { title: 'History', text: 'Earlier runs of this node. Restore one to make it the current result again.' }],
  ['.disclosure', { title: 'Advanced', text: 'Less common settings this model offers.' }],
  ['.ref-chip', { title: 'Connected image', text: 'Its number is how the prompt refers to it (@image 2). Drag to reorder; × disconnects it.' }],
  ['.results .thumb', { title: 'Result', text: 'Click to enlarge. The outlined one is what feeds the next node.' }],
  ['.batch-fan', { title: 'One node per prompt', text: 'Adds an Image or Video node for each prompt in the list.', tip: 'Or connect All prompts to a single node to run them together.' }],
  ['.cmb-sep', { title: 'Between each', text: 'What goes between the pieces when they are joined.', tip: 'A comma suits keyword lists; a blank line suits paragraphs.' }],
  ['.cmb-grip', { title: 'Order', text: 'Drag to change the order the pieces are joined in.' }],
  ['.media-caption', { title: 'Caption', text: 'A note under the picture, for you. It is not sent to a model.' }],
  ['.group-name', { title: 'Group name', text: 'Double-click to rename.' }],
  ['.swatches', { title: 'Colour', text: 'The colour of this group’s panel and tab.' }],
  // settings
  ['#btn-refresh-models', { title: 'Refresh models', text: 'Asks each connected service for its current list of models.' }],
  ['#btn-storage', { title: 'Storage', text: 'See what each project takes on disk and clear what is no longer used.' }],
  ['#btn-export', { title: 'Export', text: 'Saves this board as one file. Media is linked, not included: use Projects to keep the files too.' }],
  ['#btn-import-board', { title: 'Import', text: 'Opens a board file in place of this one.' }],
  ['#btn-clear', { title: 'Clear board', text: 'Removes every node from this board.', tip: '⌘Z brings them back.' }],
  ['#hints-switch', { title: 'Hints', text: 'These cards. Turn them off once you know your way around.' }],
];

// A model's settings, by the name the provider gives them. `kind:name` wins over `name` (an Audio node's Style is not
// an Image model's Style).
const PARAMS = {
  aspect_ratio: { title: 'Aspect', text: 'The shape of the result.', tip: 'Auto reads it from your prompt (“vertical”, “16:9”) or from a connected image.' },
  size: { title: 'Size', text: 'The shape and size of the result, in pixels.' },
  resolution: { title: 'Resolution', text: 'How much detail. Higher costs more and takes longer.', tip: 'Draft at the lowest, then re-run the one you keep at a higher one.' },
  image_size: { title: 'Size', text: 'How large the picture is. Larger costs more and takes longer.', tip: 'Draft small, then re-run the one you keep larger.' },
  quality: { title: 'Quality', text: 'How much effort the model spends. Higher costs more.' },
  mode: { title: 'Mode', text: 'The model’s quality tier. “Pro” is slower and costs more than “std”.' },
  duration: { title: 'Duration', text: 'The length of the clip, in seconds. Longer costs more.', tip: 'Short clips hold together better; cut several into a sequence.' },
  batch: { title: 'Batch', text: 'How many versions to make in one run, all from the same prompt and settings.', tip: 'Make 4, keep the best, then refine that one.' },
  sound: { title: 'Sound', text: 'Have the model make sound to go with the video.' },
  generate_audio: { title: 'Sound', text: 'Have the model make sound to go with the video.' },
  background: { title: 'Background', text: 'Transparent gives a cut-out you can place over anything.' },
  output_format: { title: 'Format', text: 'The kind of file. PNG keeps transparency; JPEG is much smaller.' },
  seed: { title: 'Seed', text: 'Fixes the randomness: the same seed and prompt give nearly the same result.', tip: 'Keep the seed and change one word to compare just that change.' },
  negative_prompt: { title: 'Negative prompt', text: 'What you do not want to see.', tip: 'Try: “text, watermark, extra fingers”.' },
  temperature: { title: 'Temperature', text: 'How adventurous the writing is. Low is steady and literal; high is more varied.' },
  prompt_extend: { title: 'Extend prompt', text: 'Lets the model rewrite your prompt with more detail before it starts.', tip: 'Turn it off when you need exactly what you wrote.' },
  prompt_optimizer: { title: 'Optimise prompt', text: 'Lets the model rewrite your prompt before it starts.', tip: 'Turn it off when you need exactly what you wrote.' },
  enhance_prompt: { title: 'Enhance prompt', text: 'Lets the model rewrite your prompt with more detail before it starts.', tip: 'Turn it off when you need exactly what you wrote.' },
  camera_fixed: { title: 'Lock camera', text: 'Keeps the camera still; only the subject moves.' },
  camera_movement: { title: 'Camera', text: 'How the camera moves through the shot.' },
  fps: { title: 'FPS', text: 'Frames per second. 24 looks like film; higher looks smoother.' },
  steps: { title: 'Steps', text: 'How many passes the model makes. More is slower and usually cleaner.' },
  guidance: { title: 'Guidance', text: 'How closely the result follows the prompt. Higher is more literal.' },
  cfg_scale: { title: 'CFG', text: 'How closely the result follows the prompt. Higher is more literal.' },
  enable_thinking: { title: 'Thinking', text: 'Lets the model reason before it answers. Slower, often better on hard prompts.' },
  multi_shots: { title: 'Multi-shot', text: 'Lets the model cut between several shots inside one clip.' },
  aigc_watermark: { title: 'Watermark', text: 'Adds the provider’s “AI generated” mark to the result.' },
  rendering_speed: { title: 'Speed', text: 'Faster is cheaper and rougher; slower is cleaner.' },
  image_weight: { title: 'Image weight', text: 'How strongly a connected image steers the result.' },
  style_strength: { title: 'Style strength', text: 'How strongly the style reference is applied.' },
  voice: { title: 'Voice', text: 'Who speaks. Press play beside the list to hear a sample.' },
  stability: { title: 'Stability', text: 'Low is expressive and varies between takes; high is steady and even.', tip: 'Double-click a slider to reset it.' },
  similarity_boost: { title: 'Similarity', text: 'How closely the speech keeps to the chosen voice.', tip: 'Double-click a slider to reset it.' },
  'audio:style': { title: 'Style', text: 'How much the voice’s manner is exaggerated. 0 is the most natural.' },
  speed: { title: 'Speed', text: 'How fast it speaks. 1 is normal.' },
  language_code: { title: 'Language', text: 'Holds the speech to one language instead of letting the model work it out.' },
  split_by: { title: 'Split by', text: 'How the text is cut into prompts.', tip: 'Auto understands numbered lists, “Prompt 1:” headings and blank lines.' },
  separator: { title: 'Separator', text: 'Your own marker between prompts, such as --- on a line by itself.' },
};

// ---------- the card ----------
const card = document.createElement('div'); card.className = 'hint-card'; card.hidden = true; card.setAttribute('role', 'tooltip');
document.body.appendChild(card);
let timer = 0, shownFor = null, lastShown = 0, stashed = null;

function hintFor(target) {
  for (let el = target, depth = 0; el && el.nodeType === 1 && el !== document.body && depth < 14; el = el.parentElement, depth++) {
    if (el.dataset && el.dataset.param) {
      const kind = el.closest('.node')?.className.match(/node-([a-z]+)/)?.[1] || '';
      const p = PARAMS[`${kind}:${el.dataset.param}`] || PARAMS[el.dataset.param];
      if (p) return { el, hint: p };
    }
    for (const [sel, hint] of HINTS) if (el.matches(sel)) return { el, hint: typeof hint === 'function' ? hint(el) : hint };
    // A setting's label carries the provider's raw name for it ("cfg_scale"): the row's own card says more.
    if (el.tagName === 'LABEL' && el.parentElement?.dataset.param && PARAMS[el.parentElement.dataset.param]) continue;
    const t = el.getAttribute('title') || el.dataset.hintTitle;
    if (t && t.trim()) return { el, hint: { text: t.trim() } };
  }
  return null;
}
// The browser's own tooltip for the same element is held back while the card is up.
function stash(el) { const t = el.getAttribute('title'); if (t !== null) { el.dataset.hintTitle = t; el.removeAttribute('title'); stashed = el; } }
function unstash() { const el = stashed; stashed = null; if (el && el.dataset.hintTitle !== undefined) { if (!el.hasAttribute('title')) el.setAttribute('title', el.dataset.hintTitle); delete el.dataset.hintTitle; } }

function show(el, hint) {
  unstash(); stash(el);
  card.textContent = '';
  if (hint.title) {
    const head = document.createElement('div'); head.className = 'hint-head';
    const name = document.createElement('b'); name.textContent = hint.title; head.appendChild(name);
    if (hint.key) { const k = document.createElement('kbd'); k.textContent = hint.key; head.appendChild(k); }
    card.appendChild(head);
  }
  const body = document.createElement('div'); body.className = 'hint-text'; body.textContent = hint.text; card.appendChild(body);
  if (hint.tip) { const tip = document.createElement('div'); tip.className = 'hint-tip'; const b = document.createElement('b'); b.textContent = 'Tip'; tip.append(b, ` ${hint.tip}`); card.appendChild(tip); }
  card.hidden = false; card.classList.remove('in');
  const r = el.getBoundingClientRect(); const w = card.offsetWidth, h = card.offsetHeight; const gap = 10;
  let x, y;
  const host = el.closest('.node'); const hr = host && !el.closest('.node-head, .anno-tools') ? host.getBoundingClientRect() : null;
  if (hr && (hr.right + gap + w <= window.innerWidth - 8 || hr.left - gap - w >= 8)) {
    // Something inside a node: the card stands beside the node, level with it, so it never covers the next setting.
    const rightFits = hr.right + gap + w <= window.innerWidth - 8, leftFits = hr.left - gap - w >= 8;
    const wantRight = r.left + r.width / 2 >= hr.left + hr.width / 2;
    x = (wantRight && rightFits) || !leftFits ? hr.right + gap : hr.left - gap - w;
    y = Math.max(8, Math.min(window.innerHeight - h - 8, r.top + r.height / 2 - h / 2));
  } else {
    // Under the thing it describes, or over it when there is no room (the dock is at the bottom of the window).
    x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    y = r.bottom + gap; if (y + h > window.innerHeight - 8 || el.closest('.dock')) y = r.top - gap - h;
    if (y < 8) y = Math.min(window.innerHeight - h - 8, r.bottom + gap);
  }
  card.style.left = `${Math.round(x)}px`; card.style.top = `${Math.round(y)}px`;
  requestAnimationFrame(() => card.classList.add('in'));
  shownFor = el; lastShown = performance.now();
}
function hide() {
  clearTimeout(timer); timer = 0;
  if (shownFor) lastShown = performance.now();
  shownFor = null; card.hidden = true; unstash();
}

document.addEventListener('pointerover', (e) => {
  if (!on || e.pointerType === 'touch' || e.buttons) return;
  const found = e.target && e.target.nodeType === 1 ? hintFor(e.target) : null;
  if (!found) { hide(); return; }
  if (found.el === shownFor) return;
  clearTimeout(timer);
  // The first card waits a moment; moving along a row of buttons after that shows the next one at once.
  const wait = shownFor || performance.now() - lastShown < 500 ? 80 : 550;
  timer = setTimeout(() => { if (found.el.isConnected && found.el.matches(':hover')) show(found.el, found.hint); }, wait);
}, true);
document.addEventListener('pointerout', (e) => { if (shownFor && (!e.relatedTarget || !shownFor.contains(e.relatedTarget))) hide(); else if (!shownFor && !e.relatedTarget) clearTimeout(timer); }, true);
for (const type of ['pointerdown', 'keydown', 'wheel', 'scroll']) window.addEventListener(type, hide, { capture: true, passive: true });
window.addEventListener('blur', hide);

// ---------- the switch in Settings ----------
function apply() {
  document.body.classList.toggle('hints-on', on);
  const sw = document.getElementById('hints-switch');
  if (sw) { sw.classList.toggle('on', on); sw.setAttribute('aria-checked', String(on)); }
  if (!on) hide();
}
export function setHints(v) {
  on = !!v;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* not remembered */ }
  apply();
}
document.getElementById('hints-switch')?.addEventListener('click', () => setHints(!on));
apply();
