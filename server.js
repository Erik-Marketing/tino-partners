// Standalone server for running Tino Partners on our own VPS (Docker),
// instead of Vercel. Serves the same static pages and re-implements the
// same /api/* contract as the Vercel functions in api/*.js — but storage
// moves from Vercel Blob to plain files under DATA_DIR, since there's no
// serverless-function boundary here to force an external store. Keeping
// the same request/response shape as the Vercel handlers means the
// front-end (fetch calls in the HTML pages, admin.html) needed zero changes.
const path = require('path');
const fs = require('fs/promises');
const express = require('express');
const { DEFAULT_CONTENT, normalizeArticles } = require('./content-defaults');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const CONSULTAS_DIR = path.join(DATA_DIR, 'consultas');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const COOKIE_NAME = 'tp_admin';
const PORT = process.env.PORT || 3000;

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

function isAuthorized(req) {
  const sessionToken = readCookie(req, COOKIE_NAME);
  return Boolean(process.env.ADMIN_TOKEN) && sessionToken === process.env.ADMIN_TOKEN;
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20mb' }));

// ---------- static pages (explicit allowlist — never serve server.js,
// package.json, .env, etc. even though they live in the same folder) ----------
const PAGES = [
  'index.html', 'nosotros.html', 'portfolio.html', 'nobrand.html',
  'blog.html', 'blog-post.html', 'terminos.html', 'privacidad.html', 'admin.html',
];
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
PAGES.forEach((page) => {
  app.get('/' + page, (req, res) => res.sendFile(path.join(ROOT, page)));
});

// uploaded media, served same-origin so content.json can reference plain
// relative URLs like /media/proyectos/xyz.mp4
app.use('/media', express.static(MEDIA_DIR, { maxAge: '30d' }));

// ---------- /api/content ----------
app.get('/api/content', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const text = await fs.readFile(CONTENT_FILE, 'utf8');
    const saved = JSON.parse(text);
    const merged = Object.assign({}, DEFAULT_CONTENT, saved);
    merged.blog = Object.assign({}, DEFAULT_CONTENT.blog, saved.blog, {
      articles: normalizeArticles((saved.blog && saved.blog.articles) || DEFAULT_CONTENT.blog.articles),
    });
    return res.status(200).json(merged);
  } catch (err) {
    return res.status(200).json(DEFAULT_CONTENT);
  }
});

app.post('/api/content', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (!isAuthorized(req)) return res.status(401).json({ error: 'No autorizado' });

  const body = req.body;
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Contenido inválido' });

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

app.post('/api/contact', async (req, res) => {
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

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!process.env.ADMIN_TOKEN || password !== process.env.ADMIN_TOKEN) {
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

app.post('/api/upload-media', async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'No autorizado' });

  const { filename, contentType, dataBase64 } = req.body || {};
  if (!filename || !contentType || !dataBase64) {
    return res.status(400).json({ error: 'Faltan datos del archivo' });
  }
  if (!/^(image|video)\//.test(contentType)) {
    return res.status(400).json({ error: 'Solo se aceptan imágenes o videos' });
  }

  const buffer = Buffer.from(dataBase64, 'base64');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return res.status(413).json({
      error: 'El archivo es muy pesado para este uploader (máx ~3MB). Para fotos grandes o videos largos, pediselo a Claude para que lo comprima y lo suba.',
    });
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

ensureDirs().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Tino Partners server listening on :${PORT} (DATA_DIR=${DATA_DIR})`);
  });
});
