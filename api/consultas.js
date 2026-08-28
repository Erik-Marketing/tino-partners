const { list, get } = require('@vercel/blob');

const COOKIE_NAME = 'tp_admin';

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sessionToken = readCookie(req, COOKIE_NAME);
  const queryToken = req.query.token;
  const authorized = process.env.ADMIN_TOKEN && (sessionToken === process.env.ADMIN_TOKEN || queryToken === process.env.ADMIN_TOKEN);

  if (!authorized) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const { blobs } = await list({ prefix: 'consultas/', mode: 'expanded' });

    const items = (await Promise.all(
      blobs.map(async (blob) => {
        try {
          const result = await get(blob.pathname, { access: 'private', useCache: false });
          if (!result || result.statusCode !== 200) return null;
          const text = await new Response(result.stream).text();
          return JSON.parse(text);
        } catch (err) {
          console.error('failed to read', blob.pathname, err);
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
};
