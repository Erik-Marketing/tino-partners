// Standalone server for running Tino Partners on our own VPS (Docker),
// instead of Vercel. Serves the same static pages and re-implements the
// same /api/* contract as the Vercel functions in api/*.js — but storage
// moves from Vercel Blob to plain files under DATA_DIR, since there's no
// serverless-function boundary here to force an external store. Keeping
// the same request/response shape as the Vercel handlers means the
// front-end (fetch calls in the HTML pages, admin.html) needed zero changes.
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs/promises');
const { spawn } = require('child_process');
const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  DEFAULT_CONTENT, normalizeArticles, normalizeCasos, validateSlugs, SLUG_PAGE_FILES,
} = require('./content-defaults');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const CONSULTAS_DIR = path.join(DATA_DIR, 'consultas');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const LIKES_FILE = path.join(DATA_DIR, 'likes.json');
const COOKIE_NAME = 'tp_admin';
const PORT = process.env.PORT || 3000;

// Crash-only-that-request instead of crash-the-whole-process: log and keep
// serving other requests. Docker's "restart: unless-stopped" is the real
// safety net if something manages to bring the process down anyway.
process.on('unhandledRejection', (err) => console.error('unhandledRejection', err));
process.on('uncaughtException', (err) => console.error('uncaughtException', err));

const UPLOADS_DIR = path.join(MEDIA_DIR, 'uploads');

async function ensureDirs() {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await fs.mkdir(CONSULTAS_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

// covers leftovers from a request that crashed/restarted/timed-out mid-way —
// the "commit" step for a compressed video is a same-directory fs.rename, so
// a stray .tmp- file here always means something didn't finish cleanly.
async function sweepStaleTempFiles() {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  try {
    const files = await fs.readdir(UPLOADS_DIR);
    await Promise.all(files.filter((f) => f.startsWith('.tmp-')).map(async (f) => {
      try {
        const full = path.join(UPLOADS_DIR, f);
        const stat = await fs.stat(full);
        if (Date.now() - stat.mtimeMs > ONE_DAY_MS) await fs.unlink(full);
      } catch (err) { /* already gone, or a race with a live upload — ignore */ }
    }));
  } catch (err) { /* UPLOADS_DIR not created yet on a very first boot — ignore */ }
}

// Blog likes live in their own small file, never in content.json — a like
// click is a single-visitor, no-login action that can happen dozens of
// times a minute, and content.json is only ever meant to be rewritten
// whole by the admin's "Guardar cambios" flow (see POST /api/content).
// Mixing the two would mean a stale admin tab saving unrelated content
// could silently revert real like counts back to whatever they were when
// that tab last loaded — a bug class this project has already hit once
// with content.json itself.
async function readLikes() {
  try {
    const text = await fs.readFile(LIKES_FILE, 'utf8');
    const parsed = JSON.parse(text);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch (err) {
    return {};
  }
}
// Single Node process, no clustering — a read-modify-write against one
// shared file still needs its own writes serialized, or two likes arriving
// in the same tick could both read the same count and one increment would
// be silently lost. `mutate` receives the current map, mutates it in
// place, and returns whatever value the caller wants back.
let likesWriteQueue = Promise.resolve();
function queueLikesWrite(mutate) {
  const result = likesWriteQueue.then(async () => {
    const likes = await readLikes();
    const value = mutate(likes);
    await fs.writeFile(LIKES_FILE, JSON.stringify(likes));
    return value;
  });
  // the queue itself must never stay rejected, or every write after a
  // single failed one would be skipped forever — the caller still gets
  // the real error via `result`.
  likesWriteQueue = result.catch(() => {});
  return result;
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

// Constant-time compare so a wrong guess can't be timed byte-by-byte.
// Buffers of different lengths are just "not equal", never passed into
// timingSafeEqual (which throws on a length mismatch).
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a == null ? '' : a), 'utf8');
  const bufB = Buffer.from(String(b == null ? '' : b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isAuthorized(req) {
  const sessionToken = readCookie(req, COOKIE_NAME);
  return Boolean(process.env.ADMIN_TOKEN) && safeEqual(sessionToken, process.env.ADMIN_TOKEN);
}

// as real middleware (not an inline check inside the handler) so it can run
// BEFORE the body parser on routes with a large size limit — otherwise an
// unauthenticated caller could force parsing of a huge body before ever
// being told "no".
function requireAdmin(req, res, next) {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'No autorizado' });
  next();
}

// Caddy is the only thing that can reach this process, so its
// X-Forwarded-For is trustworthy for one hop. Once Cloudflare is in front,
// prefer its CF-Connecting-IP — but only after checking it looks like an
// actual IP, since we never trust a header's content for a security
// decision without validating its shape first.
const IP_RE = /^[0-9a-fA-F:.]+$/;
function getClientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && IP_RE.test(cf.trim())) return cf.trim();
  return req.ip;
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
// no global body parser — applied per route below, so a big limit for
// uploads doesn't also apply to every other route (see requireAdmin above).
const jsonBody = express.json({ limit: '20mb' });

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  message: { error: 'Demasiados intentos, probá de nuevo en un rato.' },
});

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  message: { error: 'Demasiados envíos, probá de nuevo en un rato.' },
});

