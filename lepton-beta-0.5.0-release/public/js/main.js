// Boot.
import { state, bus, load, addNode, addEdge, save } from './state.js';
import { applyView, fitToView } from './canvas.js';
import { mountAll } from './nodes.js';
import { refreshStatus } from './ui.js';
import { loadModels } from './models.js';
import { resumeAll } from './run.js';
import { renderGroups } from './groups.js';
import { initProjects } from './projects.js';
import './download.js';

function seedStarterBoard() {
  const p = addNode('prompt', 80, 200, { text: 'A quiet coastal town at blue hour, wet cobblestones reflecting warm shop windows, soft mist, cinematic 35mm still.' });
  const img = addNode('image', 460, 150, { params: { aspect_ratio: '16:9' }, batch: 2 });
  const pv = addNode('preview', 860, 150);
  addEdge(p.id, 'out', img.id, 'prompt');
  addEdge(img.id, 'out', pv.id, 'in');
  save();
}

(async function boot() {
  const had = load();
  if (!had || !Object.keys(state.nodes).length) {
    if (!had) seedStarterBoard();
  }
  document.getElementById('board-name').textContent = state.project ? state.project.name : state.name;
  initProjects();
  mountAll();
  applyView();
  requestAnimationFrame(renderGroups);
  document.getElementById('empty').hidden = Object.keys(state.nodes).length > 0;
  if (!had) requestAnimationFrame(() => setTimeout(() => fitToView(120), 60));

  await refreshStatus();
  try { await loadModels(); bus.emit('models'); } catch { /* no key yet: nodes show a hint until one is added */ }
  resumeAll();
})();
