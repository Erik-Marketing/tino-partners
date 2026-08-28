const COOKIE_NAME = 'tp_admin';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
    `Max-Age=${MAX_AGE}`,
    isHttps ? 'Secure' : '',
  ].filter(Boolean).join('; ');

  res.setHeader('Set-Cookie', cookie);
  return res.status(200).json({ ok: true });
};