// ---------- static pages (explicit allowlist — never serve server.js,
// package.json, .env, etc. even though they live in the same folder) ----------
const PAGES = [
  'index.html', 'nosotros.html', 'portfolio.html', 'nobrand.html',
  'blog.html', 'blog-post.html', 'terminos.html', 'privacidad.html', 'admin.html',
  'caso.html',
];
// bare "/" redirects to the custom home slug too, once one is set — so
// there's exactly one working address for home, not two. Only serves
// index.html directly here when no custom slug has been chosen yet.
app.get('/', async (req, res) => {
  const content = await loadMergedContent();
  const homeSlug = (content.slugs || {}).home;
  if (homeSlug) return res.redirect(301, '/' + homeSlug);
  return res.sendFile(path.join(ROOT, 'index.html'));
});

// pages whose .html path is also reachable through a custom slug (see
// SLUG_PAGE_FILES/content-defaults.js) redirect to whatever that slug
// currently is — so the address bar never shows "/nosotros.html", always
// "/nosotros" (or Erik's custom word), even when nothing's been changed
// from the default. Everything else is served directly, as before.
const SLUGGED_FILES = new Set(Object.values(SLUG_PAGE_FILES));
PAGES.filter((page) => !SLUGGED_FILES.has(page)).forEach((page) => {
  app.get('/' + page, (req, res) => res.sendFile(path.join(ROOT, page)));
});

// admin.html gets no redirect route at all (see the comment on
// SLUG_PAGE_FILES) — a direct request for it just falls through to the
// normal 404, same as any other made-up path.
Object.keys(SLUG_PAGE_FILES).filter((key) => key !== 'admin').forEach((key) => {
  const file = SLUG_PAGE_FILES[key];
  app.get('/' + file, async (req, res) => {
    const content = await loadMergedContent();
    const current = (content.slugs || {})[key];
    const target = key === 'home' ? (current ? '/' + current : '/') : '/' + (current || key);
    const qs = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
    return res.redirect(301, target + qs);
  });
});

// uploaded media, served same-origin so content.json can reference plain
// relative URLs like /media/proyectos/xyz.mp4
app.use('/media', express.static(MEDIA_DIR, { maxAge: '30d' }));

