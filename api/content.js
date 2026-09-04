const { put, get } = require('@vercel/blob');
const { DEFAULT_CONTENT, normalizeArticles } = require('../content-defaults');

const COOKIE_NAME = 'tp_admin';
const CONTENT_PATH = 'content/home.json';

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

module.exports = async function handler(req, res) {
  // never let the browser or an edge/CDN cache this response — the content
  // (including image/video URLs) changes whenever someone saves in the
  // admin, and a stale cached copy was showing an old photo after a reload.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'GET') {
    try {
      const result = await get(CONTENT_PATH, {
        access: 'public',
        useCache: false,
        token: process.env.MEDIA_READ_WRITE_TOKEN,
      });
      if (!result || result.statusCode !== 200) return res.status(200).json(DEFAULT_CONTENT);
      const text = await new Response(result.stream).text();
      const saved = JSON.parse(text);
      const merged = Object.assign({}, DEFAULT_CONTENT, saved);
      merged.blog = Object.assign({}, DEFAULT_CONTENT.blog, saved.blog, {
        articles: normalizeArticles((saved.blog && saved.blog.articles) || DEFAULT_CONTENT.blog.articles),
      });
      return res.status(200).json(merged);
    } catch (err) {
      return res.status(200).json(DEFAULT_CONTENT);
    }
  }

  if (req.method === 'POST') {
    const sessionToken = readCookie(req, COOKIE_NAME);
    const authorized = process.env.ADMIN_TOKEN && sessionToken === process.env.ADMIN_TOKEN;
    if (!authorized) return res.status(401).json({ error: 'No autorizado' });

    const body = req.body;
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Contenido inválido' });

    try {
      await put(CONTENT_PATH, JSON.stringify(body), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        token: process.env.MEDIA_READ_WRITE_TOKEN,
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('save content failed', err);
      return res.status(500).json({ error: 'No se pudo guardar' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
};
