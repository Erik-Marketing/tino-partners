const { put } = require('@vercel/blob');

// The set of questions is admin-configurable (see api/content.js's `form`
// section), so this endpoint doesn't know field names in advance — it just
// sanitizes whatever object the form posted instead of validating specific
// keys. The site's own client-side validation already enforces "required"
// before submitting; this is a defensive backstop, not the source of truth
// for which fields exist.
const MAX_FIELDS = 30;
const MAX_KEY_LENGTH = 60;
const MAX_VALUE_LENGTH = 4000;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
