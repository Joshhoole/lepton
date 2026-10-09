#!/usr/bin/env node
/*
 * Lepton — local server.
 * Serves the app and proxies to whichever AI providers the user has added keys for
 * (see providers/*.js). Zero dependencies: Node 18+ only.
 *
 *   node server.js                   → http://localhost:3141
 *   LEPTON_PORT=4000 node server.js  → custom port (falls forward to the next free port if busy)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { ROOT, UPLOADS, MIME, ApiError } = require('./providers/common.js');

const PROVIDERS = {};
for (const mod of ['higgsfield', 'google', 'openai', 'anthropic']) { const p = require(`./providers/${mod}.js`); PROVIDERS[p.id] = p; }

const PUBLIC = path.join(ROOT, 'public');
const CONFIG_PATH = path.join(ROOT, '.lepton.json');
// Earlier builds were called Strand: carry the saved keys and settings across the rename.
try { if (!fs.existsSync(CONFIG_PATH) && fs.existsSync(path.join(ROOT, '.strand.json'))) fs.renameSync(path.join(ROOT, '.strand.json'), CONFIG_PATH); } catch { /* ignore */ }
const PORT = Number(process.env.LEPTON_PORT || process.env.STRAND_PORT || 3141);

const STATIC_MIME = { ...MIME, '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// =====================================================================
// Config: one key per provider, in a local file next to the app
// =====================================================================
function readConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { /* none yet */ }
  cfg.keys ||= {};
  if (cfg.apiKey && !cfg.keys.higgsfield) { cfg.keys.higgsfield = cfg.apiKey; delete cfg.apiKey; writeConfig(cfg); }
  return cfg;
}
function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try { fs.chmodSync(CONFIG_PATH, 0o600); } catch { /* ignore */ }
}
const ENV_KEYS = { higgsfield: ['HF_KEY', 'HF_CREDENTIALS'], google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], openai: ['OPENAI_API_KEY'], anthropic: ['ANTHROPIC_API_KEY'] };
function keyFor(pid) {
  const saved = (readConfig().keys[pid] || '').trim();
  if (saved) return saved;
  for (const n of ENV_KEYS[pid] || []) if (process.env[n]) return process.env[n].trim();
  return null;
}

// =====================================================================
// Model catalogue (merged across providers, cached per key)
// =====================================================================
const cache = {}; // pid → { key, at, models, error }
async function providerModels(pid, force = false) {
  const p = PROVIDERS[pid]; const key = keyFor(pid);
  if (!key) { delete cache[pid]; return null; }
  const c = cache[pid];
  if (!force && c && c.key === key && Date.now() - c.at < 10 * 60 * 1000) { if (c.error) throw c.error; return c.models; }
  try {
    const models = await p.listModels(key);
    cache[pid] = { key, at: Date.now(), models };
    return models;
  } catch (e) {
    cache[pid] = { key, at: Date.now(), models: null, error: e };
    throw e;
  }
}
async function allModels(force = false) {
  const out = []; const errors = {};
  for (const pid of Object.keys(PROVIDERS)) {
    try { const m = await providerModels(pid, force); if (m) out.push(...m); } catch (e) { errors[pid] = e.message; }
  }
  return { models: out, errors };
}
function providerOf(modelId) {
  const pid = String(modelId || '').split(':')[0];
  const alias = { hf: 'higgsfield' }[pid] || pid;
  return PROVIDERS[alias] ? alias : null;
}
async function findModel(modelId) {
  const pid = providerOf(modelId);
  if (!pid) throw new ApiError(`Unknown provider for model "${modelId}".`, { code: 'NO_MODEL' });
  const models = await providerModels(pid);
  const m = (models || []).find((x) => x.job_type === modelId);
  if (!m) throw new ApiError(`Model not available: ${modelId}. Check the provider's key in Settings.`, { code: 'NO_MODEL' });
  return m;
}

async function providerStatus(pid) {
  const p = PROVIDERS[pid]; const key = keyFor(pid);
  const base = { id: pid, name: p.name, short: p.short, blurb: p.blurb, consoleUrl: p.consoleUrl, fields: p.fields, accepts: p.accepts, configured: !!key, fromEnv: !!key && !(readConfig().keys[pid] || '').trim() };
  if (!key) return { ...base, connected: false };
  try {
    const models = await providerModels(pid);
    const count = (t) => models.filter((m) => m.type === t).length;
    return { ...base, connected: true, keyHint: p.keyHint(key), models: models.length, counts: { image: count('image'), video: count('video'), llm: count('llm') } };
  } catch (e) { return { ...base, connected: false, keyHint: p.keyHint(key), error: e.message, code: e.code }; }
}

