// Standalone server for running Tino Partners on our own VPS (Docker),
// instead of Vercel. Serves the same static pages and re-implements the
// same /api/* contract as the Vercel functions in api/*.js — but storage
// moves from Vercel Blob to plain files under DATA_DIR, since there's no
// serverless-function boundary here to force an external store. Keeping
// the same request/response shape as the Vercel handlers means the
// front-end (fetch calls in the HTML pages, admin.html) needed zero changes.
const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');
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
const COOKIE_NAME = 'tp_admin';
const PORT = process.env.PORT || 3000;

// Crash-only-that-request instead of crash-the-whole-process: log and keep
// serving other requests. Docker's "restart: unless-stopped" is the real
// safety net if something manages to bring the process down anyway.
process.on('unhandledRejection', (err) => console.error('unhandledRejection', err));
process.on('uncaughtException', (err) => console.error('uncaughtException', err));

async function ensureDirs() {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await fs.mkdir(CONSULTAS_DIR, { recursive: true });
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
app.use(express.json({ limit: '20mb' }));

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
  try {
    const text = await fs.readFile(CONTENT_FILE, 'utf8');
    const saved = JSON.parse(text);
    const merged = Object.assign({}, DEFAULT_CONTENT, saved);
    merged.blog = Object.assign({}, DEFAULT_CONTENT.blog, saved.blog, {
      articles: normalizeArticles((saved.blog && saved.blog.articles) || DEFAULT_CONTENT.blog.articles),
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
  } catch (err) {
    return DEFAULT_CONTENT;
  }
}

app.get('/api/content', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const merged = await loadMergedContent();
  return res.status(200).json(merged);
});

app.post('/api/content', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (!isAuthorized(req)) return res.status(401).json({ error: 'No autorizado' });

  const body = req.body;
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Contenido inválido' });

  if (body.slugs) {
    const slugErrors = validateSlugs(body.slugs);
    if (slugErrors.length) return res.status(400).json({ error: slugErrors.join(' ') });
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

app.post('/api/contact', contactLimiter, async (req, res) => {
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
app.get('/api/consultas', async (req, res) => {
  const queryToken = req.query.token;
  const authorized = isAuthorized(req) || (Boolean(process.env.ADMIN_TOKEN) && queryToken === process.env.ADMIN_TOKEN);
  if (!authorized) return res.status(401).json({ error: 'No autorizado' });

  try {
    const files = await fs.readdir(CONSULTAS_DIR);
    const items = (await Promise.all(
      files.filter((f) => f.endsWith('.json')).map(async (f) => {
        try {
          const text = await fs.readFile(path.join(CONSULTAS_DIR, f), 'utf8');
          return JSON.parse(text);
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

// ---------- /api/login, /api/logout ----------
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

app.post('/api/login', loginLimiter, (req, res) => {
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
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

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

app.post('/api/upload-media', async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'No autorizado' });

  const { filename, contentType, dataBase64 } = req.body || {};
  if (!filename || !contentType || !dataBase64) {
    return res.status(400).json({ error: 'Faltan datos del archivo' });
  }
  const spec = ALLOWED_TYPES[String(contentType).toLowerCase()];
  const declaredExt = String(filename).toLowerCase().split('.').pop();
  if (!spec || !spec.ext.includes(declaredExt)) {
    return res.status(400).json({ error: 'Tipo de archivo no permitido' });
  }

  const buffer = Buffer.from(dataBase64, 'base64');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return res.status(413).json({
      error: 'El archivo es muy pesado para este uploader (máx ~3MB). Para fotos grandes o videos largos, pediselo a Claude para que lo comprima y lo suba.',
    });
  }
  if (!spec.magic(buffer)) {
    return res.status(400).json({ error: 'El archivo no parece ser realmente del tipo declarado' });
  }

  const safeName = String(filename).toLowerCase().replace(/[^a-z0-9.\-]+/g, '-').slice(-80);
  const relPath = `uploads/${Date.now()}-${safeName}`;
  const fullPath = path.join(MEDIA_DIR, relPath);

  try {
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return res.status(200).json({ url: `/media/${relPath}` });
  } catch (err) {
    console.error('upload-media failed', err);
    return res.status(500).json({ error: 'No se pudo subir el archivo' });
  }
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
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Tino Partners server listening on :${PORT} (DATA_DIR=${DATA_DIR})`);
  });
});
