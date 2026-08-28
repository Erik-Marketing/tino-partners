const { get } = require('@vercel/blob');

const STORE_KEY = 'consultas/consultas.json';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.query.token;
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const result = await get(STORE_KEY, { access: 'private' });
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
