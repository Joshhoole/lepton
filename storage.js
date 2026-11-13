/*
 * Lepton — storage housekeeping.
 * Measures what the app keeps on disk and gives space back without losing work:
 *   · uploads/ is a temporary folder: a file leaves it once a project holds its own copy, or once no board has
 *     used it for a while;
 *   · a project can drop its earlier runs, the takes nobody picked, and files nothing points to;
 *   · generated PNGs can be stored as JPEG (the page does the encoding, so there is still no dependency);
 *   · a finished project can be packed into one zip and brought back later.
 * Whatever is removed goes to a .trash folder first and stays there for 30 days. The two exceptions are a copy in
 * uploads/ that a project already holds byte for byte, and "finals only" archiving, which says so before it runs.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const DAY = 24 * 3600 * 1000;
const TRASH = '.trash';
const TRASH_DAYS = 30;
const DAY_CHOICES = [0, 7, 14, 30]; // 0 = never clear uploads automatically
const TERMINAL = new Set(['completed', 'failed', 'nsfw', 'cancelled', 'canceled', 'error']);

module.exports = function createStorage({ ROOT, UPLOADS, ApiError, readConfig, writeConfig, projectsRoot, listProjects, encPath, decPath, safeName, writeZip, jobRefs, openFolder, send, fail, readJson, readBody }) {
  // ---------- settings ----------
  function settings() {
    const s = readConfig().storage || {};
    return { imageFormat: s.imageFormat === 'png' ? 'png' : 'jpeg', uploadsDays: DAY_CHOICES.includes(s.uploadsDays) ? s.uploadsDays : 14, trashDays: TRASH_DAYS, since: s.since || 0 };
  }
  // Automatic clearing starts a few days after the first browser checks in, so every browser the user works in has
  // had the chance to say what its board is using. Pressing a button is never held back by this.
  const GRACE = 3 * DAY;
  function markStart() { const cfg = readConfig(); if (cfg.storage && cfg.storage.since) return; cfg.storage = { ...(cfg.storage || {}), since: Date.now() }; writeConfig(cfg); }
  const autoReady = () => { const s = settings(); return s.since > 0 && Date.now() - s.since > GRACE; };
  function saveSettings(patch = {}) {
    const cur = settings(); const cfg = readConfig();
    cfg.storage = {
      ...(cfg.storage || {}),
      imageFormat: patch.imageFormat === 'png' || patch.imageFormat === 'jpeg' ? patch.imageFormat : cur.imageFormat,
      uploadsDays: DAY_CHOICES.includes(patch.uploadsDays) ? patch.uploadsDays : cur.uploadsDays,
    };
    writeConfig(cfg);
    return settings();
  }

  // ---------- files ----------
  const statOf = (abs) => { try { return fs.statSync(abs); } catch { return null; } };
  // Plain files directly inside a folder. Dot-files (caches, the trash) are never counted or touched.
  function filesIn(dir) {
    let names = []; try { names = fs.readdirSync(dir); } catch { return []; }
    const out = [];
    for (const name of names) { if (name.startsWith('.')) continue; const abs = path.join(dir, name); const st = statOf(abs); if (st && st.isFile()) out.push({ name, abs, size: st.size, mtime: st.mtimeMs }); }
    return out;
  }
  const sum = (list) => list.reduce((a, f) => a + (f.size || 0), 0);
  const tally = (list) => ({ bytes: sum(list), count: list.length });
  function move(src, dest) { try { fs.renameSync(src, dest); } catch { fs.copyFileSync(src, dest); fs.unlinkSync(src); } }
  function folderBytes(dir) {
    let total = 0, count = 0, names = []; try { names = fs.readdirSync(dir); } catch { return { bytes: 0, count: 0 }; }
    for (const name of names) { const abs = path.join(dir, name); const st = statOf(abs); if (!st) continue; if (st.isDirectory()) { const t = folderBytes(abs); total += t.bytes; count += t.count; } else if (name !== 'manifest.json' && name !== 'board.json') { total += st.size; count++; } }
    return { bytes: total, count };
  }
  const sha = (text) => crypto.createHash('sha1').update(text).digest('hex');
  const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

  // ---------- boards ----------
  // Every string in a value, replaced by what fn returns. Boards keep URLs in several shapes; walking all of
  // them means a new node type can never make a file look unused by accident.
  function walk(v, fn) {
    if (typeof v === 'string') return fn(v);
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = walk(v[i], fn); return v; }
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = walk(v[k], fn); return v; }
    return v;
  }
  const isRef = (s) => s.length < 4096 && (s.startsWith('/uploads/') || s.startsWith('/projects/') || /^https?:\/\//.test(s));
  function boardRefs(board, into = new Set()) { walk((board && board.nodes) || {}, (s) => { if (isRef(s)) into.add(s); return s; }); return into; }
  // The file a URL names inside a project's media folder, whichever folder path the URL was written with.
  const mediaName = (ref) => { const m = /^\/projects\/[^/]+\/media\/(.+)$/.exec(String(ref).split('?')[0]); return m ? decode(m[1]) : null; };
  function mediaNames(refs) { const out = new Set(); for (const r of refs) { const n = mediaName(r); if (n) out.add(n); } return out; }

  // A copy of the board without its earlier runs ('history'), or also down to one picked result per prompt ('takes').
  function trimmed(board, mode) {
    const b = JSON.parse(JSON.stringify(board || {}));
    for (const n of Object.values(b.nodes || {})) {
      const d = n.data || {};
      if (Array.isArray(d.history) && d.history.length) d.history = [];
      if (mode !== 'takes' || !Array.isArray(d.results) || d.results.length < 2 || (n.type !== 'image' && n.type !== 'video')) continue;
      const picked = d.results[d.selected];
      // A node fed by a prompt batch holds one set of takes per prompt: keep one from each.
      const groups = new Map();
      for (const r of d.results) { const k = r.pi === undefined ? '_' : r.pi; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
      const keep = new Set();
      for (const list of groups.values()) {
        const done = list.filter((r) => r.status === 'completed' && r.url);
        keep.add(done.includes(picked) ? picked : done[0] || list[0]);
        for (const r of list) if (r.jobId && !TERMINAL.has(r.status)) keep.add(r); // still generating
      }
      d.results = d.results.filter((r) => keep.has(r));
      d.selected = Math.max(0, d.results.indexOf(picked));
    }
    return b;
  }
  const historyRuns = (board) => Object.values((board && board.nodes) || {}).reduce((a, n) => a + ((n.data && Array.isArray(n.data.history) && n.data.history.length) || 0), 0);
  // Media files that came out of an Image node (now or in an earlier run): the only ones ever re-encoded.
  function generatedNames(board) {
    const out = new Set(); const add = (r) => { const n = r && typeof r.url === 'string' ? mediaName(r.url) : null; if (n) out.add(n); };
    for (const n of Object.values((board && board.nodes) || {})) {
      if (n.type !== 'image') continue; const d = n.data || {};
      (d.results || []).forEach(add); for (const run of d.history || []) (run.results || []).forEach(add);
    }
    return out;
  }
  // A project folder that was moved, renamed or restored still carries URLs written for its old path: point them here.
  function rebase(board, dir) {
    const id = encPath(dir); const mediaDir = path.join(dir, 'media'); let n = 0;
    walk((board && board.nodes) || {}, (s) => {
      const m = /^\/projects\/([^/]+)\/media\/(.+)$/.exec(s); if (!m || m[1] === id) return s;
      if (!fs.existsSync(path.join(mediaDir, decode(m[2].split('?')[0])))) return s;
      n++; return `/projects/${id}/media/${m[2]}`;
    });
    return n;
  }

  // ---------- project files ----------
  const docPath = (dir) => path.join(dir, 'project.json');
  function readDoc(dir) {
    let raw; try { raw = fs.readFileSync(docPath(dir), 'utf8'); } catch { throw new ApiError('That project could not be found on disk.', { code: 'NO_PROJECT' }); }
    const doc = JSON.parse(raw); doc.board ||= {};
    return { raw, doc };
  }
  function writeDoc(dir, doc) { const text = JSON.stringify(doc, null, 2); const tmp = `${docPath(dir)}.tmp`; fs.writeFileSync(tmp, text); fs.renameSync(tmp, docPath(dir)); return text; }
  function projectDir(id) { const dir = id ? decPath(id) : null; if (!dir || !fs.existsSync(docPath(dir))) throw new ApiError('That project could not be found on disk.', { code: 'NO_PROJECT' }); return dir; }
  const mediaDirOf = (dir) => path.join(dir, 'media');
  // Notes kept beside a project (which PNGs to leave alone). Hidden, tiny, and safe to delete.
  const sidePath = (dir) => path.join(dir, '.storage.json');
  const readSide = (dir) => { try { return JSON.parse(fs.readFileSync(sidePath(dir), 'utf8')) || {}; } catch { return {}; } };
  function keepPng(dir, names) { if (!names.length) return; const s = readSide(dir); s.keepPng = [...new Set([...(s.keepPng || []), ...names.map((n) => path.basename(String(n)))])].slice(-5000); try { fs.writeFileSync(sidePath(dir), JSON.stringify(s)); } catch { /* next pass asks again */ } }
  function convertible(dir, board, files) {
    const keep = new Set(readSide(dir).keepPng || []); const gen = generatedNames(board);
    return files.filter((f) => /\.png$/i.test(f.name) && gen.has(f.name) && !keep.has(f.name));
  }
  // Bit depth and whether the PNG can carry transparency, read from its header. null when it is not a PNG.
  function pngInfo(abs) {
    let fd;
    try {
      fd = fs.openSync(abs, 'r'); const head = Buffer.alloc(33);
      if (fs.readSync(fd, head, 0, 33, 0) < 33 || head.readUInt32BE(0) !== 0x89504e47) return null;
      const depth = head[24], type = head[25]; let alpha = type === 4 || type === 6;
      for (let off = 33, i = 0; !alpha && i < 40; i++) { // a tRNS chunk ahead of the pixels also means transparency
        const ch = Buffer.alloc(8); if (fs.readSync(fd, ch, 0, 8, off) < 8) break;
        const tag = ch.toString('latin1', 4, 8); if (tag === 'tRNS') alpha = true; if (tag === 'IDAT' || tag === 'IEND') break;
        off += 12 + ch.readUInt32BE(0);
      }
      return { depth, alpha };
    } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ } }
  }

  // ---------- what the open boards are using ----------
  // Each browser reports the URLs on its board, so a file on an unsaved board is never mistaken for an unused one.
  const IN_USE = path.join(ROOT, '.cache', 'in-use.json');
  const readInUse = () => { try { return JSON.parse(fs.readFileSync(IN_USE, 'utf8')) || {}; } catch { return {}; } };
  function noteInUse(client, refs) {
    if (!client || !Array.isArray(refs)) return;
    const all = readInUse(); const now = Date.now();
    for (const [k, v] of Object.entries(all)) if (now - ((v && v.at) || 0) > 90 * DAY) delete all[k];
    all[String(client).slice(0, 64)] = { at: now, refs: refs.filter((s) => typeof s === 'string' && isRef(s)).slice(0, 50000) };
    try { fs.mkdirSync(path.dirname(IN_USE), { recursive: true }); fs.writeFileSync(IN_USE, JSON.stringify(all)); markStart(); } catch { /* the next report writes it */ }
  }
  function reportedRefs() { const out = new Set(); const all = readInUse(); for (const v of Object.values(all)) for (const r of (v && v.refs) || []) out.add(r); return { refs: out, any: Object.keys(all).length > 0 }; }

  // ---------- trash ----------
  function trashBatch(base, action, files, extra = {}, boardBefore = null) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(base, TRASH, `${stamp}-${action}`); fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
    const moved = [];
    for (const f of files) { try { move(f.abs, path.join(dir, 'files', f.name)); moved.push({ name: f.name, size: f.size }); } catch { /* leave it where it is */ } }
    if (boardBefore !== null) fs.writeFileSync(path.join(dir, 'board.json'), boardBefore);
    const manifest = { action, at: Date.now(), files: moved, bytes: sum(moved), ...extra };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    return { id: path.basename(dir), ...manifest };
  }
  function listTrash(base, scope, name) {
    const root = path.join(base, TRASH); let names = []; try { names = fs.readdirSync(root); } catch { return []; }
    const out = [];
    for (const id of names) {
      if (id.startsWith('.')) continue;
      try { const m = JSON.parse(fs.readFileSync(path.join(root, id, 'manifest.json'), 'utf8')); out.push({ id, scope, name, action: m.action, at: m.at, bytes: m.bytes || 0, count: (m.files || []).length, board: fs.existsSync(path.join(root, id, 'board.json')) }); }
      catch { const st = statOf(path.join(root, id)); if (st && st.isDirectory()) out.push({ id, scope, name, action: 'unknown', at: st.mtimeMs, ...folderBytes(path.join(root, id)), board: false }); }
    }
    return out;
  }
  function trashedFiles(base) {
    const root = path.join(base, TRASH); let names = []; try { names = fs.readdirSync(root); } catch { return []; }
    const out = [];
    for (const id of names) { try { out.push(...(JSON.parse(fs.readFileSync(path.join(root, id, 'manifest.json'), 'utf8')).files || [])); } catch { /* not a batch */ } }
    return out;
  }
  const batchDir = (base, id) => { const safe = path.basename(String(id || '')); const dir = path.join(base, TRASH, safe); if (!safe || safe.startsWith('.') || !fs.existsSync(dir)) throw new ApiError('Those files are no longer in Recently removed.'); return dir; };
  function purge(base, days) {
    let n = 0;
    for (const b of listTrash(base)) if (Date.now() - (b.at || 0) > days * DAY) { try { fs.rmSync(path.join(base, TRASH, b.id), { recursive: true, force: true }); n++; } catch { /* next pass */ } }
    try { if (!fs.readdirSync(path.join(base, TRASH)).length) fs.rmdirSync(path.join(base, TRASH)); } catch { /* not empty, or not there */ }
    return n;
  }
  function emptyTrash(base) { const t = folderBytes(path.join(base, TRASH)); try { fs.rmSync(path.join(base, TRASH), { recursive: true, force: true }); } catch { /* ignore */ } return t; }
  // Put a batch back. Files always return to where they were; the board returns too when nothing has been saved since.
  function restoreBatch(base, id, destDir, isProject) {
    const dir = batchDir(base, id); let manifest = {}; try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { /* files only */ }
    fs.mkdirSync(destDir, { recursive: true });
    const back = [];
    for (const f of filesIn(path.join(dir, 'files'))) { const dest = path.join(destDir, f.name); if (fs.existsSync(dest)) continue; try { move(f.abs, dest); back.push(f); } catch { /* stays in the trash */ } }
    let board = null; const snap = path.join(dir, 'board.json'); const hadBoard = fs.existsSync(snap);
    if (isProject && hadBoard && manifest.after) {
      const now = fs.readFileSync(docPath(base), 'utf8');
      if (sha(now) === manifest.after) { const raw = fs.readFileSync(snap, 'utf8'); board = JSON.parse(raw).board || {}; const tmp = `${docPath(base)}.tmp`; fs.writeFileSync(tmp, raw); fs.renameSync(tmp, docPath(base)); }
    }
    if (!filesIn(path.join(dir, 'files')).length) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
    return { ...tally(back), action: manifest.action || 'unknown', board, boardChanged: hadBoard && !board };
  }

  // ---------- uploads ----------
  const knownProjectDirs = () => { try { return listProjects().projects.map((p) => p.path); } catch { return []; } };
  // Sort every file in uploads/ into: on a board somewhere, already copied into a project, or used by nothing.
  function uploadsReport() {
    const files = filesIn(UPLOADS);
    const { refs, any } = reportedRefs();
    for (const r of jobRefs()) if (typeof r === 'string') refs.add(r);
    const copies = new Set();
    for (const dir of knownProjectDirs()) {
      try { boardRefs(readDoc(dir).doc.board, refs); } catch { /* unreadable project: its files still count below */ }
      for (const f of filesIn(mediaDirOf(dir))) copies.add(`${f.name}:${f.size}`);
      // A file the project has since trimmed or re-encoded is still the project's to restore, not a loose upload.
      for (const f of trashedFiles(dir)) copies.add(`${f.name}:${f.size}`);
    }
    const exact = new Set(), remote = new Set();
    for (const r of refs) {
      if (r.startsWith('/uploads/')) exact.add(decode(path.basename(r.split('?')[0])));
      else if (/^https?:\/\//.test(r)) remote.add(`remote-${sha(r).slice(0, 12)}`); // the cached download of a provider URL
    }
    const used = [], saved = [], unused = [];
    for (const f of files) {
      if (exact.has(f.name) || (f.name.startsWith('remote-') && remote.has(f.name.slice(0, 19)))) used.push(f);
      else if (copies.has(`${f.name}:${f.size}`)) saved.push(f);
      else unused.push(f);
    }
    return { files, used, saved, unused, reported: any };
  }
  function cleanUploads({ manual = false } = {}) {
    const s = settings(); const rep = uploadsReport(); const now = Date.now();
    const removed = []; const auto = rep.reported && autoReady();
    if (!manual && !auto) return { removed: tally([]), trashed: { bytes: 0, count: 0 } };
    // A project holds the same file under the same name, so this copy is only taking up space. (A copy made in the
    // last two minutes waits: the page may not have switched to the project's one yet.)
    for (const f of rep.saved) if (manual || now - f.mtime > 2 * 60 * 1000) { try { fs.unlinkSync(f.abs); removed.push(f); } catch { /* next pass */ } }
    const stale = manual ? rep.unused : s.uploadsDays ? rep.unused.filter((f) => now - f.mtime > s.uploadsDays * DAY) : [];
    const batch = stale.length ? trashBatch(UPLOADS, 'uploads', stale) : null;
    return { removed: tally(removed), trashed: batch ? { bytes: batch.bytes, count: batch.files.length } : { bytes: 0, count: 0 } };
  }
  function purgeAll() { purge(UPLOADS, TRASH_DAYS); for (const dir of knownProjectDirs()) purge(dir, TRASH_DAYS); }
  let tidyTimer = null;
  function tidy() { try { purgeAll(); return cleanUploads(); } catch (e) { console.warn(`  Storage tidy skipped: ${e.message}`); return null; } }
  function scheduleTidy(delay = 4000) { clearTimeout(tidyTimer); tidyTimer = setTimeout(tidy, delay); if (tidyTimer.unref) tidyTimer.unref(); }
  setInterval(tidy, 6 * 3600 * 1000).unref();

  // ---------- one project ----------
  function analyse(dir, held = new Set()) {
    const { doc } = readDoc(dir); const board = doc.board; const files = filesIn(mediaDirOf(dir));
    const all = mediaNames(boardRefs(board)); const noHist = mediaNames(boardRefs(trimmed(board, 'history'))); const finals = mediaNames(boardRefs(trimmed(board, 'takes')));
    const st = statOf(docPath(dir));
    return {
      id: encPath(dir), path: dir, name: doc.name || path.basename(dir), savedAt: doc.savedAt || null,
      bytes: sum(files) + (st ? st.size : 0), files: files.length, runs: historyRuns(board),
      unused: tally(files.filter((f) => !all.has(f.name) && !held.has(f.name))),
      history: tally(files.filter((f) => all.has(f.name) && !noHist.has(f.name))),
      takes: tally(files.filter((f) => noHist.has(f.name) && !finals.has(f.name))),
      png: tally(convertible(dir, board, files)),
    };
  }
  function removeUnused(dir) {
    const { doc } = readDoc(dir); const names = mediaNames(boardRefs(doc.board)); const held = mediaNames(reportedRefs().refs);
    const stale = filesIn(mediaDirOf(dir)).filter((f) => !names.has(f.name) && !held.has(f.name));
    if (!stale.length) return { bytes: 0, count: 0 };
    const b = trashBatch(dir, 'unused', stale);
    return { bytes: b.bytes, count: b.files.length };
  }
  function trimProject(dir, mode) {
    const { raw, doc } = readDoc(dir); const before = mediaNames(boardRefs(doc.board));
    doc.board = trimmed(doc.board, mode === 'takes' ? 'takes' : 'history');
    const after = mediaNames(boardRefs(doc.board));
    const gone = filesIn(mediaDirOf(dir)).filter((f) => before.has(f.name) && !after.has(f.name));
    const text = JSON.stringify(doc, null, 2);
    if (text === raw) return { bytes: 0, count: 0, board: doc.board };
    writeDoc(dir, doc);
    const b = trashBatch(dir, mode === 'takes' ? 'takes' : 'history', gone, { after: sha(text) }, raw);
    return { bytes: b.bytes, count: b.files.length, board: doc.board };
  }
  // PNGs worth re-encoding, for the page to work through. 16-bit files are left alone for good.
  function pngList(dir) {
    const { doc } = readDoc(dir); const id = encPath(dir); const out = [], skip = [];
    for (const f of convertible(dir, doc.board, filesIn(mediaDirOf(dir)))) {
      const info = pngInfo(f.abs);
      if (!info || info.depth > 8) { skip.push(f.name); continue; }
      out.push({ name: f.name, size: f.size, alpha: info.alpha, url: `/projects/${id}/media/${encodeURIComponent(f.name)}` });
    }
    keepPng(dir, skip);
    return out;
  }
  // The page's JPEG of one PNG, written beside it. Nothing points at it until the batch is committed.
  function stageJpeg(dir, name, buf) {
    const src = path.join(mediaDirOf(dir), path.basename(String(name))); const st = statOf(src);
    if (!st || !/\.png$/i.test(src)) throw new ApiError('That image is no longer in the project.');
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new ApiError('The converted image did not arrive intact.');
    if (buf.length > st.size * 0.85) { keepPng(dir, [name]); return { skipped: true }; } // not worth a lossy copy
    const base = path.basename(src).replace(/\.png$/i, ''); let out = `${base}.jpg`, k = 2;
    while (fs.existsSync(path.join(mediaDirOf(dir), out))) out = `${base}-${k++}.jpg`;
    fs.writeFileSync(path.join(mediaDirOf(dir), out), buf);
    return { name: out, size: buf.length };
  }
  function commitConvert(dir, map) {
    const id = encPath(dir); const { raw, doc } = readDoc(dir); const mediaDir = mediaDirOf(dir);
    const to = new Map(); const olds = []; let newBytes = 0;
    for (const [a, b] of Object.entries(map || {})) {
      const from = path.basename(String(a)), dest = path.basename(String(b));
      const s1 = statOf(path.join(mediaDir, from)), s2 = statOf(path.join(mediaDir, dest));
      if (!s1 || !s2 || !/\.png$/i.test(from) || !/\.jpe?g$/i.test(dest)) continue;
      to.set(from, dest); olds.push({ name: from, abs: path.join(mediaDir, from), size: s1.size }); newBytes += s2.size;
    }
    if (!to.size) return { count: 0, bytes: 0, urls: {} };
    const urls = {};
    walk(doc.board.nodes || {}, (s) => { const n = mediaName(s); if (!n || !to.has(n)) return s; const next = `/projects/${id}/media/${to.get(n)}`; urls[s] = next; return next; });
    const text = writeDoc(dir, doc);
    const b = trashBatch(dir, 'convert', olds, { after: sha(text) }, raw);
    return { count: b.files.length, bytes: Math.max(0, b.bytes - newBytes), urls };
  }

  // ---------- archive ----------
  const archiveDir = () => path.join(projectsRoot(), 'Archive');
  const listArchives = () => filesIn(archiveDir()).filter((f) => /\.zip$/i.test(f.name)).map((f) => ({ file: f.name, name: f.name.replace(/\.zip$/i, ''), bytes: f.size, at: f.mtime })).sort((a, b) => b.at - a.at);
  // Central directory of a zip, read from the end of the file so a large archive never has to fit in memory.
  function zipEntries(zip) {
    const fd = fs.openSync(zip, 'r');
    try {
      const size = fs.fstatSync(fd).size; const tailLen = Math.min(size, 66000); const tail = Buffer.alloc(tailLen);
      fs.readSync(fd, tail, 0, tailLen, size - tailLen);
      const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); if (eocd < 0) throw new ApiError('That file is not a zip archive.');
      const count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
      const cd = Buffer.alloc(cdSize); fs.readSync(fd, cd, 0, cdSize, cdOff);
      const out = []; let off = 0;
      for (let i = 0; i < count && off + 46 <= cd.length; i++) {
        if (cd.readUInt32LE(off) !== 0x02014b50) break;
        const method = cd.readUInt16LE(off + 10), csize = cd.readUInt32LE(off + 20), usize = cd.readUInt32LE(off + 24), nlen = cd.readUInt16LE(off + 28), xlen = cd.readUInt16LE(off + 30), clen = cd.readUInt16LE(off + 32), lho = cd.readUInt32LE(off + 42);
        out.push({ name: cd.slice(off + 46, off + 46 + nlen).toString('utf8'), method, csize, usize, lho });
        off += 46 + nlen + xlen + clen;
      }
      return out;
    } finally { fs.closeSync(fd); }
  }
  function extractEntry(zip, e, dest) {
    const fd = fs.openSync(zip, 'r');
    try {
      const lh = Buffer.alloc(30); fs.readSync(fd, lh, 0, 30, e.lho);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw new ApiError('The archive is damaged.');
      let pos = e.lho + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      if (e.method === 8) { const buf = Buffer.alloc(e.csize); fs.readSync(fd, buf, 0, e.csize, pos); fs.writeFileSync(dest, zlib.inflateRawSync(buf)); return; }
      if (e.method !== 0) throw new ApiError('The archive uses a compression this app cannot read.');
      const out = fs.openSync(dest, 'w');
      try { const chunk = Buffer.alloc(4 * 1024 * 1024); let left = e.csize; while (left > 0) { const n = fs.readSync(fd, chunk, 0, Math.min(chunk.length, left), pos); if (n <= 0) throw new ApiError('The archive is damaged.'); fs.writeSync(out, chunk, 0, n); pos += n; left -= n; } }
      finally { fs.closeSync(out); }
    } finally { fs.closeSync(fd); }
  }
  // Pack a project into Archive/<name>.zip, check the zip, then take the working folder away.
  function archiveProject(dir, finals) {
    const { doc } = readDoc(dir); const files = filesIn(mediaDirOf(dir));
    let board = doc.board, keep = files;
    if (finals) { board = trimmed(board, 'takes'); const names = mediaNames(boardRefs(board)); keep = files.filter((f) => names.has(f.name)); }
    if (sum(keep) > 3.9 * 1024 * 1024 * 1024) throw new ApiError('This project is larger than 4 GB, which is more than one archive can hold. Trim its history first, or archive finals only.');
    const before = folderBytes(dir).bytes;
    fs.mkdirSync(archiveDir(), { recursive: true });
    const base = safeName(doc.name || path.basename(dir)); let zip = path.join(archiveDir(), `${base}.zip`), k = 2;
    while (fs.existsSync(zip)) zip = path.join(archiveDir(), `${base} ${k++}.zip`);
    const tmp = path.join(ROOT, '.cache', `archive-${crypto.randomBytes(6).toString('hex')}.json`); fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ ...doc, board, archivedAt: new Date().toISOString() }, null, 2));
    const entries = [{ abs: tmp, name: 'project.json' }, ...keep.map((f) => ({ abs: f.abs, name: `media/${f.name}` }))];
    try {
      writeZip(zip, entries);
      const got = new Map(zipEntries(zip).map((e) => [e.name, e.usize]));
      if (got.size !== entries.length || keep.some((f) => got.get(`media/${f.name}`) !== f.size)) throw new ApiError('The archive did not verify, so the project was left as it is.');
    } catch (e) { try { fs.unlinkSync(zip); } catch { /* nothing written */ } throw e; }
    finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
    // Remove only what the app put there; anything else the user keeps in the folder stays, and so does the folder.
    for (const f of files) { try { fs.unlinkSync(f.abs); } catch { /* ignore */ } }
    for (const junk of [path.join(mediaDirOf(dir), '.DS_Store'), docPath(dir), `${docPath(dir)}.tmp`, sidePath(dir), path.join(dir, '.DS_Store')]) { try { fs.unlinkSync(junk); } catch { /* not there */ } }
    try { fs.rmSync(path.join(dir, TRASH), { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmdirSync(mediaDirOf(dir)); } catch { /* something else lives there */ }
    try { fs.rmdirSync(dir); } catch { /* something else lives there */ }
    const cfg = readConfig(); if ((cfg.recentProjects || []).includes(dir)) { cfg.recentProjects = cfg.recentProjects.filter((d) => d !== dir); writeConfig(cfg); }
    const bytes = statOf(zip).size;
    return { file: path.basename(zip), bytes, freed: Math.max(0, before - bytes) };
  }
  function restoreArchive(file) {
    const name = path.basename(String(file || '')); const zip = path.join(archiveDir(), name);
    if (!/\.zip$/i.test(name) || !fs.existsSync(zip)) throw new ApiError('That archive is no longer in the Archive folder.');
    const entries = zipEntries(zip).filter((e) => e.name === 'project.json' || /^media\/[^/\\]+$/.test(e.name));
    if (!entries.some((e) => e.name === 'project.json')) throw new ApiError('That zip is not a Lepton project archive.');
    const base = safeName(name.replace(/\.zip$/i, '')); let dir = path.join(projectsRoot(), base), k = 2;
    while (fs.existsSync(dir)) dir = path.join(projectsRoot(), `${base} ${k++}`);
    fs.mkdirSync(mediaDirOf(dir), { recursive: true });
    try {
      for (const e of entries) extractEntry(zip, e, path.join(dir, e.name === 'project.json' ? 'project.json' : path.join('media', path.basename(e.name))));
      const { doc } = readDoc(dir); delete doc.archivedAt; rebase(doc.board, dir); writeDoc(dir, doc);
    } catch (e) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } throw e; }
    fs.unlinkSync(zip);
    return { id: encPath(dir), path: dir, name: readDoc(dir).doc.name || base };
  }

  // ---------- the whole picture ----------
  function overview() {
    const rep = uploadsReport(); const held = mediaNames(reportedRefs().refs);
    const projects = []; const batches = listTrash(UPLOADS, 'uploads', 'Temporary files');
    for (const p of listProjects().projects) {
      try { const a = analyse(p.path, held); a.external = !!p.external; projects.push(a); batches.push(...listTrash(p.path, a.id, a.name)); } catch { /* unreadable: leave it out */ }
    }
    projects.sort((a, b) => b.bytes - a.bytes); batches.sort((a, b) => b.at - a.at);
    const archives = listArchives();
    return {
      settings: settings(), root: projectsRoot(),
      uploads: { ...tally(rep.files), used: tally(rep.used), saved: tally(rep.saved), unused: tally(rep.unused) },
      projects,
      trash: { bytes: batches.reduce((a, b) => a + b.bytes, 0), count: batches.reduce((a, b) => a + b.count, 0), batches },
      archives: { bytes: archives.reduce((a, b) => a + b.bytes, 0), items: archives },
    };
  }

  // ---------- routes ----------
  const json = (fn) => async (req, res, url) => { try { send(res, 200, await fn(req.method === 'POST' ? await readJson(req) : {}, url)); } catch (e) { fail(res, e); } };
  const routes = {
    'GET /api/storage': json(() => overview()),
    'GET /api/storage/settings': json(() => settings()),
    'POST /api/storage/settings': json((b) => saveSettings(b)),
    'POST /api/storage/in-use': json((b) => { noteInUse(b.client, b.refs); scheduleTidy(); return { ok: true }; }),
    'POST /api/storage/uploads/clean': json((b) => { noteInUse(b.client, b.refs); purgeAll(); return cleanUploads({ manual: true }); }),
    'POST /api/storage/project/unused': json((b) => removeUnused(projectDir(b.id))),
    'POST /api/storage/project/trim': json((b) => trimProject(projectDir(b.id), b.mode)),
    'GET /api/storage/project/pngs': json((b, url) => ({ files: pngList(projectDir(url.searchParams.get('id'))) })),
    'POST /api/storage/project/stage': async (req, res, url) => {
      try { const dir = projectDir(url.searchParams.get('id')); send(res, 200, stageJpeg(dir, url.searchParams.get('name'), await readBody(req, 64 * 1024 * 1024))); } catch (e) { fail(res, e); }
    },
    'POST /api/storage/project/keep-png': json((b) => { keepPng(projectDir(b.id), Array.isArray(b.names) ? b.names : []); return { ok: true }; }),
    'POST /api/storage/project/convert': json((b) => commitConvert(projectDir(b.id), b.map)),
    'POST /api/storage/project/archive': json((b) => archiveProject(projectDir(b.id), !!b.finals)),
    'POST /api/storage/archive/restore': json((b) => restoreArchive(b.file)),
    'POST /api/storage/archive/reveal': json(() => { fs.mkdirSync(archiveDir(), { recursive: true }); openFolder(archiveDir()); return { ok: true }; }),
    'POST /api/storage/trash/restore': json((b) => {
      if (b.scope === 'uploads') return restoreBatch(UPLOADS, b.batch, UPLOADS, false);
      const dir = projectDir(b.scope); return restoreBatch(dir, b.batch, mediaDirOf(dir), true);
    }),
    'POST /api/storage/trash/empty': json(() => {
      const t = emptyTrash(UPLOADS); for (const dir of knownProjectDirs()) { const x = emptyTrash(dir); t.bytes += x.bytes; t.count += x.count; }
      return t;
    }),
  };

  return { routes, rebase, tidy, purgeAll, settings };
};
