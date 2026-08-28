const { put } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { nombre, email, rubro, tamano, ganancias, mensaje } = req.body || {};
  if (!nombre || !email || !rubro || !tamano || !ganancias || !mensaje) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  const entry = {
    nombre: String(nombre).slice(0, 200),
    email: String(email).slice(0, 200),
    rubro: String(rubro).slice(0, 200),
    tamano: String(tamano).slice(0, 200),
    ganancias: String(ganancias).slice(0, 200),
    mensaje: String(mensaje).slice(0, 4000),
    fecha: new Date().toISOString(),
  };

  // Each submission is its own blob (no shared file to read-modify-write), so
  // two submissions arriving at the same time can never overwrite each other.
  const path = `consultas/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.json`;

  try {
    await put(path, JSON.stringify(entry), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('contact submission failed', err);
    return res.status(500).json({ error: 'No se pudo guardar el mensaje' });
  }
};