// =====================================================================
// Job registry: every generation / completion gets a local id immediately and runs in the background,
// so a page refresh (or even a server restart) never loses a result the provider is still producing.
// =====================================================================
const JOBS_PATH = path.join(ROOT, '.cache', 'jobs.json');
const TERMINAL = new Set(['completed', 'failed', 'nsfw', 'cancelled', 'canceled', 'error']);
let jobs = {};
try { jobs = JSON.parse(fs.readFileSync(JOBS_PATH, 'utf8')); } catch { jobs = {}; }
for (const [id, j] of Object.entries(jobs)) {
  if (Date.now() - (j.created || 0) > 7 * 24 * 3600 * 1000) delete jobs[id];
  else if (!TERMINAL.has(j.status) && !j.providerJobId) { j.status = 'failed'; j.error = 'The app was restarted while this was running.'; }
}
let jobsTimer = null;
function saveJobs() {
  clearTimeout(jobsTimer);
  jobsTimer = setTimeout(() => { try { fs.mkdirSync(path.dirname(JOBS_PATH), { recursive: true }); fs.writeFileSync(JOBS_PATH, JSON.stringify(jobs)); } catch { /* ignore */ } }, 150);
}
function newJob(kind, provider, extra = {}) {
  const j = { id: `local:${crypto.randomUUID()}`, kind, provider, status: 'queued', created: Date.now(), ...extra };
  jobs[j.id] = j; saveJobs();
  return j;
}
const publicJob = (j) => ({ id: j.id, status: j.status, result_url: j.result_url || null, extra_urls: j.extra_urls || [], error: j.error || null, text: j.text, kind: j.kind });

// Run the provider call in the background and fan its outcome into the local records.
function runGeneration(records, p, key, job_type, params, medias, n, m) {
  (async () => {
    try {
      const { jobs: out, errors } = await p.generate(key, job_type, params, medias, n, m);
      records.forEach((rec, i) => {
        const pj = out[i];
        if (!pj) { rec.status = 'failed'; rec.error = errors[i] || errors[0] || 'Nothing was created'; return; }
        if (TERMINAL.has(pj.status)) { Object.assign(rec, { status: pj.status, result_url: pj.result_url || null, extra_urls: pj.extra_urls || [], error: pj.error || null }); }
        else { rec.providerJobId = pj.id; rec.status = pj.status || 'in_progress'; }
      });
    } catch (e) {
      for (const rec of records) if (!TERMINAL.has(rec.status)) { rec.status = 'failed'; rec.error = e.message; }
    }
    saveJobs();
  })();
}
async function refreshJob(j) {
  if (TERMINAL.has(j.status) || !j.providerJobId) return j;
  const pid = j.provider; const p = PROVIDERS[pid];
  try {
    const r = await p.job(keyFor(pid), j.providerJobId);
    j.status = r.status || j.status;
    if (r.result_url) j.result_url = r.result_url;
    if (r.extra_urls) j.extra_urls = r.extra_urls;
    if (r.error) j.error = r.error;
    saveJobs();
  } catch (e) {
    j.lastError = e.message; // transient; keep polling
  }
  return j;
}

