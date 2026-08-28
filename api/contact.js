const { get, put } = require('@vercel/blob');

const STORE_KEY = 'consultas/consultas.json';

async function readAll() {
  const result = await get(STORE_KEY, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) return [];
  const text = await new Response(result.stream).text();
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { nombre, email, rubro, mensaje } = req.body || {};
  if (!nombre || !email || !rubro || !mensaje) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  const entry = {
    nombre: String(nombre).slice(0, 200),
    email: String(email).slice(0, 200),
    rubro: String(rubro).slice(0, 200),
    mensaje: String(mensaje).slice(0, 4000),
    fecha: new Date().toISOString(),
  };

  try {
    const items = await readAll();
    items.push(entry);

    await put(STORE_KEY, JSON.stringify(items), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('contact submission failed', err);
    return res.status(500).json({ error: 'No se pudo guardar el mensaje' });
  }
};