// ---------- /api/content ----------
// shared by the API route and the custom-slug page route below, so both
// always see the same DEFAULT_CONTENT-merged, self-healed view of the data.
async function loadMergedContent() {
  // `saved` stays {} (not caught-and-returned-early) when content.json
  // doesn't exist yet or is corrupt, so the rest of this function — likes
  // included — always runs the same way instead of a fresh install seeing
  // real like counts vanish until the first save. It also means this never
  // hands back the literal DEFAULT_CONTENT object itself, which nothing
  // mutates today but would otherwise be one shared, permanently-mutable
  // singleton if something ever did.
  let saved = {};
  try {
    saved = JSON.parse(await fs.readFile(CONTENT_FILE, 'utf8'));
  } catch (err) {
    saved = {};
  }
  const merged = Object.assign({}, DEFAULT_CONTENT, saved);
  const likes = await readLikes();
  merged.blog = Object.assign({}, DEFAULT_CONTENT.blog, saved.blog, {
    articles: normalizeArticles((saved.blog && saved.blog.articles) || DEFAULT_CONTENT.blog.articles)
      .map((a) => Object.assign({}, a, { likes: Number(likes[a.slug]) || 0 })),
  });
  merged.portfolio = Object.assign({}, DEFAULT_CONTENT.portfolio, saved.portfolio, {
    casos: normalizeCasos((saved.portfolio && saved.portfolio.casos) || DEFAULT_CONTENT.portfolio.casos),
  });
  // shallow Object.assign at the top level means a page added to these
  // two *after* content.json already had a `slugs`/`meta` key of its
  // own would otherwise vanish entirely — merge one level deeper here
  // so a newly-added key (e.g. "admin") always gets its default.
  merged.slugs = Object.assign({}, DEFAULT_CONTENT.slugs, saved.slugs);
  merged.meta = Object.assign({}, DEFAULT_CONTENT.meta, saved.meta);
  return merged;
}

app.get('/api/content', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const merged = await loadMergedContent();
  return res.status(200).json(merged);
});

app.post('/api/content', jsonBody, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (!isAuthorized(req)) return res.status(401).json({ error: 'No autorizado' });

  const body = req.body;
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Contenido inválido' });

  if (body.slugs) {
    const slugErrors = validateSlugs(body.slugs);
    if (slugErrors.length) return res.status(400).json({ error: slugErrors.join(' ') });
  }

  // Likes live in their own file (see readLikes/queueLikesWrite above),
  // never in content.json — strip any copy a client happens to be
  // carrying so a save here can never revert real like counts back to
  // whatever they were when that tab last loaded /api/content.
  if (body.blog && Array.isArray(body.blog.articles)) {
    body.blog.articles.forEach((a) => { if (a && typeof a === 'object') delete a.likes; });
  }

  try {
    await fs.writeFile(CONTENT_FILE, JSON.stringify(body));
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('save content failed', err);
    return res.status(500).json({ error: 'No se pudo guardar' });
  }
});

// ---------- /api/contact ----------
const MAX_FIELDS = 30;
const MAX_KEY_LENGTH = 60;
const MAX_VALUE_LENGTH = 4000;