// =====================================================================
// Projects: a project is a folder holding project.json + media/ (copies of every file the board uses).
// Identified by its absolute path (base64url-encoded in URLs) so folders anywhere on disk can be opened.
// =====================================================================
const os = require('os');
const { execFile: execFileCb } = require('child_process');
const DEFAULT_PROJECTS_DIR = path.join(os.homedir(), 'Documents', 'Lepton Projects');
function projectsRoot() {
  const cfg = readConfig();
  const dir = (cfg.projectsDir || '').trim() || DEFAULT_PROJECTS_DIR;
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* reported by callers */ }
  return dir;
}
const encPath = (abs) => Buffer.from(abs, 'utf8').toString('base64url');
const decPath = (id) => { try { return path.resolve(Buffer.from(String(id), 'base64url').toString('utf8')); } catch { return null; } };
const safeName = (name) => String(name || 'Untitled project').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled project';
function readProjectMeta(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
    const b = j.board || {};
    return { id: encPath(dir), path: dir, name: j.name || path.basename(dir), savedAt: j.savedAt || null, nodes: Object.keys(b.nodes || {}).length, groups: Object.keys(b.groups || {}).length };
  } catch { return null; }
}
function listProjects() {
  const root = projectsRoot(); const out = [];
  try { for (const f of fs.readdirSync(root)) { const dir = path.join(root, f); try { if (fs.statSync(dir).isDirectory()) { const m = readProjectMeta(dir); if (m) out.push(m); } } catch { /* skip */ } } } catch { /* root unreadable */ }
  const recent = (readConfig().recentProjects || []).filter((d) => !d.startsWith(root + path.sep));
  for (const d of recent) { const m = readProjectMeta(d); if (m) out.push({ ...m, external: true }); }
  out.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  return { root, projects: out };
}
function rememberRecent(dir) {
  const cfg = readConfig();
  cfg.recentProjects = [dir, ...(cfg.recentProjects || []).filter((d) => d !== dir)].slice(0, 20);
  writeConfig(cfg);
}
// Copy every /uploads/ file and every remote result into <project>/media and rewrite the board's URLs.
async function localiseMedia(board, dir) {
  const mediaDir = path.join(dir, 'media'); fs.mkdirSync(mediaDir, { recursive: true });
  const id = encPath(dir);
  const rewrite = async (url) => {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith(`/projects/${id}/media/`)) return url;
    let src = null, name = null;
    if (url.startsWith('/uploads/')) { src = path.join(UPLOADS, path.basename(url)); name = path.basename(url); }
    else if (url.startsWith('/projects/')) { const [, , pid, , ...rest] = url.split('/'); const pdir = decPath(pid); if (pdir) { src = path.join(pdir, 'media', ...rest); name = rest.join('_'); } }
    else if (/^https?:\/\//.test(url)) {
      name = `remote-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)}${path.extname(new URL(url).pathname) || ''}`;
      const dest = path.join(mediaDir, name);
      if (!fs.existsSync(dest)) { try { const r = await fetch(url, { signal: AbortSignal.timeout(120000) }); if (!r.ok) return url; const buf = Buffer.from(await r.arrayBuffer()); const ct = (r.headers.get('content-type') || '').split(';')[0]; const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'video/mp4': '.mp4', 'audio/mpeg': '.mp3' }[ct]; if (!path.extname(name) && ext) { name += ext; } fs.writeFileSync(path.join(mediaDir, name), buf); } catch { return url; } }
      return `/projects/${id}/media/${name}`;
    }
    if (!src) return url;
    const dest = path.join(mediaDir, name);
    try { if (!fs.existsSync(dest) && fs.existsSync(src)) fs.copyFileSync(src, dest); } catch { return url; }
    return fs.existsSync(dest) ? `/projects/${id}/media/${name}` : url;
  };
  for (const n of Object.values(board.nodes || {})) {
    const d = n.data || {};
    if (d.url) d.url = await rewrite(d.url);
    if (Array.isArray(d.results)) for (const r of d.results) { if (r.url) r.url = await rewrite(r.url); if (r.thumb) r.thumb = await rewrite(r.thumb); }
    if (Array.isArray(d.history)) for (const run of d.history) for (const r of run.results || []) { if (r.url) r.url = await rewrite(r.url); if (r.thumb) r.thumb = await rewrite(r.thumb); }
  }
  return board;
}
async function saveProject(dir, name, board) {
  fs.mkdirSync(dir, { recursive: true });
  const localised = await localiseMedia(board, dir);
  const doc = { app: 'lepton', version: 1, name, savedAt: new Date().toISOString(), board: localised };
  const tmp = path.join(dir, 'project.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2)); fs.renameSync(tmp, path.join(dir, 'project.json'));
  rememberRecent(dir);
  return { ...readProjectMeta(dir), board: localised };
}
function serveProjectMedia(req, res, urlPath) {
  const [, , pid, mediaSeg, ...rest] = urlPath.split('/');
  const dir = decPath(pid);
  if (!dir || mediaSeg !== 'media' || !rest.length) return send(res, 404, { error: 'Not found' });
  const mediaDir = path.join(dir, 'media');
  const abs = path.normalize(path.join(mediaDir, decodeURIComponent(rest.join('/'))));
  if (!abs.startsWith(mediaDir + path.sep)) return send(res, 403, { error: 'Forbidden' });
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'Not found' });
    const type = STATIC_MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'public, max-age=31536000', 'Accept-Ranges': 'bytes' });
    fs.createReadStream(abs).pipe(res);
  });
}


