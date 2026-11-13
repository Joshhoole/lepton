// Small board copies of pictures, and still frames of videos.
// A board shows a 2752×1536 picture about 280 pixels wide. Loading the full file for that is what makes a big board
// stutter, so the browser makes one small copy of each picture (and one still frame of each video), hands it to this
// module, and the board shows that instead. The original file is never changed and is still what gets generated
// from, enlarged and downloaded.
//
// The copies live in .cache/thumbs next to the app. They are a cache: deleting the folder only means they are made
// again the next time a board is opened. Nothing is ever written into a project folder.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function createThumbs({ ROOT, UPLOADS, send, fail, readJson, readBody, projectMediaFile }) {
  const DIR = path.join(ROOT, '.cache', 'thumbs');
  const MAX_BYTES = 2 * 1024 * 1024;
  const KEEP_DAYS = 60;
  const TYPES = { 'image/webp': '.webp', 'image/jpeg': '.jpg' };
  const MIME = { '.webp': 'image/webp', '.jpg': 'image/jpeg' };

  // key → { file, w, h, dur }. File names carry the original's size and length: <key>.<w>x<h>.<ms>.<ext>
  let index = null;
  function load() {
    if (index) return index;
    index = new Map();
    try {
      for (const f of fs.readdirSync(DIR)) {
        const m = /^([0-9a-f]{24})\.(\d+)x(\d+)\.(\d+)\.(webp|jpg)$/.exec(f);
        if (m) index.set(m[1], { file: f, w: Number(m[2]), h: Number(m[3]), dur: Number(m[4]) / 1000 });
      }
    } catch { /* no copies yet */ }
    return index;
  }

  // What a board URL points at, as a short stable key. A local file is known by its name and size, so its copy
  // survives the file moving from uploads/ into a project, and the project folder being moved or renamed.
  function keyOf(u) {
    u = String(u || '');
    let id = null;
    try {
      if (u.startsWith('/uploads/')) {
        let name = u.split('?')[0]; try { name = decodeURIComponent(name); } catch { /* a broken % sequence: use the name as it is */ }
        const abs = path.join(UPLOADS, path.basename(name));
        id = `file|${path.basename(abs)}|${fs.statSync(abs).size}`;
      } else if (u.startsWith('/projects/')) {
        const abs = projectMediaFile(u);
        if (abs) id = `file|${path.basename(abs)}|${fs.statSync(abs).size}`;
      } else if (/^https:\/\//.test(u)) {
        const x = new URL(u); id = `remote|${x.origin}${x.pathname}`; // signed links change their query, not their path
      }
    } catch { /* the file is gone */ }
    return id ? crypto.createHash('sha1').update(id).digest('hex').slice(0, 24) : null;
  }
  // Checked against the disk each time: the folder is a cache and may have been cleared while the app is running.
  const metaOf = (u) => {
    const k = keyOf(u); const t = k && load().get(k); if (!t) return null;
    if (!fs.existsSync(path.join(DIR, t.file))) { index.delete(k); return null; }
    return { w: t.w, h: t.h, dur: t.dur };
  };

  function serve(req, res, url) {
    const k = keyOf(url.searchParams.get('src')); const t = k && load().get(k);
    if (!t) return send(res, 404, { error: 'No small copy yet' });
    const abs = path.join(DIR, t.file);
    fs.stat(abs, (err, st) => {
      if (err) { index.delete(k); return send(res, 404, { error: 'No small copy yet' }); }
      const etag = `"${k}-${st.size}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'private, max-age=600' }); return res.end(); }
      // Touch at most once a day, so copies nobody looks at any more can be found and removed.
      if (Date.now() - st.mtimeMs > 86400000) fs.utimes(abs, new Date(), new Date(), () => {});
      res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)], 'Content-Length': st.size, ETag: etag, 'Cache-Control': 'private, max-age=600' });
      fs.createReadStream(abs).pipe(res);
    });
  }

  async function store(req, res, url) {
    try {
      const k = keyOf(url.searchParams.get('src'));
      if (!k) return send(res, 404, { error: 'That file is not on this computer.' });
      const ext = TYPES[String(req.headers['content-type'] || '').split(';')[0].trim()];
      if (!ext) return send(res, 415, { error: 'A small copy must be WebP or JPEG.' });
      const num = (name, max) => Math.max(0, Math.min(max, Math.round(Number(url.searchParams.get(name)) || 0)));
      const w = num('w', 100000), h = num('h', 100000), ms = num('ms', 86400000);
      const buf = await readBody(req, MAX_BYTES);
      if (buf.length < 32) return send(res, 400, { error: 'Empty' });
      fs.mkdirSync(DIR, { recursive: true });
      const old = load().get(k);
      const file = `${k}.${w}x${h}.${ms}${ext}`;
      fs.writeFileSync(path.join(DIR, file), buf);
      if (old && old.file !== file) fs.rm(path.join(DIR, old.file), { force: true }, () => {});
      index.set(k, { file, w, h, dur: ms / 1000 });
      send(res, 200, { ok: true, w, h, dur: ms / 1000 });
    } catch (e) { fail(res, e); }
  }

  // Which of these URLs have a small copy, with the original's size (and a video's length).
  async function have(req, res) {
    try {
      const { urls = [] } = await readJson(req);
      const out = {};
      for (const u of urls.slice(0, 5000)) { const m = metaOf(u); if (m) out[u] = m; }
      send(res, 200, { have: out });
    } catch (e) { fail(res, e); }
  }

  // Copies that no board has shown for two months are removed. They are only a cache.
  function purge() {
    try {
      const cut = Date.now() - KEEP_DAYS * 86400000;
      for (const f of fs.readdirSync(DIR)) {
        const abs = path.join(DIR, f);
        if (fs.statSync(abs).mtimeMs < cut) { fs.rmSync(abs, { force: true }); if (index) index.delete(f.slice(0, 24)); }
      }
    } catch { /* nothing to clean */ }
  }

  return {
    purge,
    routes: {
      'GET /api/thumb': async (req, res, url) => serve(req, res, url),
      'POST /api/thumb': store,
      'POST /api/thumb/have': have,
    },
  };
};
