// Thin client for the local server, which proxies to the Higgsfield API with the user's own key.

async function req(method, path, body, raw) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    if (raw) { opts.body = body; }
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  const r = await fetch(path, opts);
  let data = null;
  try { data = await r.json(); } catch { /* ignore */ }
  if (!r.ok) {
    const e = new Error((data && data.error) || `${r.status} ${r.statusText}`);
    e.code = data && data.code; e.status = r.status;
    throw e;
  }
  return data;
}

export const api = {
  status: () => req('GET', '/api/status'),
  models: (refresh = false) => req('GET', `/api/models${refresh ? '?refresh=1' : ''}`),
  schema: (model) => req('GET', `/api/schema?model=${encodeURIComponent(model)}`),
  generate: (job_type, params, medias, count) => req('POST', '/api/generate', { job_type, params, medias, count }),
  job: (id) => req('GET', `/api/job?id=${encodeURIComponent(id)}`),
  stopJobs: (ids) => req('POST', '/api/job/stop', { ids }),
  saveKey: (provider, fields) => req('POST', '/api/providers/key', { provider, fields }),
  removeKey: (provider) => req('DELETE', '/api/providers/key', { provider }),
  complete: (job_type, body) => req('POST', '/api/complete', { job_type, ...body }),
  skills: () => req('GET', '/api/skills'),
  skillRead: (id) => req('GET', `/api/skills/read?id=${encodeURIComponent(id)}`),
  skillInstall: (files, replace = true) => req('POST', '/api/skills/install', { files, replace }),
  skillInstallZip: (buf, replace = true) => req('POST', `/api/skills/install-zip?replace=${replace ? 1 : 0}`, buf, true),
  skillUpdate: (body) => req('POST', '/api/skills/update', body),
  skillFile: (body) => req('POST', '/api/skills/file', body),
  skillRemove: (id) => req('POST', '/api/skills/remove', { id }),
  skillsRoot: (dir) => req('POST', '/api/skills/root', { dir }),
  skillReveal: (id) => req('POST', '/api/skills/reveal', { id }),
  projects: () => req('GET', '/api/projects'),
  projectsRoot: (dir) => req('POST', '/api/projects/root', { dir }),
  projectSave: (body) => req('POST', '/api/projects/save', body),
  projectOpen: (idOrPath) => req('GET', `/api/projects/open?${idOrPath.id ? `id=${encodeURIComponent(idOrPath.id)}` : `path=${encodeURIComponent(idOrPath.path)}`}`),
  projectRename: (id, name) => req('POST', '/api/projects/rename', { id, name }),
  projectForget: (id) => req('POST', '/api/projects/forget', { id }),
  projectReveal: (id) => req('POST', '/api/projects/reveal', { id }),
  reveal: (url, project) => req('POST', '/api/reveal', { url, project }),
  storage: () => req('GET', '/api/storage'),
  storageSettings: (patch) => (patch ? req('POST', '/api/storage/settings', patch) : req('GET', '/api/storage/settings')),
  storageInUse: (client, refs) => req('POST', '/api/storage/in-use', { client, refs }),
  storageCleanUploads: (client, refs) => req('POST', '/api/storage/uploads/clean', { client, refs }),
  storageUnused: (id) => req('POST', '/api/storage/project/unused', { id }),
  storageTrim: (id, mode) => req('POST', '/api/storage/project/trim', { id, mode }),
  storagePngs: (id) => req('GET', `/api/storage/project/pngs?id=${encodeURIComponent(id)}`),
  storageStage: (id, name, blob) => req('POST', `/api/storage/project/stage?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`, blob, true),
  storageKeepPng: (id, names) => req('POST', '/api/storage/project/keep-png', { id, names }),
  storageConvert: (id, map) => req('POST', '/api/storage/project/convert', { id, map }),
  storageArchive: (id, finals) => req('POST', '/api/storage/project/archive', { id, finals }),
  storageArchiveRestore: (file) => req('POST', '/api/storage/archive/restore', { file }),
  storageArchiveReveal: () => req('POST', '/api/storage/archive/reveal', {}),
  storageTrashRestore: (scope, batch) => req('POST', '/api/storage/trash/restore', { scope, batch }),
  storageTrashEmpty: () => req('POST', '/api/storage/trash/empty', {}),
  zip: (files, name) => req('POST', '/api/zip', { files, name }),
  upload: (file) => req('POST', `/api/upload?name=${encodeURIComponent(file.name)}`, file, true),
  downloadUrl: (url, name) => `/api/fetch?url=${encodeURIComponent(url)}&download=${encodeURIComponent(name)}`,
};
