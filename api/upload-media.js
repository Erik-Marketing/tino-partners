const { put } = require('@vercel/blob');

const COOKIE_NAME = 'tp_admin';
// Raw file-size cap for this quick uploader. Vercel Serverless Functions cap
// the whole request body at ~4.5MB, and base64 inflates the file by ~33%, so
// this stays comfortably under that after the JSON envelope too. Bigger
// files (long videos, unconverted RAW photos) still need to go through the
// existing manual/Claude-assisted upload — this endpoint is for quick edits.
const MAX_BYTES = 3 * 1024 * 1024;

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sessionToken = readCookie(req, COOKIE_NAME);
  const authorized = process.env.ADMIN_TOKEN && sessionToken === process.env.ADMIN_TOKEN;
  if (!authorized) return res.status(401).json({ error: 'No autorizado' });

  const { filename, contentType, dataBase64 } = req.body || {};
  if (!filename || !contentType || !dataBase64) {
    return res.status(400).json({ error: 'Faltan datos del archivo' });
  }
  if (!/^(image|video)\//.test(contentType)) {
    return res.status(400).json({ error: 'Solo se aceptan imágenes o videos' });
  }

  const buffer = Buffer.from(dataBase64, 'base64');
  if (buffer.length > MAX_BYTES) {
    return res.status(413).json({
      error: 'El archivo es muy pesado para este uploader (máx ~3MB). Para fotos grandes o videos largos, pediselo a Claude para que lo comprima y lo suba.',
    });
  }

  const safeName = String(filename).toLowerCase().replace(/[^a-z0-9.\-]+/g, '-').slice(-80);
  const path = `uploads/${Date.now()}-${safeName}`;

  try {
    const blob = await put(path, buffer, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      token: process.env.MEDIA_READ_WRITE_TOKEN,
    });
    return res.status(200).json({ url: blob.url });
  } catch (err) {
    console.error('upload-media failed', err);
    return res.status(500).json({ error: 'No se pudo subir el archivo' });
  }
};