// =====================================================================
// Skills: folders of knowledge (SKILL.md + reference files) that LLM nodes draw on. Stored outside the app so they
// survive updates and are shared by every project. Standard skill layout, so skills made for other tools install as-is.
// =====================================================================
const zlib = require('zlib');
const DEFAULT_SKILLS_DIR = path.join(os.homedir(), 'Documents', 'Lepton Skills');
const SKILL_TEXT = new Set(['.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.csv', '.xml', '.html', '.rst', '.toml']);
const SKILL_MAX_FILE = 2 * 1024 * 1024; // per text file
const SKILLS_MAX_PROMPT = 600000;          // characters sent to a model in one request
function skillsRoot() {
  const cfg = readConfig();
  const dir = (cfg.skillsDir || '').trim() || DEFAULT_SKILLS_DIR;
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* reported by callers */ }
  return dir;
}
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'skill';
// name: value lines between --- fences at the top of SKILL.md.
function parseFrontMatter(raw) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { meta: {}, body: raw.trim() };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0 && /^[\w-]+$/.test(line.slice(0, i).trim())) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, ''); }
  return { meta, body: m[2].trim() };
}
const frontMatter = (meta, body) => `---\n${Object.entries(meta).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}: ${String(v).replace(/\n/g, ' ')}`).join('\n')}\n---\n\n${body.trim()}\n`;
const skillDir = (id) => { const safe = slugify(id); const dir = path.join(skillsRoot(), safe); if (!safe || path.dirname(dir) !== skillsRoot()) throw new ApiError('Bad skill id.'); return dir; };
function listSkillFiles(dir) {
  const out = [];
  const walk = (d, rel) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (f.name.startsWith('.')) continue; const r = rel ? `${rel}/${f.name}` : f.name; if (f.isDirectory()) walk(path.join(d, f.name), r); else out.push({ path: r, bytes: fs.statSync(path.join(d, f.name)).size, text: SKILL_TEXT.has(path.extname(f.name).toLowerCase()) }); } };
  walk(dir, '');
  return out.sort((a, b) => (a.path === 'SKILL.md' ? -1 : b.path === 'SKILL.md' ? 1 : a.path.localeCompare(b.path)));
}
function readSkill(id) {
  const dir = skillDir(id);
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) return null;
  const { meta, body } = parseFrontMatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
  const files = listSkillFiles(dir);
  const chars = files.filter((f) => f.text).reduce((n, f) => n + Math.min(f.bytes, SKILL_MAX_FILE), 0);
  return { id: path.basename(dir), name: meta.name || path.basename(dir), description: meta.description || '', version: meta.version || '', meta, body, files, chars, updatedAt: fs.statSync(path.join(dir, 'SKILL.md')).mtimeMs };
}
function listSkills() {
  const root = skillsRoot(); const out = [];
  for (const f of fs.readdirSync(root, { withFileTypes: true })) { if (!f.isDirectory() || f.name.startsWith('.')) continue; try { const s = readSkill(f.name); if (s) { delete s.body; out.push(s); } } catch { /* skip broken folder */ } }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { root, skills: out };
}
// Everything the model gets for one skill: SKILL.md first, then each reference file under its own heading.
function skillText(id) {
  const s = readSkill(id); if (!s) throw new ApiError(`The skill "${id}" is not installed on this computer. Install it from the Skills sidebar.`, { code: 'NO_SKILL' });
  const dir = skillDir(id); const parts = [];
  parts.push(`=== SKILL: ${s.name} ===${s.description ? `\n${s.description}` : ''}\n\n${s.body}`);
  for (const f of s.files) {
    if (f.path === 'SKILL.md' || !f.text) continue;
    let txt = fs.readFileSync(path.join(dir, f.path), 'utf8');
    if (txt.length > SKILL_MAX_FILE) txt = `${txt.slice(0, SKILL_MAX_FILE)}\n[truncated]`;
    parts.push(`--- ${s.name} / ${f.path} ---\n${txt.trim()}`);
  }
  parts.push(`=== END SKILL: ${s.name} ===`);
  return parts.join('\n\n');
}
function skillsPrompt(ids) {
  const texts = ids.map(skillText);
  const total = texts.reduce((n, t) => n + t.length, 0);
  if (total > SKILLS_MAX_PROMPT) throw new ApiError(`The connected skills come to ${Math.round(total / 1000)}k characters, more than one request can carry (${Math.round(SKILLS_MAX_PROMPT / 1000)}k). Disconnect a skill or trim its files.`);
  return `SKILLS\nThe following skills are installed for this task. Treat their instructions as part of your instructions and draw on their knowledge and examples when you answer.\n\n${texts.join('\n\n')}`;
}
// Write a set of files into a skill folder. New installs replace SKILL.md and incoming files; files added locally are kept.
function installSkillFiles(files, { replace = true } = {}) {
  const md = files.find((f) => /(^|\/)SKILL\.md$/i.test(f.path)) || (files.length === 1 && /\.(md|markdown|txt)$/i.test(files[0].path) ? files[0] : null);
  if (!md) throw new ApiError('No SKILL.md found. A skill is a folder with SKILL.md at the top, or a single .md file.');
  const base = md.path.toLowerCase().endsWith('skill.md') ? md.path.slice(0, -'SKILL.md'.length) : '';
  const raw = md.text.toString('utf8');
  let { meta, body } = parseFrontMatter(raw);
  if (!meta.name) { const h = /^#\s+(.+)$/m.exec(body); meta.name = h ? h[1].trim() : path.basename(md.path).replace(/\.(md|markdown|txt)$/i, '').replace(/[-_]+/g, ' '); }
  const id = slugify(meta.name);
  const dir = skillDir(id); const existed = fs.existsSync(path.join(dir, 'SKILL.md'));
  if (existed && !replace) throw new ApiError(`"${meta.name}" is already installed.`, { code: 'EXISTS' });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), frontMatter(meta, body));
  let written = 1, skipped = [];
  for (const f of files) {
    if (f === md) continue;
    let rel = base && f.path.startsWith(base) ? f.path.slice(base.length) : f.path;
    rel = rel.split('/').filter((p) => p && p !== '.' && p !== '..' && !p.startsWith('.')).join('/');
    if (!rel) continue;
    if (!SKILL_TEXT.has(path.extname(rel).toLowerCase())) { skipped.push(rel); continue; }
    if (f.text.length > SKILL_MAX_FILE) { skipped.push(`${rel} (over 2 MB)`); continue; }
    const abs = path.join(dir, rel); if (!abs.startsWith(dir + path.sep)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, f.text); written++;
  }
  return { skill: readSkill(id), updated: existed, written, skipped };
}
// Minimal zip reader (stored and deflated entries) so skills can be installed from a .zip without any dependency.
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new ApiError('That file is not a zip archive.');
  const count = buf.readUInt16LE(eocd + 10); let off = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10), csize = buf.readUInt32LE(off + 20), nlen = buf.readUInt16LE(off + 28), xlen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32), lho = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nlen).toString('utf8');
    off += 46 + nlen + xlen + clen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || /(^|\/)\./.test(name)) continue;
    const lnlen = buf.readUInt16LE(lho + 26), lxlen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lxlen; const data = buf.slice(start, start + csize);
    out.push({ path: name, text: method === 8 ? zlib.inflateRawSync(data) : method === 0 ? data : Buffer.alloc(0) });
  }
  return out;
}

// =====================================================================
// Multi-download: bundle files into a .zip. Media is already compressed, so entries are stored, not deflated.
// =====================================================================
const ZIP_DIR = path.join(ROOT, '.cache', 'zips');
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function writeZip(dest, entries) {
  const fd = fs.openSync(dest, 'w'); let offset = 0; const central = [];
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  try {
    for (const e of entries) {
      const data = fs.readFileSync(e.abs); const name = Buffer.from(e.name, 'utf8'); const crc = crc32(data);
      if (data.length > 0xfffffffe || offset > 0xfffffffe) throw new ApiError('This selection is larger than 4 GB; download it in smaller batches.');
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
      lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14);
      lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
      fs.writeSync(fd, lh); fs.writeSync(fd, name); fs.writeSync(fd, data);
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
      ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16);
      ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
      ch.writeUInt32LE(0, 30); ch.writeUInt32LE(0, 34); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
      central.push(Buffer.concat([ch, name]));
      offset += 30 + name.length + data.length;
    }
    const cd = Buffer.concat(central);
    fs.writeSync(fd, cd);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    fs.writeSync(fd, end);
  } finally { fs.closeSync(fd); }
}
// A project media URL (/projects/<id>/media/<file>) as a file on disk, or null. Never resolves outside the media folder.
function projectMediaFile(u) {
  const [, , pid, seg, ...rest] = String(u).split('?')[0].split('/'); const dir = decPath(pid);
  if (!dir || seg !== 'media' || !rest.length) return null;
  const mediaDir = path.join(dir, 'media'); const abs = path.normalize(path.join(mediaDir, decodeURIComponent(rest.join('/'))));
  return abs.startsWith(mediaDir + path.sep) && fs.existsSync(abs) ? abs : null;
}
// Providers read their inputs through localFile, so media saved into a project works exactly like a fresh upload.
require('./providers/common.js').setProjectMediaResolver(projectMediaFile);
// Turn a board URL into a file on disk: uploads, project media, or a remote result (fetched once).
async function resolveToFile(url) {
  const u = String(url || '');
  const { localFile } = require('./providers/common.js');
  return (await localFile({ ref: u, url: /^https?:/.test(u) ? u : null })).abs;
}
function cleanZips() {
  try { for (const f of fs.readdirSync(ZIP_DIR)) { const abs = path.join(ZIP_DIR, f); if (Date.now() - fs.statSync(abs).mtimeMs > 3600 * 1000) fs.unlinkSync(abs); } } catch { /* none yet */ }
}

// =====================================================================
// HTTP helpers
// =====================================================================
function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}
function fail(res, e) {
  const code = e.code || 'ERROR';
  const map = { API_AUTH: 401, NO_API_KEY: 401, BAD_KEY: 400, API_CREDITS: 402, NO_MODEL: 404, RATE_LIMIT: 429 };
  send(res, map[code] || (e.status >= 400 && e.status < 600 ? e.status : 500), { error: e.message || String(e), code });
}
function readBody(req, limit = 512 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) { const buf = await readBody(req, 8 * 1024 * 1024); return buf.length ? JSON.parse(buf.toString('utf8')) : {}; }

function serveStatic(req, res, urlPath) {
  let file = urlPath === '/' ? '/index.html' : urlPath;
  let base = PUBLIC;
  if (file.startsWith('/uploads/')) base = ROOT;
  const abs = path.normalize(path.join(base, decodeURIComponent(file)));
  if (!abs.startsWith(base) || path.basename(abs).startsWith('.')) return send(res, 403, { error: 'Forbidden' });
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'Not found' });
    const type = STATIC_MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range && /^video|^audio/.test(type)) {
      const [s, e] = range.replace('bytes=', '').split('-');
      const start = Number(s) || 0; const end = e ? Number(e) : st.size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      return fs.createReadStream(abs, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': base === ROOT ? 'public, max-age=31536000' : 'no-cache', 'Accept-Ranges': 'bytes' });
    fs.createReadStream(abs).pipe(res);
  });
}

// =====================================================================
// Routes
// =====================================================================
const routes = {
  'GET /api/status': async (req, res) => {
    const providers = await Promise.all(Object.keys(PROVIDERS).map(providerStatus));
    const models = providers.reduce((n, p) => n + (p.models || 0), 0);
    send(res, 200, { providers, connected: providers.some((p) => p.connected), models });
  },

  'POST /api/providers/key': async (req, res) => {
    try {
      const { provider, fields = {} } = await readJson(req);
      const p = PROVIDERS[provider];
      if (!p) return send(res, 400, { error: 'Unknown provider', code: 'BAD_PROVIDER' });
      const key = p.parseKey(fields);
      if (!key) throw new ApiError('Paste the key first.', { code: 'BAD_KEY' });
      const check = await p.verify(key);
      if (!check.ok) return send(res, 401, { error: `${p.name} rejected this key: ${check.error}`, code: 'API_AUTH' });
      const cfg = readConfig(); cfg.keys[provider] = key; writeConfig(cfg);
      delete cache[provider];
      send(res, 200, await providerStatus(provider));
    } catch (e) { fail(res, e); }
  },
  'DELETE /api/providers/key': async (req, res) => {
    try {
      const { provider } = await readJson(req);
      const cfg = readConfig(); delete cfg.keys[provider]; writeConfig(cfg); delete cache[provider];
      send(res, 200, { ok: true });
    } catch (e) { fail(res, e); }
  },

  'GET /api/models': async (req, res, url) => {
    const { models, errors } = await allModels(url.searchParams.get('refresh') === '1');
    if (!models.length && !Object.keys(errors).length) return send(res, 401, { error: 'No provider connected. Add an API key in Settings.', code: 'NO_API_KEY' });
    send(res, 200, { models: models.map(({ job_type, display_name, type, description, credits, provider }) => ({ job_type, display_name, type, description, credits, provider })), errors });
  },

  'GET /api/schema': async (req, res, url) => {
    try {
      const m = await findModel(url.searchParams.get('model'));
      const p = PROVIDERS[m.provider];
      send(res, 200, p.schema ? await p.schema(keyFor(m.provider), m) : m);
    } catch (e) { fail(res, e); }
  },

  'POST /api/generate': async (req, res) => {
    try {
      const { job_type, params = {}, medias = [], count = 1 } = await readJson(req);
      const m = await findModel(job_type);
      const p = PROVIDERS[m.provider];
      const n = Math.max(1, Math.min(4, Number(count) || 1));
      const records = Array.from({ length: n }, () => newJob('generate', m.provider, { model: job_type }));
      runGeneration(records, p, keyFor(m.provider), job_type, params, medias, n, m);
      send(res, 200, { jobs: records.map(publicJob), errors: [] });
    } catch (e) { fail(res, e); }
  },

  'GET /api/job': async (req, res, url) => {
    const id = url.searchParams.get('id') || '';
    try {
      if (id.startsWith('local:')) {
        const j = jobs[id];
        if (!j) return send(res, 404, { error: 'Unknown job. It may have been cleared after seven days.', code: 'NO_JOB' });
        return send(res, 200, publicJob(await refreshJob(j)));
      }
      const pid = providerOf(id); // jobs created before the registry existed
      if (!pid) return send(res, 400, { error: 'Unknown job id' });
      send(res, 200, await PROVIDERS[pid].job(keyFor(pid), id));
    } catch (e) { fail(res, e); }
  },

  'POST /api/complete': async (req, res) => {
    try {
      const { job_type, system: userSystem = '', instructions = '', prompt = '', medias = [], params = {}, skills = [] } = await readJson(req);
      const m = await findModel(job_type);
      const p = PROVIDERS[m.provider];
      if (!p.complete) throw new ApiError(`${p.name} has no text models.`);
      const system = [userSystem, skills.length ? skillsPrompt(skills.map(String)) : ''].filter(Boolean).join('\n\n');
      const rec = newJob('complete', m.provider, { model: job_type, status: 'in_progress' });
      (async () => {
        try { const r = await p.complete(keyFor(m.provider), job_type, { system, instructions, prompt, medias, params }); rec.text = r.text; rec.status = 'completed'; }
        catch (e) { rec.status = 'failed'; rec.error = e.message; }
        saveJobs();
      })();
      send(res, 200, { jobId: rec.id });
    } catch (e) { fail(res, e); }
  },

  'GET /api/skills': async (req, res) => { try { send(res, 200, listSkills()); } catch (e) { fail(res, e); } },
  'GET /api/skills/read': async (req, res, url) => {
    try { const id = url.searchParams.get('id') || ''; const s = readSkill(id); if (!s) throw new ApiError('Skill not found.', { code: 'NO_SKILL' }); send(res, 200, { ...s, prompt: skillText(id) }); } catch (e) { fail(res, e); }
  },
  // Install from a list of text files (a picked folder, a single .md, or an in-app editor).
  'POST /api/skills/install': async (req, res) => {
    try {
      const { files = [], replace = true } = await readJson(req);
      const list = files.filter((f) => f && typeof f.path === 'string' && typeof f.text === 'string').map((f) => ({ path: f.path.replace(/\\/g, '/'), text: Buffer.from(f.text, 'utf8') }));
      send(res, 200, installSkillFiles(list, { replace }));
    } catch (e) { fail(res, e); }
  },
  // Install from a .zip (raw body).
  'POST /api/skills/install-zip': async (req, res, url) => {
    try {
      const replace = url.searchParams.get('replace') !== '0';
      const buf = await readBody(req, 64 * 1024 * 1024);
      send(res, 200, installSkillFiles(readZip(buf), { replace }));
    } catch (e) { fail(res, e); }
  },
  // Edit the skill's own text; reference files are left alone.
  'POST /api/skills/update': async (req, res) => {
    try {
      const { id, name, description, body } = await readJson(req);
      const s = readSkill(id); if (!s) throw new ApiError('Skill not found.', { code: 'NO_SKILL' });
      const meta = { ...s.meta, name: String(name || s.name).trim() || s.name, description: String(description ?? s.description).trim() };
      fs.writeFileSync(path.join(skillDir(id), 'SKILL.md'), frontMatter(meta, String(body ?? s.body)));
      send(res, 200, readSkill(id));
    } catch (e) { fail(res, e); }
  },
  // Add (or replace) one reference file.
  'POST /api/skills/file': async (req, res) => {
    try {
      const { id, path: rel, text, remove = false } = await readJson(req);
      const s = readSkill(id); if (!s) throw new ApiError('Skill not found.', { code: 'NO_SKILL' });
      const dir = skillDir(id);
      const clean = String(rel || '').replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..' && !p.startsWith('.')).join('/');
      if (!clean || clean.toLowerCase() === 'skill.md') throw new ApiError('Give the file a name (SKILL.md is edited with Save).');
      const abs = path.join(dir, clean); if (!abs.startsWith(dir + path.sep)) throw new ApiError('Bad file name.');
      if (remove) { if (fs.existsSync(abs)) fs.unlinkSync(abs); }
      else {
        if (!SKILL_TEXT.has(path.extname(clean).toLowerCase())) throw new ApiError('Reference files must be text: .md, .txt, .json, .yaml, .csv, .xml, .html.');
        if (String(text).length > SKILL_MAX_FILE) throw new ApiError('That file is over 2 MB. Split it or trim it.');
        fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, String(text));
      }
      send(res, 200, readSkill(id));
    } catch (e) { fail(res, e); }
  },
  'POST /api/skills/remove': async (req, res) => {
    try { const { id } = await readJson(req); const dir = skillDir(id); if (!fs.existsSync(path.join(dir, 'SKILL.md'))) throw new ApiError('Skill not found.'); fs.rmSync(dir, { recursive: true, force: true }); send(res, 200, listSkills()); } catch (e) { fail(res, e); }
  },
  'POST /api/skills/root': async (req, res) => {
    try {
      const { dir } = await readJson(req);
      const abs = path.resolve(String(dir || '').replace(/^~(?=$|\/)/, os.homedir()));
      fs.mkdirSync(abs, { recursive: true });
      const cfg = readConfig(); cfg.skillsDir = abs; writeConfig(cfg);
      send(res, 200, listSkills());
    } catch (e) { fail(res, e); }
  },
  'POST /api/skills/reveal': async (req, res) => {
    try {
      const { id } = await readJson(req); const dir = id ? skillDir(id) : skillsRoot();
      const cmd = process.platform === 'darwin' ? ['open', [dir]] : process.platform === 'win32' ? ['explorer', [dir]] : ['xdg-open', [dir]];
      execFileCb(cmd[0], cmd[1], () => {});
      send(res, 200, { ok: true, dir });
    } catch (e) { fail(res, e); }
  },

  'GET /api/projects': async (req, res) => { try { send(res, 200, listProjects()); } catch (e) { fail(res, e); } },
  'POST /api/projects/root': async (req, res) => {
    try {
      const { dir } = await readJson(req);
      const abs = path.resolve(String(dir || '').replace(/^~(?=$|\/)/, os.homedir()));
      fs.mkdirSync(abs, { recursive: true });
      const cfg = readConfig(); cfg.projectsDir = abs; writeConfig(cfg);
      send(res, 200, listProjects());
    } catch (e) { fail(res, e); }
  },
  'POST /api/projects/save': async (req, res) => {
    // { id?, path?, name, board }  → existing project (id/path) or a new folder under the root
    try {
      const { id, path: p, name, board } = await readJson(req);
      if (!board || typeof board !== 'object') throw new ApiError('No board to save.', { code: 'BAD_REQUEST' });
      let dir = id ? decPath(id) : p ? path.resolve(String(p).replace(/^~(?=$|\/)/, os.homedir())) : null;
      if (!dir) {
        const base = safeName(name); dir = path.join(projectsRoot(), base);
        let k = 2; while (fs.existsSync(dir)) dir = path.join(projectsRoot(), `${base} ${k++}`);
      }
      send(res, 200, await saveProject(dir, safeName(name), board));
    } catch (e) { fail(res, e); }
  },
  'GET /api/projects/open': async (req, res, url) => {
    try {
      const id = url.searchParams.get('id'); const p = url.searchParams.get('path');
      const dir = id ? decPath(id) : path.resolve(String(p || '').replace(/^~(?=$|\/)/, os.homedir()));
      const file = path.join(dir, 'project.json');
      if (!fs.existsSync(file)) throw new ApiError(`No project.json in ${dir}`, { code: 'NO_PROJECT' });
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      rememberRecent(dir);
      send(res, 200, { ...readProjectMeta(dir), board: doc.board || {} });
    } catch (e) { fail(res, e); }
  },
  'POST /api/projects/rename': async (req, res) => {
    try {
      const { id, name } = await readJson(req);
      const dir = decPath(id); const file = path.join(dir, 'project.json');
      const doc = JSON.parse(fs.readFileSync(file, 'utf8')); doc.name = safeName(name);
      fs.writeFileSync(file, JSON.stringify(doc, null, 2));
      send(res, 200, readProjectMeta(dir));
    } catch (e) { fail(res, e); }
  },
  'POST /api/projects/forget': async (req, res) => {
    // Remove from the recent list only; never deletes files.
    try { const { id } = await readJson(req); const dir = decPath(id); const cfg = readConfig(); cfg.recentProjects = (cfg.recentProjects || []).filter((d) => d !== dir); writeConfig(cfg); send(res, 200, listProjects()); } catch (e) { fail(res, e); }
  },
  'POST /api/projects/reveal': async (req, res) => {
    try {
      const { id } = await readJson(req); const dir = id ? decPath(id) : projectsRoot();
      const cmd = process.platform === 'darwin' ? ['open', [dir]] : process.platform === 'win32' ? ['explorer', [dir]] : ['xdg-open', [dir]];
      execFileCb(cmd[0], cmd[1], () => {});
      send(res, 200, { ok: true, dir });
    } catch (e) { fail(res, e); }
  },

  'POST /api/zip': async (req, res) => {
    try {
      const { files = [], name = 'lepton' } = await readJson(req);
      if (!files.length) throw new ApiError('Nothing to download.', { code: 'BAD_REQUEST' });
      fs.mkdirSync(ZIP_DIR, { recursive: true }); cleanZips();
      const entries = []; const used = new Set(); const skipped = [];
      for (const f of files) {
        try {
          const abs = await resolveToFile(f.url);
          let base = String(f.name || path.basename(abs)).replace(/[\\/:*?"<>|]+/g, '-').trim() || path.basename(abs);
          if (!path.extname(base)) base += path.extname(abs);
          let n = base, k = 2; while (used.has(n.toLowerCase())) n = `${path.basename(base, path.extname(base))} (${k++})${path.extname(base)}`;
          used.add(n.toLowerCase()); entries.push({ abs, name: n });
        } catch (e) { skipped.push(`${f.name || f.url}: ${e.message}`); }
      }
      if (!entries.length) throw new ApiError(skipped[0] || 'None of the files could be read.');
      const id = crypto.randomBytes(8).toString('hex');
      writeZip(path.join(ZIP_DIR, `${id}.zip`), entries);
      const safe = String(name).replace(/[^\w .\-]+/g, '_').slice(0, 80) || 'lepton';
      send(res, 200, { url: `/api/zip/get?id=${id}&name=${encodeURIComponent(safe)}`, count: entries.length, skipped, bytes: fs.statSync(path.join(ZIP_DIR, `${id}.zip`)).size });
    } catch (e) { fail(res, e); }
  },
  'GET /api/zip/get': async (req, res, url) => {
    const id = (url.searchParams.get('id') || '').replace(/[^0-9a-f]/g, ''); const abs = path.join(ZIP_DIR, `${id}.zip`);
    if (!id || !fs.existsSync(abs)) return send(res, 404, { error: 'This download has expired. Start it again.' });
    const name = (url.searchParams.get('name') || 'lepton').replace(/"/g, '');
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': fs.statSync(abs).size, 'Content-Disposition': `attachment; filename="${name}.zip"` });
    fs.createReadStream(abs).pipe(res);
  },

  'POST /api/upload': async (req, res, url) => {
    try {
      const name = (url.searchParams.get('name') || 'file').replace(/[^\w.\-]+/g, '_');
      const ext = path.extname(name).toLowerCase() || '';
      const fname = `${crypto.randomBytes(6).toString('hex')}-${name}`;
      const buf = await readBody(req);
      fs.writeFileSync(path.join(UPLOADS, fname), buf);
      const kind = /^(\.mp4|\.mov|\.webm)$/.test(ext) ? 'video' : /^(\.mp3|\.wav|\.m4a|\.ogg|\.aac|\.flac)$/.test(ext) ? 'audio' : 'image';
      send(res, 200, { url: `/uploads/${fname}`, name, kind, size: buf.length });
    } catch (e) { fail(res, e); }
  },

  'GET /api/fetch': async (req, res, url) => {
    try {
      const remote = url.searchParams.get('url');
      const u = new URL(remote);
      if (u.protocol !== 'https:') throw new Error('Only https URLs');
      https.get(remote, (r) => {
        const headers = { 'Content-Type': r.headers['content-type'] || 'application/octet-stream' };
        if (r.headers['content-length']) headers['Content-Length'] = r.headers['content-length'];
        const dl = url.searchParams.get('download');
        if (dl) headers['Content-Disposition'] = `attachment; filename="${dl.replace(/"/g, '')}"`;
        res.writeHead(r.statusCode || 200, headers);
        r.pipe(res);
      }).on('error', (e) => fail(res, e));
    } catch (e) { fail(res, e); }
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const key = `${req.method} ${url.pathname}`;
  if (routes[key]) { try { await routes[key](req, res, url); } catch (e) { fail(res, e); } return; }
  if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Unknown endpoint' });
  if (url.pathname.startsWith('/projects/')) return serveProjectMedia(req, res, url.pathname);
  serveStatic(req, res, url.pathname);
});

function listen(port, attempt = 0) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && attempt < 10) { console.log(`  Port ${port} is in use, trying ${port + 1}…`); listen(port + 1, attempt + 1); }
    else { console.error(`  Could not start: ${e.message}`); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n  ℓ Lepton is running → http://localhost:${port}\n`);
    if (port !== PORT) console.log(`  (port ${PORT} was busy)`);
    for (const pid of Object.keys(PROVIDERS)) console.log(`  ${PROVIDERS[pid].name.padEnd(14)} ${keyFor(pid) ? 'key set' : 'no key (add it in Settings)'}`);
  });
}
listen(PORT);
