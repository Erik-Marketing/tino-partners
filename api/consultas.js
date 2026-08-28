const { get } = require('@vercel/blob');

const STORE_KEY = 'consultas/consultas.json';
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
    const result = await get(STORE_KEY, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) {
      return res.status(200).json({ items: [] });
    }
    const text = await new Response(result.stream).text();
    const items = JSON.parse(text);
    items.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    return res.status(200).json({ items });
  } catch (err) {
    console.error('list consultas failed', err);
    return res.status(500).json({ error: 'No se pudieron obtener las consultas' });
  }
};