app.post('/api/contact', contactLimiter, jsonBody, async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  const entries = Object.entries(body).slice(0, MAX_FIELDS);
  const hasContent = entries.some(([, value]) => String(value || '').trim());
  if (!entries.length || !hasContent) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  const entry = {};
  for (const [key, value] of entries) {
    const safeKey = String(key).slice(0, MAX_KEY_LENGTH);
    entry[safeKey] = String(value == null ? '' : value).slice(0, MAX_VALUE_LENGTH);
  }
  entry.fecha = new Date().toISOString();

  // Each submission is its own file (no shared file to read-modify-write),
  // so two submissions arriving at the same time can never clobber each other.
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.json`;

  try {
    await fs.writeFile(path.join(CONSULTAS_DIR, filename), JSON.stringify(entry));
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('contact submission failed', err);
    return res.status(500).json({ error: 'No se pudo guardar el mensaje' });
  }
});

// ---------- /api/consultas ----------
// filenames are always "<timestamp>-<random-base36>.json" (see /api/contact
// below) — anything not matching this exact shape is never trusted enough
// to build a file path from, whether read here or in the move-column route.
const CONSULTA_ID_RE = /^[0-9]+-[a-z0-9]+$/;

app.get('/api/consultas', async (req, res) => {
  const queryToken = req.query.token;
  const authorized = isAuthorized(req) || (Boolean(process.env.ADMIN_TOKEN) && queryToken === process.env.ADMIN_TOKEN);
  if (!authorized) return res.status(401).json({ error: 'No autorizado' });

  try {
    const content = await loadMergedContent();
    const columns = (content.kanban && content.kanban.columns) || [];
    const defaultColumnId = columns[0] && columns[0].id;

    const files = await fs.readdir(CONSULTAS_DIR);
    const items = (await Promise.all(
      files.filter((f) => f.endsWith('.json')).map(async (f) => {
        try {
          const text = await fs.readFile(path.join(CONSULTAS_DIR, f), 'utf8');
          const parsed = JSON.parse(text);
          // _id (underscore, like _savedAt elsewhere) so it can never collide
          // with a real form field key — those come from admin-typed labels,
          // never starting with an underscore.
          return Object.assign({ columnId: defaultColumnId }, parsed, { _id: f.slice(0, -'.json'.length) });
        } catch (err) {
          console.error('failed to read', f, err);
          return null;
        }
      })
    )).filter(Boolean);

    items.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    return res.status(200).json({ items });
  } catch (err) {
    console.error('list consultas failed', err);
    return res.status(500).json({ error: 'No se pudieron obtener las consultas' });
  }
});

// ---------- /api/consultas/:id/column (move a card between kanban columns) ----------
app.post('/api/consultas/:id/column', jsonBody, async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'No autorizado' });

  const id = String(req.params.id || '');
  if (!CONSULTA_ID_RE.test(id)) return res.status(400).json({ error: 'Id inválido' });

  const columnId = String((req.body && req.body.columnId) || '');
  if (!columnId) return res.status(400).json({ error: 'Falta la columna' });

  const filePath = path.join(CONSULTAS_DIR, id + '.json');
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const entry = JSON.parse(text);
    entry.columnId = columnId;
    await fs.writeFile(filePath, JSON.stringify(entry));
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'No se encontró la consulta' });
    console.error('move consulta column failed', err);
    return res.status(500).json({ error: 'No se pudo mover la consulta' });
  }
});

// ---------- /api/blog/:slug/like, /api/blog/:slug/set-likes ----------
// Same slug shape the admin already validates in content-defaults.js
// (SLUG_RE) — kept as a local copy rather than importing it, since a like
// only ever needs the shape check, never the reserved-word/collision
// rules that make sense for a *page* slug.
const BLOG_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_LIKES = 10000000;

const likeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  message: { error: 'Demasiados likes, probá de nuevo en un rato.' },
});

// Public, no login — anyone can like a post once per browser (enforced
// client-side via localStorage; this endpoint itself just increments, rate
// limited per IP so it can't be hammered into a fake number in seconds).
app.post('/api/blog/:slug/like', likeLimiter, async (req, res) => {
  const slug = String(req.params.slug || '');
  if (!BLOG_SLUG_RE.test(slug)) return res.status(400).json({ error: 'Artículo inválido' });
  try {
    const likes = await queueLikesWrite((map) => {
      map[slug] = Math.min(MAX_LIKES, (Number(map[slug]) || 0) + 1);
      return map[slug];
    });
    return res.status(200).json({ likes });
  } catch (err) {
    console.error('like failed', err);
    return res.status(500).json({ error: 'No se pudo registrar el like' });
  }
});

// Admin-only — lets Erik set the displayed like count for an article
// directly (e.g. to reflect real engagement seen elsewhere, or just to
// seed a new post) instead of only ever incrementing by one.
app.post('/api/blog/:slug/set-likes', requireAdmin, jsonBody, async (req, res) => {
  const slug = String(req.params.slug || '');
  if (!BLOG_SLUG_RE.test(slug)) return res.status(400).json({ error: 'Artículo inválido' });
  const count = Math.round(Number(req.body && req.body.count));
  if (!Number.isFinite(count) || count < 0 || count > MAX_LIKES) {
    return res.status(400).json({ error: 'Número de likes inválido' });
  }
  try {
    await queueLikesWrite((map) => { map[slug] = count; });
    return res.status(200).json({ ok: true, likes: count });
  } catch (err) {
    console.error('set-likes failed', err);
    return res.status(500).json({ error: 'No se pudo guardar' });
  }
});

// ---------- /api/login, /api/logout ----------
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

app.post('/api/login', loginLimiter, jsonBody, (req, res) => {
  const { password } = req.body || {};
  if (!process.env.ADMIN_TOKEN || !safeEqual(password, process.env.ADMIN_TOKEN)) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  const isHttps = req.headers['x-forwarded-proto'] === 'https';
  const cookie = [
    `${COOKIE_NAME}=${process.env.ADMIN_TOKEN}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE}`,
    isHttps ? 'Secure' : '',
  ].filter(Boolean).join('; ');
  res.setHeader('Set-Cookie', cookie);
  return res.status(200).json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res.status(200).json({ ok: true });
});

// ---------- /api/upload-media ----------
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024; // images — already client-compressed, stay small
// Raw video, before compression. Kept conservatively under the ~100MB
// request-body ceiling Cloudflare's Free/Pro plans have historically
// enforced at the edge, once base64 inflates it (see videoJsonLimitBytes).
const MAX_VIDEO_UPLOAD_BYTES = 80 * 1024 * 1024;
// Derived from the byte constant above (not a separately-hardcoded string)
// so the two can never drift out of sync with each other.
const videoJsonLimitBytes = Math.ceil(MAX_VIDEO_UPLOAD_BYTES * 4 / 3) + 2 * 1024 * 1024;

// Extension must match the declared contentType, and the file's own first
// bytes must match that type's real signature — a renamed/mislabeled file
// (e.g. an .html file declared as image/png) is rejected either way.
const ALLOWED_TYPES = {
  'image/jpeg': { ext: ['jpg', 'jpeg'], magic: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: ['png'], magic: (b) => b.length >= 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/gif': { ext: ['gif'], magic: (b) => b.length >= 3 && b.slice(0, 3).toString('ascii') === 'GIF' },
  'image/webp': { ext: ['webp'], magic: (b) => b.length >= 12 && b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' },
  'video/mp4': { ext: ['mp4'], magic: (b) => b.length >= 8 && b.slice(4, 8).toString('ascii') === 'ftyp' },
  'video/quicktime': { ext: ['mov'], magic: (b) => b.length >= 8 && b.slice(4, 8).toString('ascii') === 'ftyp' },
  'video/webm': { ext: ['webm'], magic: (b) => b.length >= 4 && b.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
};

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  message: { error: 'Demasiadas subidas, probá de nuevo en un rato.' },
});

// Single Node process, no clustering — a plain in-memory counter is enough.
// Only video jobs count against this (a plain image write is instant).
// Checked AFTER express.json() below, since contentType only exists once
// the body is parsed — a rejected request here still pays the parse cost,
// but that's a rare, self-inflicted case (an admin firing several big
// uploads at once), not something worth a header-based pre-parse trick for.
let activeTranscodes = 0;
const MAX_CONCURRENT_TRANSCODES = 2;
function transcodeConcurrencyGuard(req, res, next) {
  const contentType = String((req.body && req.body.contentType) || '');
  if (contentType.toLowerCase().startsWith('video/') && activeTranscodes >= MAX_CONCURRENT_TRANSCODES) {
    return res.status(429).json({ error: 'Ya hay compresiones de video en curso — esperá un momento y probá de nuevo.' });
  }
  next();
}

// Re-encodes to H.264/AAC mp4 regardless of the source container, so every
// video on the site ends up in the one format every browser plays natively.
// -threads 3 (not 4): this VPS also runs other live services, leave a core free.
function runFfmpeg(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y', '-i', inputPath,
      '-vf', "scale='min(1920,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      '-c:v', 'libx264', '-preset', 'faster', '-crf', '26', '-threads', '3',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath,
    ];
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderrTail = '';
    // MUST drain stderr — ffmpeg writes continuous progress output there,
    // and an undrained pipe fills within seconds for any real video,
    // hanging the process until the timeout kills it. Every time, not rarely.
    proc.stderr.on('data', (chunk) => {
      stderrTail += chunk.toString();
      if (stderrTail.length > 4000) stderrTail = stderrTail.slice(-4000);
    });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('timeout')); }, 4 * 60 * 1000);
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('ffmpeg exited with code ' + code + ': ' + stderrTail.slice(-500)));
    });
  });
}

app.post('/api/upload-media', requireAdmin, uploadLimiter, express.json({ limit: videoJsonLimitBytes }), transcodeConcurrencyGuard, async (req, res) => {
  const { filename, contentType, dataBase64 } = req.body || {};
  if (!filename || !contentType || !dataBase64) {
    return res.status(400).json({ error: 'Faltan datos del archivo' });
  }
  const spec = ALLOWED_TYPES[String(contentType).toLowerCase()];
  const declaredExt = String(filename).toLowerCase().split('.').pop();
  if (!spec || !spec.ext.includes(declaredExt)) {
    return res.status(400).json({ error: 'Tipo de archivo no permitido' });
  }
  const isVideo = String(contentType).toLowerCase().startsWith('video/');

  const buffer = Buffer.from(dataBase64, 'base64');
  const maxBytes = isVideo ? MAX_VIDEO_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
  if (buffer.length > maxBytes) {
    return res.status(413).json({
      error: isVideo
        ? 'El video es muy pesado (máx ~80MB antes de comprimir). Para algo más grande, pediselo a Claude directamente.'
        : 'El archivo es muy pesado para este uploader (máx ~3MB). Para fotos grandes o videos largos, pediselo a Claude para que lo comprima y lo suba.',
    });
  }
  if (!spec.magic(buffer)) {
    return res.status(400).json({ error: 'El archivo no parece ser realmente del tipo declarado' });
  }

  if (!isVideo) {
    const safeName = String(filename).toLowerCase().replace(/[^a-z0-9.\-]+/g, '-').slice(-80);
    const relPath = `uploads/${Date.now()}-${safeName}`;
    const fullPath = path.join(MEDIA_DIR, relPath);
    try {
      await fs.writeFile(fullPath, buffer);
      return res.status(200).json({ url: `/media/${relPath}` });
    } catch (err) {
      console.error('upload-media failed', err);
      return res.status(500).json({ error: 'No se pudo subir el archivo' });
    }
  }

  // video path: decode -> compress with ffmpeg -> commit, always ending up
  // as .mp4 regardless of the source container (mov/webm normalize too).
  const uid = crypto.randomUUID();
  const tempInput = path.join(os.tmpdir(), `upload-${uid}.${declaredExt}`);
  const tempOutput = path.join(UPLOADS_DIR, `.tmp-${uid}.mp4`); // same volume as the final path — fs.rename below must not cross filesystems
  const finalRelPath = `uploads/${Date.now()}-${uid}.mp4`;
  const finalFullPath = path.join(MEDIA_DIR, finalRelPath);

  activeTranscodes += 1;
  try {
    await fs.writeFile(tempInput, buffer);
    await runFfmpeg(tempInput, tempOutput);
    const stat = await fs.stat(tempOutput).catch(() => null);
    if (!stat || stat.size === 0) throw new Error('ffmpeg produced an empty file');
    await fs.rename(tempOutput, finalFullPath);
    if (res.headersSent) return; // client already gave up (e.g. a proxy timeout) — nothing to send
    return res.status(200).json({ url: `/media/${finalRelPath}` });
  } catch (err) {
    console.error('video compression failed', err);
    if (res.headersSent) return;
    return res.status(500).json({ error: 'No se pudo comprimir el video. Probá con un archivo más chico, o pediselo a Claude directamente.' });
  } finally {
    activeTranscodes -= 1;
    await fs.unlink(tempInput).catch(() => {});
    await fs.unlink(tempOutput).catch(() => {});
  }
});

// ---------- sitemap.xml / robots.txt ----------
// Excludes terminos/privacidad (already noindex) and admin (its whole point
// is not being discoverable — robots.txt is public, so its real path must
// never appear here). Blog articles and portfolio casos are listed
// individually since crawlers won't otherwise find pages reachable only via
// a client-side fetch + ?s= lookup.
app.get('/sitemap.xml', async (req, res) => {
  const content = await loadMergedContent();
  const slugs = content.slugs || {};
  const origin = req.protocol + '://' + req.get('host');
  const urls = [];
  urls.push(slugs.home || '');
  ['nosotros', 'portfolio', 'nobrand', 'blog'].forEach((key) => urls.push(slugs[key] || key));
  ((content.blog && content.blog.articles) || []).forEach((a) => {
    if (a.slug) urls.push('blog-post.html?s=' + encodeURIComponent(a.slug));
  });
  ((content.portfolio && content.portfolio.casos) || []).forEach((c) => {
    if (c.slug) urls.push('caso.html?s=' + encodeURIComponent(c.slug));
  });
  const body = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => '  <url><loc>' + origin + '/' + u + '</loc></url>').join('\n') +
    '\n</urlset>\n';
  res.setHeader('Content-Type', 'application/xml');
  res.send(body);
});

app.get('/robots.txt', async (req, res) => {
  const origin = req.protocol + '://' + req.get('host');
  res.setHeader('Content-Type', 'text/plain');
  res.send(
    'User-agent: *\n' +
    'Allow: /\n' +
    'Disallow: /api/\n' +
    'Sitemap: ' + origin + '/sitemap.xml\n'
  );
});

// ---------- custom page slugs ----------
// Registered last (after every literal route above) so it never shadows
// them and so the 9 existing pages keep resolving by exact match without
// paying for a content.json read. Purely additive: the literal /*.html
// routes above keep working forever — this only adds an extra path that
// serves the same file when its slug matches the one saved in content.json.
app.get('/:seg', async (req, res, next) => {
  const seg = String(req.params.seg || '');
  if (!seg) return next();
  const content = await loadMergedContent();
  const slugs = content.slugs || {};
  const matchKey = Object.keys(SLUG_PAGE_FILES).find((k) => slugs[k] === seg);
  if (!matchKey) return next();
  return res.sendFile(path.join(ROOT, SLUG_PAGE_FILES[matchKey]));
});

// Global error handler (4 args — Express only calls this shape for
// errors). Catches things like express.json() choking on malformed JSON,
// which would otherwise fall through to Express's default handler and,
// outside NODE_ENV=production, leak a full stack trace to the client.
app.use((err, req, res, next) => {
  console.error('unhandled request error', err);
  if (res.headersSent) return next(err);
  res.status(400).json({ error: 'Solicitud inválida' });
});

ensureDirs().then(() => {
  sweepStaleTempFiles();
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Tino Partners server listening on :${PORT} (DATA_DIR=${DATA_DIR})`);
  });
  // a video compression request can legitimately run longer than any other
  // route — make sure Node's own timeout doesn't cut it off before the
  // in-app ffmpeg timeout (4 min) ever gets a chance to.
  server.requestTimeout = 5 * 60 * 1000;
  server.headersTimeout = 5 * 60 * 1000 + 5000;
});
