// Standalone server for running Tino Partners on our own VPS (Docker),
// instead of Vercel. Serves the same static pages and re-implements the
// same /api/* contract as the Vercel functions in api/*.js — but storage
// moves from Vercel Blob to plain files under DATA_DIR, since there's no
// serverless-function boundary here to force an external store. Keeping
// the same request/response shape as the Vercel handlers means the
// front-end (fetch calls in the HTML pages, admin.html) needed zero changes.
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs/promises');
const { spawn } = require('child_process');
const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  DEFAULT_CONTENT, normalizeArticles, normalizeCasos, normalizeTestimonios, normalizeFormFields,
  validateSlugs, SLUG_PAGE_FILES, CONTENT_PATHS, DEFAULT_ROLES,
} = require('./content-defaults');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const CONSULTAS_DIR = path.join(DATA_DIR, 'consultas');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const LIKES_FILE = path.join(DATA_DIR, 'likes.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSION_SECRET_FILE = path.join(DATA_DIR, '.session-secret');
const COOKIE_NAME = 'tp_admin';
const PORT = process.env.PORT || 3000;

// Crash-only-that-request instead of crash-the-whole-process: log and keep
// serving other requests. Docker's "restart: unless-stopped" is the real
// safety net if something manages to bring the process down anyway.
process.on('unhandledRejection', (err) => console.error('unhandledRejection', err));
process.on('uncaughtException', (err) => console.error('uncaughtException', err));

const UPLOADS_DIR = path.join(MEDIA_DIR, 'uploads');

async function ensureDirs() {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await fs.mkdir(CONSULTAS_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

// covers leftovers from a request that crashed/restarted/timed-out mid-way —
// the "commit" step for a compressed video is a same-directory fs.rename, so
// a stray .tmp- file here always means something didn't finish cleanly.
async function sweepStaleTempFiles() {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  try {
    const files = await fs.readdir(UPLOADS_DIR);
    await Promise.all(files.filter((f) => f.startsWith('.tmp-')).map(async (f) => {
      try {
        const full = path.join(UPLOADS_DIR, f);
        const stat = await fs.stat(full);
        if (Date.now() - stat.mtimeMs > ONE_DAY_MS) await fs.unlink(full);
      } catch (err) { /* already gone, or a race with a live upload — ignore */ }
    }));
  } catch (err) { /* UPLOADS_DIR not created yet on a very first boot — ignore */ }
}

// Single Node process, no clustering — a read-modify-write against one
// shared JSON file still needs its own writes serialized per-file, or two
// requests arriving in the same tick could both read the same on-disk
// state and one of their changes would be silently lost. `mutate` receives
// whatever `readFn()` resolved to, mutates it in place (or returns a fresh
// value — either is written back), and whatever `mutate` returns is handed
// back to the caller of the write. One queue per file, never shared across
// files, so a slow write to one never blocks a write to another.
function makeFileWriteQueue(filePath, readFn) {
  let queue = Promise.resolve();
  return function queueWrite(mutate) {
    const result = queue.then(async () => {
      const data = await readFn();
      const value = mutate(data);
      await fs.writeFile(filePath, JSON.stringify(data));
      return value;
    });
    // the queue itself must never stay rejected, or every write after a
    // single failed one would be skipped forever — the caller still gets
    // the real error via `result`.
    queue = result.catch(() => {});
    return result;
  };
}

// Blog likes live in their own small file, never in content.json — a like
// click is a single-visitor, no-login action that can happen dozens of
// times a minute, and content.json is only ever meant to be rewritten
// whole by the admin's "Guardar cambios" flow (see POST /api/content).
// Mixing the two would mean a stale admin tab saving unrelated content
// could silently revert real like counts back to whatever they were when
// that tab last loaded — a bug class this project has already hit once
// with content.json itself.
async function readLikes() {
  try {
    const parsed = JSON.parse(await fs.readFile(LIKES_FILE, 'utf8'));
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch (err) {
    return {};
  }
}
const queueLikesWrite = makeFileWriteQueue(LIKES_FILE, readLikes);

// Users/roles — same one-file-one-queue reasoning as likes.json above.
// Shape: { users: [...], roles: [...] }. A read/parse failure (missing
// file on a fresh install, or corruption) falls back to an empty user
// list plus just the seeded owner role — never throws, so a broken file
// fails closed (nobody can log in) rather than crashing the process.
async function readUsersData() {
  try {
    const parsed = JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
    const users = Array.isArray(parsed && parsed.users) ? parsed.users : [];
    const roles = Array.isArray(parsed && parsed.roles) ? parsed.roles : DEFAULT_ROLES.slice();
    return { users, roles };
  } catch (err) {
    return { users: [], roles: DEFAULT_ROLES.slice() };
  }
}
const queueUsersWrite = makeFileWriteQueue(USERS_FILE, readUsersData);

function findRole(roles, roleId) {
  return (roles || []).find((r) => r.id === roleId) || null;
}
// A missing/deleted role (shouldn't happen via the UI — role deletion is
// blocked while any user is still assigned to it — but data can outlive
// the UI's guarantees) degrades to "no access" rather than throwing.
function permissionsOf(role) {
  if (!role) return { allAccess: false, permissions: [] };
  return { allAccess: Boolean(role.allAccess), permissions: Array.isArray(role.permissions) ? role.permissions : [] };
}
function roleHasPermission(role, key) {
  const p = permissionsOf(role);
  return p.allAccess || p.permissions.includes(key);
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

// Constant-time compare so a wrong guess can't be timed byte-by-byte.
// Buffers of different lengths are just "not equal", never passed into
// timingSafeEqual (which throws on a length mismatch).
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a == null ? '' : a), 'utf8');
  const bufB = Buffer.from(String(b == null ? '' : b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---------- passwords ----------
// scrypt (Node built-in, no new dependency) instead of bcrypt, which would
// need native compilation — this project has zero native deps on purpose.
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(String(password), salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`scrypt$${salt.toString('hex')}$${derivedKey.toString('hex')}`);
    });
  });
}
function verifyPassword(password, stored) {
  return new Promise((resolve) => {
    const parts = String(stored || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return resolve(false);
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    crypto.scrypt(String(password), salt, 64, (err, derivedKey) => {
      if (err || derivedKey.length !== expected.length) return resolve(false);
      resolve(crypto.timingSafeEqual(derivedKey, expected));
    });
  });
}

// ---------- signed session/pending tokens ----------
// Replaces "the cookie value IS the shared secret" — the cookie is now an
// opaque, revocable token: base64url(userId).base64url(issuedAtMs).base64url(hmac),
// signed with a secret generated once at boot and persisted to
// SESSION_SECRET_FILE (see the bootstrap section at the bottom of this
// file) so sessions survive a restart/redeploy instead of everyone getting
// logged out. `purpose` distinguishes a real session token from the
// short-lived pre-2FA `pendingToken`, so one can never be replayed as the
// other even though both are signed with the same secret.
let SESSION_SECRET = null; // set once at boot, before the server starts listening
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PENDING_2FA_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}
function signToken(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
// Returns the parsed payload only if the signature is valid AND
// `purpose` matches — otherwise null. Never throws.
function verifyToken(token, expectedPurpose, maxAgeMs) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const dot = token.lastIndexOf('.');
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
  if (!payload || payload.purpose !== expectedPurpose) return null;
  const now = Date.now();
  if (typeof payload.iat !== 'number' || payload.iat > now || now - payload.iat > maxAgeMs) return null;
  return payload;
}

function signSessionToken(userId) {
  return signToken({ purpose: 'session', userId, iat: Date.now() });
}
function signPendingTotpToken(userId) {
  return signToken({ purpose: '2fa', userId, iat: Date.now() });
}

function setSessionCookie(res, req, token) {
  const isHttps = req.headers['x-forwarded-proto'] === 'https';
  const cookie = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`,
    isHttps ? 'Secure' : '',
  ].filter(Boolean).join('; ');
  res.setHeader('Set-Cookie', cookie);
}

// Looks up the current user fresh from users.json on every call (not just
// once at token-issue time) — this is what makes disabling/deleting a user
// take effect immediately on their very next request, without a
// server-side revocation list. A read/parse failure or a missing
// user/role fails closed (treated as "not authorized"), never crashes.
async function getRequestUser(req) {
  const token = readCookie(req, COOKIE_NAME);
  const payload = token ? verifyToken(token, 'session', SESSION_MAX_AGE_MS) : null;
  if (!payload) return null;
  try {
    const { users, roles } = await readUsersData();
    const user = users.find((u) => u.id === payload.userId);
    if (!user || user.disabled) return null;
    const role = findRole(roles, user.roleId);
    return { user, role };
  } catch (err) {
    return null;
  }
}

// Real middleware (not an inline check inside the handler) so it can run
// BEFORE the body parser — an unauthenticated caller should never pay the
// cost of a large body being parsed before being told "no".
async function requireAuth(req, res, next) {
  const found = await getRequestUser(req);
  if (!found) return res.status(401).json({ error: 'No autorizado' });
  req.currentUser = found.user;
  req.currentRole = found.role;
  next();
}
function requirePermission(key) {
  return async (req, res, next) => {
    const found = await getRequestUser(req);
    if (!found) return res.status(401).json({ error: 'No autorizado' });
    if (!roleHasPermission(found.role, key)) return res.status(403).json({ error: 'No tenés permiso para esto' });
    req.currentUser = found.user;
    req.currentRole = found.role;
    next();
  };
}

// ---------- TOTP (RFC 6238/4226), hand-rolled on Node's built-in crypto —
// no new dependency, matches this project's zero-native-deps stance.
// Verified against the official RFC 6238 Appendix B test vectors before
// being wired in here. ----------
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0, value = 0, output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}
// Tolerant of the ways a human actually copies a secret out of an
// authenticator app or types it back in: mixed case, spaces, "=" padding.
function base32Decode(input) {
  const clean = String(input || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const bytes = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20)); // 160 bits, RFC 4226's recommended minimum
}
function hotp(secretBuffer, counter, digits) {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = crypto.createHmac('sha1', secretBuffer).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  // mask with 0x7fffffff (clear the sign bit) before the modulo — the
  // classic hand-rolled-TOTP bug is skipping this and getting negatives.
  const binary = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  const code = binary % (10 ** digits);
  return String(code).padStart(digits, '0');
}
function totpStepForTime(timeMs) {
  return Math.floor(Math.floor(timeMs / 1000) / TOTP_STEP_SECONDS);
}
// Checks the current step and ±1 (30s each side) for clock drift.
// `lastStep` (persisted per-user) enforces anti-replay: a code is only
// ever accepted once, even within its valid window — without this, a
// single observed code (e.g. by a MITM) could be replayed until the step
// rolls over. Returns the matched step (to be persisted as the new
// lastStep) or null.
function verifyTotpCode(base32Secret, code, lastStep) {
  const secretBuffer = base32Decode(base32Secret);
  if (!secretBuffer.length) return null;
  const cleanCode = String(code || '').trim();
  if (!/^[0-9]{6}$/.test(cleanCode)) return null;
  const currentStep = totpStepForTime(Date.now());
  for (const delta of [0, -1, 1]) {
    const step = currentStep + delta;
    if (lastStep != null && step <= lastStep) continue;
    if (safeEqual(hotp(secretBuffer, step, TOTP_DIGITS), cleanCode)) return step;
  }
  return null;
}

// Per-pendingToken (not just per-IP) brute-force guard for the 2FA code —
// a 6-digit code is only ~10^6 space, and a per-IP-only limiter is trivial
// to evade with a botnet. Keyed by a hash of the token (never the raw
// token itself) so this map can't be used to recover a live token from a
// crash dump. Small and short-lived by construction: pendingTokens expire
// in 5 minutes, so entries are pruned opportunistically on each check
// rather than needing a separate cleanup timer.
const totpPendingAttempts = new Map();
const MAX_TOTP_ATTEMPTS_PER_TOKEN = 8;
function checkAndCountTotpAttempt(rawToken) {
  const key = crypto.createHash('sha256').update(String(rawToken || '')).digest('hex');
  const now = Date.now();
  for (const [k, v] of totpPendingAttempts) {
    if (v.expires < now) totpPendingAttempts.delete(k);
  }
  const entry = totpPendingAttempts.get(key) || { count: 0, expires: now + 10 * 60 * 1000 };
  entry.count += 1;
  totpPendingAttempts.set(key, entry);
  return entry.count <= MAX_TOTP_ATTEMPTS_PER_TOKEN;
}

// Caddy is the only thing that can reach this process, so its
// X-Forwarded-For is trustworthy for one hop. Once Cloudflare is in front,
// prefer its CF-Connecting-IP — but only after checking it looks like an
// actual IP, since we never trust a header's content for a security
// decision without validating its shape first.
const IP_RE = /^[0-9a-fA-F:.]+$/;
function getClientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && IP_RE.test(cf.trim())) return cf.trim();
  return req.ip;
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
// no global body parser — applied per route below, so a big limit for
// uploads doesn't also apply to every other route (see requireAuth above).
const jsonBody = express.json({ limit: '20mb' });

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  message: { error: 'Demasiados intentos, probá de nuevo en un rato.' },
});

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  message: { error: 'Demasiados envíos, probá de nuevo en un rato.' },
});

// ---------- static pages (explicit allowlist — never serve server.js,
// package.json, .env, etc. even though they live in the same folder) ----------
const PAGES = [
  'index.html', 'nosotros.html', 'portfolio.html', 'nobrand.html',
  'blog.html', 'blog-post.html', 'terminos.html', 'privacidad.html', 'admin.html',
  'caso.html',
];
// bare "/" redirects to the custom home slug too, once one is set — so
// there's exactly one working address for home, not two. Only serves
// index.html directly here when no custom slug has been chosen yet.
app.get('/', async (req, res) => {
  const content = await loadMergedContent();
  const homeSlug = (content.slugs || {}).home;
  if (homeSlug) return res.redirect(301, '/' + homeSlug);
  return sendPageFile(res, path.join(ROOT, 'index.html'), content);
});

// pages whose .html path is also reachable through a custom slug (see
// SLUG_PAGE_FILES/content-defaults.js) redirect to whatever that slug
// currently is — so the address bar never shows "/nosotros.html", always
// "/nosotros" (or Erik's custom word), even when nothing's been changed
// from the default.
const SLUGGED_FILES = new Set(Object.values(SLUG_PAGE_FILES));

// Pages that can be switched off from the panel's SEO section while
// they're still being built (e.g. Portfolio, before it has real cases
// loaded) — hidden from the public and from the sitemap, but still
// reachable for whoever's logged into the admin panel, so the team can
// keep working on it before flipping it back on. Home and the admin panel
// itself are excluded on purpose: Home always needs somewhere to resolve
// to, and admin's visibility already works via its secret path.
const TOGGLABLE_PAGES = ['nosotros', 'portfolio', 'nobrand', 'blog', 'terminos', 'privacidad'];
function isPageEnabled(content, key) {
  return !(content.meta && content.meta[key] && content.meta[key].enabled === false);
}
async function canServePage(req, content, key) {
  if (isPageEnabled(content, key)) return true;
  return Boolean(await getRequestUser(req));
}

// Every page route below serves the live HTML fresh from disk (content
// updates go into content.json anyway, fetched separately by the page's own
// JS) — but plain res.sendFile() defaults to `Cache-Control: public,
// max-age=0` plus an ETag/Last-Modified pair, which still leaves it up to
// the browser (or a proxy in between) to decide when to actually revalidate
// on a plain reload. That let more than one deploy in this project go
// unnoticed until a hard refresh. no-store removes that judgment call
// entirely: the page is refetched from the origin every single time.
async function sendPageFile(res, filePath, content) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  // The favicon <link> ships with href="" in the static HTML and gets
  // filled in by the page's own JS after /api/content loads — fine for a
  // real browser, but Google crawls favicons with a separate, lightweight
  // bot that may not run JavaScript at all, so an empty href there could
  // mean it never sees a custom favicon no matter how long it waits.
  // When one's set, patch it into the HTML here so it's already present
  // in the very first response, no JS required.
  const faviconUrl = content && content.logo && content.logo.favicon && typeof content.logo.favicon.url === 'string'
    ? content.logo.favicon.url.trim() : '';
  if (faviconUrl && /^(\/|https?:\/\/|data:)/.test(faviconUrl)) {
    try {
      const html = await fs.readFile(filePath, 'utf8');
      const patched = html.replace(
        '<link rel="icon" id="cms-favicon" href="">',
        '<link rel="icon" id="cms-favicon" href="' + faviconUrl.replace(/"/g, '&quot;') + '">'
      );
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(patched);
    } catch (err) {
      // fall through to the plain sendFile below — a read/patch failure
      // here should never turn into a broken page.
    }
  }
  // Belt and suspenders on top of no-store: skip sendFile's own ETag/
  // Last-Modified entirely, so there's no conditional-request pair left for
  // a browser or an in-between proxy to revalidate against in the first
  // place, however it interprets the Cache-Control above.
  return res.sendFile(filePath, { etag: false, lastModified: false });
}

// blog-post.html and caso.html aren't in SLUG_PAGE_FILES — an individual
// post/caso is addressed by a "?s=" query param, not a page-level custom
// slug — so they're served directly here instead of through the catch-all
// slug resolver below, each gated on its parent section (Blog/Portfolio)
// still being enabled.
app.get('/blog-post.html', async (req, res, next) => {
  const content = await loadMergedContent();
  if (!(await canServePage(req, content, 'blog'))) return next();
  return sendPageFile(res, path.join(ROOT, 'blog-post.html'), content);
});
app.get('/caso.html', async (req, res, next) => {
  const content = await loadMergedContent();
  if (!(await canServePage(req, content, 'portfolio'))) return next();
  return sendPageFile(res, path.join(ROOT, 'caso.html'), content);
});

// admin.html gets no redirect route at all (see the comment on
// SLUG_PAGE_FILES) — a direct request for it just falls through to the
// normal 404, same as any other made-up path.
Object.keys(SLUG_PAGE_FILES).filter((key) => key !== 'admin').forEach((key) => {
  const file = SLUG_PAGE_FILES[key];
  app.get('/' + file, async (req, res) => {
    const content = await loadMergedContent();
    const current = (content.slugs || {})[key];
    const target = key === 'home' ? (current ? '/' + current : '/') : '/' + (current || key);
    const qs = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
    return res.redirect(301, target + qs);
  });
});

// uploaded media, served same-origin so content.json can reference plain
// relative URLs like /media/proyectos/xyz.mp4
app.use('/media', express.static(MEDIA_DIR, { maxAge: '30d' }));

// ---------- /api/content ----------
// shared by the API route and the custom-slug page route below, so both
// always see the same DEFAULT_CONTENT-merged, self-healed view of the data.
async function loadMergedContent() {
  // `saved` stays {} (not caught-and-returned-early) when content.json
  // doesn't exist yet or is corrupt, so the rest of this function — likes
  // included — always runs the same way instead of a fresh install seeing
  // real like counts vanish until the first save. It also means this never
  // hands back the literal DEFAULT_CONTENT object itself, which nothing
  // mutates today but would otherwise be one shared, permanently-mutable
  // singleton if something ever did.
  let saved = {};
  try {
    saved = JSON.parse(await fs.readFile(CONTENT_FILE, 'utf8'));
  } catch (err) {
    saved = {};
  }
  const merged = Object.assign({}, DEFAULT_CONTENT, saved);
  const likes = await readLikes();
  merged.blog = Object.assign({}, DEFAULT_CONTENT.blog, saved.blog, {
    articles: normalizeArticles((saved.blog && saved.blog.articles) || DEFAULT_CONTENT.blog.articles)
      .map((a) => Object.assign({}, a, { likes: Number(likes[a.slug]) || 0 })),
  });
  merged.portfolio = Object.assign({}, DEFAULT_CONTENT.portfolio, saved.portfolio, {
    casos: normalizeCasos((saved.portfolio && saved.portfolio.casos) || DEFAULT_CONTENT.portfolio.casos),
  });
  // shallow Object.assign at the top level means a page added to these
  // two *after* content.json already had a `slugs`/`meta` key of its
  // own would otherwise vanish entirely — merge one level deeper here
  // so a newly-added key (e.g. "admin") always gets its default.
  merged.slugs = Object.assign({}, DEFAULT_CONTENT.slugs, saved.slugs);
  merged.meta = Object.assign({}, DEFAULT_CONTENT.meta, saved.meta);
  // Same reasoning for these — a sub-field added to one of these objects
  // after a site already had it saved (the enabled toggle + copy on
  // quehacemos, the accordion copy on faq, the highlight cards on ia) must
  // still show up.
  merged.faq = Object.assign({}, DEFAULT_CONTENT.faq, saved.faq);
  merged.ia = Object.assign({}, DEFAULT_CONTENT.ia, saved.ia);
  merged.quehacemos = Object.assign({}, DEFAULT_CONTENT.quehacemos, saved.quehacemos);
  merged.logo = Object.assign({}, DEFAULT_CONTENT.logo, saved.logo);
  merged.marcas = Object.assign({}, DEFAULT_CONTENT.marcas, saved.marcas);
  merged.logosBand = Object.assign({}, DEFAULT_CONTENT.logosBand, saved.logosBand);
  merged.logosBand2 = Object.assign({}, DEFAULT_CONTENT.logosBand2, saved.logosBand2);
  merged.testimonios = normalizeTestimonios(saved.testimonios);
  merged.form = Object.assign({}, DEFAULT_CONTENT.form, saved.form, {
    fields: normalizeFormFields(saved.form && saved.form.fields),
  });
  return merged;
}

app.get('/api/content', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const merged = await loadMergedContent();
  return res.status(200).json(merged);
});

// Dotted-path get/set for the permission-scoped merge below. Never a
// generic risk today (CONTENT_PATHS is a static, server-defined map — an
// attacker can't choose which paths get touched, only the values placed
// there), but the setter still refuses to ever write a `__proto__`/
// `constructor`/`prototype` segment, as cheap insurance against this map
// ever being extended carelessly later.
const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
function getPath(obj, dottedPath) {
  return dottedPath.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}
function setPath(obj, dottedPath, value) {
  const parts = dottedPath.split('.');
  if (parts.some((p) => UNSAFE_PATH_SEGMENTS.has(p))) return;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
function matchesType(value, type) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return true;
}

// requireAuth runs before jsonBody here (see the comment on requireAuth) —
// permission enforcement itself happens *inside* the handler below, since
// which paths are writable depends on the request body's own shape, not
// just the route.
app.post('/api/content', requireAuth, jsonBody, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  const body = req.body;
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Contenido inválido' });

  if (body.slugs) {
    const slugErrors = validateSlugs(body.slugs);
    if (slugErrors.length) return res.status(400).json({ error: slugErrors.join(' ') });
  }

  // Likes live in their own file (see readLikes/queueLikesWrite above),
  // never in content.json — strip any copy a client happens to be
  // carrying so a save here can never revert real like counts back to
  // whatever they were when that tab last loaded /api/content.
  if (body.blog && Array.isArray(body.blog.articles)) {
    body.blog.articles.forEach((a) => { if (a && typeof a === 'object') delete a.likes; });
  }

  try {
    const { allAccess, permissions } = permissionsOf(req.currentRole);
    if (allAccess) {
      // owner: unchanged behaviour, save the whole body verbatim.
      await fs.writeFile(CONTENT_FILE, JSON.stringify(body));
      return res.status(200).json({ ok: true });
    }

    // Restricted role: start from the current stored truth, and only
    // overlay the path(s) this role's permissions actually cover — every
    // other path is left exactly as it was, no matter what the client sent.
    let current = {};
    try {
      current = JSON.parse(await fs.readFile(CONTENT_FILE, 'utf8')) || {};
    } catch (err) {
      current = {};
    }
    const entries = [];
    permissions.forEach((key) => {
      (CONTENT_PATHS[key] || []).forEach((spec) => entries.push(spec));
    });
    for (const { path: p, type } of entries) {
      const incoming = getPath(body, p);
      if (incoming === undefined) continue;
      if (!matchesType(incoming, type)) {
        return res.status(400).json({ error: `Valor inválido para "${p}"` });
      }
    }
    entries.forEach(({ path: p }) => {
      const incoming = getPath(body, p);
      if (incoming !== undefined) setPath(current, p, incoming);
    });
    await fs.writeFile(CONTENT_FILE, JSON.stringify(current));
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

app.post('/api/contact', contactLimiter, jsonBody, async (req, res) => {
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
// filenames are always "<timestamp>-<random-base36>.json" (see /api/contact
// below) — anything not matching this exact shape is never trusted enough
// to build a file path from, whether read here or in the move-column route.
const CONSULTA_ID_RE = /^[0-9]+-[a-z0-9]+$/;

app.get('/api/consultas', requirePermission('consultas'), async (req, res) => {
  try {
    const content = await loadMergedContent();
    const columns = (content.kanban && content.kanban.columns) || [];
    const defaultColumnId = columns[0] && columns[0].id;

    const files = await fs.readdir(CONSULTAS_DIR);
    const items = (await Promise.all(
      files.filter((f) => f.endsWith('.json')).map(async (f) => {
        try {
          const text = await fs.readFile(path.join(CONSULTAS_DIR, f), 'utf8');
          const parsed = JSON.parse(text);
          // _id (underscore, like _savedAt elsewhere) so it can never collide
          // with a real form field key — those come from admin-typed labels,
          // never starting with an underscore.
          return Object.assign({ columnId: defaultColumnId }, parsed, { _id: f.slice(0, -'.json'.length) });
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

// ---------- /api/consultas/:id/column (move a card between kanban columns) ----------
app.post('/api/consultas/:id/column', requirePermission('consultas'), jsonBody, async (req, res) => {
  const id = String(req.params.id || '');
  if (!CONSULTA_ID_RE.test(id)) return res.status(400).json({ error: 'Id inválido' });

  const columnId = String((req.body && req.body.columnId) || '');
  if (!columnId) return res.status(400).json({ error: 'Falta la columna' });

  const filePath = path.join(CONSULTAS_DIR, id + '.json');
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const entry = JSON.parse(text);
    entry.columnId = columnId;
    await fs.writeFile(filePath, JSON.stringify(entry));
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'No se encontró la consulta' });
    console.error('move consulta column failed', err);
    return res.status(500).json({ error: 'No se pudo mover la consulta' });
  }
});

// ---------- /api/blog/:slug/like, /api/blog/:slug/set-likes ----------
// Same slug shape the admin already validates in content-defaults.js
// (SLUG_RE) — kept as a local copy rather than importing it, since a like
// only ever needs the shape check, never the reserved-word/collision
// rules that make sense for a *page* slug.
const BLOG_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_LIKES = 10000000;

const likeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  message: { error: 'Demasiados likes, probá de nuevo en un rato.' },
});

// Public, no login — anyone can like a post once per browser (enforced
// client-side via localStorage; this endpoint itself just increments, rate
// limited per IP so it can't be hammered into a fake number in seconds).
app.post('/api/blog/:slug/like', likeLimiter, async (req, res) => {
  const slug = String(req.params.slug || '');
  if (!BLOG_SLUG_RE.test(slug)) return res.status(400).json({ error: 'Artículo inválido' });
  try {
    const likes = await queueLikesWrite((map) => {
      map[slug] = Math.min(MAX_LIKES, (Number(map[slug]) || 0) + 1);
      return map[slug];
    });
    return res.status(200).json({ likes });
  } catch (err) {
    console.error('like failed', err);
    return res.status(500).json({ error: 'No se pudo registrar el like' });
  }
});

// Admin-only — lets Erik set the displayed like count for an article
// directly (e.g. to reflect real engagement seen elsewhere, or just to
// seed a new post) instead of only ever incrementing by one.
app.post('/api/blog/:slug/set-likes', requireAuth, jsonBody, async (req, res) => {
  const slug = String(req.params.slug || '');
  if (!BLOG_SLUG_RE.test(slug)) return res.status(400).json({ error: 'Artículo inválido' });
  const count = Math.round(Number(req.body && req.body.count));
  if (!Number.isFinite(count) || count < 0 || count > MAX_LIKES) {
    return res.status(400).json({ error: 'Número de likes inválido' });
  }
  try {
    await queueLikesWrite((map) => { map[slug] = count; });
    return res.status(200).json({ ok: true, likes: count });
  } catch (err) {
    console.error('set-likes failed', err);
    return res.status(500).json({ error: 'No se pudo guardar' });
  }
});

// ---------- /api/login, /api/login/totp, /api/logout, /api/me ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }

app.post('/api/login', loginLimiter, jsonBody, async (req, res) => {
  const { email, password } = req.body || {};
  const { users } = await readUsersData();
  const user = users.find((u) => u.email === normalizeEmail(email));
  if (!user || user.disabled || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  }
  if (user.totpEnabled) {
    return res.status(200).json({ requireTotp: true, pendingToken: signPendingTotpToken(user.id) });
  }
  setSessionCookie(res, req, signSessionToken(user.id));
  return res.status(200).json({ ok: true });
});

// Second step of login when the user has 2FA enabled — separate, stricter
// rate limit than plain /api/login: a 6-digit code is a much smaller space
// than an arbitrary password, and tracking by the pendingToken itself (not
// just by IP) stops a distributed attacker from evading a per-IP limiter.
app.post('/api/login/totp', loginLimiter, jsonBody, async (req, res) => {
  const { pendingToken, code } = req.body || {};
  if (!checkAndCountTotpAttempt(pendingToken)) {
    return res.status(429).json({ error: 'Demasiados intentos, pedí un login nuevo.' });
  }
  const payload = verifyToken(pendingToken, '2fa', PENDING_2FA_MAX_AGE_MS);
  if (!payload) return res.status(401).json({ error: 'El código expiró, iniciá sesión de nuevo.' });

  const { users, roles } = await readUsersData();
  const user = users.find((u) => u.id === payload.userId);
  if (!user || user.disabled || !user.totpEnabled) return res.status(401).json({ error: 'No autorizado' });

  const step = verifyTotpCode(user.totpSecret, code, user.totpLastStep);
  if (step == null) return res.status(401).json({ error: 'Código inválido' });

  await queueUsersWrite(({ users: list }) => {
    const u = list.find((x) => x.id === user.id);
    if (u) u.totpLastStep = step;
  });
  setSessionCookie(res, req, signSessionToken(user.id));
  return res.status(200).json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res.status(200).json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const { allAccess, permissions } = permissionsOf(req.currentRole);
  return res.status(200).json({
    id: req.currentUser.id,
    name: req.currentUser.name,
    email: req.currentUser.email,
    roleId: req.currentUser.roleId,
    roleLabel: req.currentRole ? req.currentRole.label : null,
    totpEnabled: Boolean(req.currentUser.totpEnabled),
    allAccess,
    permissions,
  });
});

// ---------- self-service: password + 2FA on your own account ----------
const totpConfirmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.currentUser ? req.currentUser.id : getClientIp(req)),
  message: { error: 'Demasiados intentos, probá de nuevo en un rato.' },
});

app.post('/api/me/password', requireAuth, jsonBody, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!(await verifyPassword(currentPassword, req.currentUser.passwordHash))) {
    return res.status(401).json({ error: 'La contraseña actual no es correcta' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'La contraseña nueva tiene que tener al menos 8 caracteres' });
  }
  const newHash = await hashPassword(newPassword);
  await queueUsersWrite(({ users: list }) => {
    const u = list.find((x) => x.id === req.currentUser.id);
    if (u) u.passwordHash = newHash;
  });
  return res.status(200).json({ ok: true });
});

// Generates a new pending secret (not yet enabled) — self-service, so a
// user's own 2FA secret is never seen or set by an admin. Only confirming
// with a real code (below) turns it on.
app.post('/api/me/totp/setup', requireAuth, async (req, res) => {
  const secret = generateTotpSecret();
  await queueUsersWrite(({ users: list }) => {
    const u = list.find((x) => x.id === req.currentUser.id);
    if (u) { u.totpPendingSecret = secret; }
  });
  const label = encodeURIComponent(`Tino Partners:${req.currentUser.email}`);
  const issuer = encodeURIComponent('Tino Partners');
  return res.status(200).json({
    secret,
    otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}`,
  });
});

app.post('/api/me/totp/confirm', requireAuth, totpConfirmLimiter, jsonBody, async (req, res) => {
  const { code } = req.body || {};
  const pendingSecret = req.currentUser.totpPendingSecret;
  if (!pendingSecret) return res.status(400).json({ error: 'No hay una activación de 2FA en curso' });
  const step = verifyTotpCode(pendingSecret, code, null);
  if (step == null) return res.status(401).json({ error: 'Código inválido' });
  await queueUsersWrite(({ users: list }) => {
    const u = list.find((x) => x.id === req.currentUser.id);
    if (u) {
      u.totpSecret = pendingSecret;
      u.totpEnabled = true;
      u.totpLastStep = step;
      delete u.totpPendingSecret;
    }
  });
  return res.status(200).json({ ok: true });
});

app.post('/api/me/totp/disable', requireAuth, jsonBody, async (req, res) => {
  const { password } = req.body || {};
  if (!(await verifyPassword(password, req.currentUser.passwordHash))) {
    return res.status(401).json({ error: 'La contraseña no es correcta' });
  }
  await queueUsersWrite(({ users: list }) => {
    const u = list.find((x) => x.id === req.currentUser.id);
    if (u) { u.totpEnabled = false; delete u.totpSecret; delete u.totpLastStep; delete u.totpPendingSecret; }
  });
  return res.status(200).json({ ok: true });
});

// ---------- user & role management (requirePermission('usuarios.*')) ----------
function publicUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, roleId: u.roleId,
    disabled: Boolean(u.disabled), totpEnabled: Boolean(u.totpEnabled),
  };
}

app.get('/api/users', requirePermission('usuarios.users'), async (req, res) => {
  const { users } = await readUsersData();
  return res.status(200).json({ users: users.map(publicUser) });
});

app.post('/api/users', requirePermission('usuarios.users'), jsonBody, async (req, res) => {
  const { name, email, password, roleId } = req.body || {};
  const cleanEmail = normalizeEmail(email);
  if (!name || !EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'Nombre o email inválido' });
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'La contraseña tiene que tener al menos 8 caracteres' });
  }
  const { roles } = await readUsersData();
  if (!findRole(roles, roleId)) return res.status(400).json({ error: 'Rol inválido' });

  try {
    const passwordHash = await hashPassword(password);
    const created = await queueUsersWrite(({ users: list }) => {
      if (list.some((u) => u.email === cleanEmail)) return null;
      const user = {
        id: crypto.randomUUID(), name: String(name).trim(), email: cleanEmail,
        passwordHash, roleId, disabled: false, totpEnabled: false, createdAt: Date.now(),
      };
      list.push(user);
      return user;
    });
    if (!created) return res.status(409).json({ error: 'Ya existe un usuario con ese email' });
    return res.status(200).json({ user: publicUser(created) });
  } catch (err) {
    console.error('create user failed', err);
    return res.status(500).json({ error: 'No se pudo crear el usuario' });
  }
});

app.post('/api/users/:id', requirePermission('usuarios.users'), jsonBody, async (req, res) => {
  const { id } = req.params;
  const { name, email, roleId, disabled } = req.body || {};
  try {
    let notFound = false;
    let badRole = false;
    const updated = await queueUsersWrite(({ users: list, roles }) => {
      const u = list.find((x) => x.id === id);
      if (!u) { notFound = true; return null; }
      if (roleId !== undefined) {
        if (!findRole(roles, roleId)) { badRole = true; return null; }
        // Block leaving the site with zero allAccess users.
        if (u.roleId !== roleId) {
          const currentIsAllAccess = permissionsOf(findRole(roles, u.roleId)).allAccess;
          const nextIsAllAccess = permissionsOf(findRole(roles, roleId)).allAccess;
          if (currentIsAllAccess && !nextIsAllAccess) {
            const otherAllAccess = list.some((x) => x.id !== id && !x.disabled
              && permissionsOf(findRole(roles, x.roleId)).allAccess);
            if (!otherAllAccess) { badRole = true; return null; }
          }
        }
        u.roleId = roleId;
      }
      if (name !== undefined) u.name = String(name).trim();
      if (email !== undefined) u.email = normalizeEmail(email);
      if (disabled !== undefined) u.disabled = Boolean(disabled);
      return u;
    });
    if (notFound) return res.status(404).json({ error: 'No se encontró el usuario' });
    if (badRole) return res.status(400).json({ error: 'Rol inválido, o dejaría el panel sin ningún usuario con acceso total' });
    return res.status(200).json({ user: publicUser(updated) });
  } catch (err) {
    console.error('update user failed', err);
    return res.status(500).json({ error: 'No se pudo guardar' });
  }
});

app.post('/api/users/:id/reset-password', requirePermission('usuarios.users'), jsonBody, async (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'La contraseña tiene que tener al menos 8 caracteres' });
  }
  const passwordHash = await hashPassword(password);
  let notFound = false;
  await queueUsersWrite(({ users: list }) => {
    const u = list.find((x) => x.id === req.params.id);
    if (!u) { notFound = true; return; }
    u.passwordHash = passwordHash;
  });
  if (notFound) return res.status(404).json({ error: 'No se encontró el usuario' });
  return res.status(200).json({ ok: true });
});

app.post('/api/users/:id/reset-totp', requirePermission('usuarios.users'), async (req, res) => {
  let notFound = false;
  await queueUsersWrite(({ users: list }) => {
    const u = list.find((x) => x.id === req.params.id);
    if (!u) { notFound = true; return; }
    u.totpEnabled = false;
    delete u.totpSecret; delete u.totpLastStep; delete u.totpPendingSecret;
  });
  if (notFound) return res.status(404).json({ error: 'No se encontró el usuario' });
  return res.status(200).json({ ok: true });
});

app.delete('/api/users/:id', requirePermission('usuarios.users'), async (req, res) => {
  let notFound = false;
  let blocked = false;
  await queueUsersWrite(({ users: list, roles }) => {
    const idx = list.findIndex((x) => x.id === req.params.id);
    if (idx === -1) { notFound = true; return; }
    const target = list[idx];
    const isAllAccess = permissionsOf(findRole(roles, target.roleId)).allAccess;
    if (isAllAccess) {
      const otherAllAccess = list.some((x) => x.id !== target.id && !x.disabled
        && permissionsOf(findRole(roles, x.roleId)).allAccess);
      if (!otherAllAccess) { blocked = true; return; }
    }
    list.splice(idx, 1);
  });
  if (notFound) return res.status(404).json({ error: 'No se encontró el usuario' });
  if (blocked) return res.status(400).json({ error: 'No se puede borrar el último usuario con acceso total' });
  return res.status(200).json({ ok: true });
});

app.get('/api/roles', requirePermission('usuarios.roles'), async (req, res) => {
  const { roles } = await readUsersData();
  return res.status(200).json({ roles });
});

// Roles are edited as a batch (see admin.html's role editor — checking
// permission boxes across several roles is a policy decision made over
// several steps, unlike a single user's disabled-toggle) — this replaces
// the whole array at once, validated as a set: the owner role must still
// exist with allAccess intact, and no role still assigned to a user can
// be removed.
app.post('/api/roles', requirePermission('usuarios.roles'), jsonBody, async (req, res) => {
  const incomingRoles = req.body && req.body.roles;
  if (!Array.isArray(incomingRoles)) return res.status(400).json({ error: 'Formato inválido' });

  const seen = new Set();
  for (const r of incomingRoles) {
    if (!r || typeof r.id !== 'string' || typeof r.label !== 'string' || !r.label.trim()) {
      return res.status(400).json({ error: 'Cada rol necesita id y nombre' });
    }
    if (seen.has(r.id)) return res.status(400).json({ error: `El id de rol "${r.id}" está repetido` });
    seen.add(r.id);
  }
  const owner = incomingRoles.find((r) => r.id === 'owner');
  if (!owner || !owner.allAccess) return res.status(400).json({ error: 'El rol Dueño no puede perder el acceso total' });

  try {
    let blockedRoleId = null;
    const saved = await queueUsersWrite((data) => {
      const stillAssigned = new Set(data.users.map((u) => u.roleId));
      for (const existing of data.roles) {
        if (!seen.has(existing.id) && stillAssigned.has(existing.id)) { blockedRoleId = existing.id; return null; }
      }
      data.roles = incomingRoles.map((r) => ({
        id: r.id,
        label: String(r.label).trim(),
        ...(r.id === 'owner' ? { allAccess: true } : { permissions: Array.isArray(r.permissions) ? r.permissions : [] }),
      }));
      return data.roles;
    });
    if (blockedRoleId) return res.status(400).json({ error: `El rol "${blockedRoleId}" todavía tiene usuarios asignados` });
    return res.status(200).json({ roles: saved });
  } catch (err) {
    console.error('save roles failed', err);
    return res.status(500).json({ error: 'No se pudo guardar' });
  }
});

// ---------- /api/upload-media ----------
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024; // images — already client-compressed, stay small
// Raw video, before compression. Kept conservatively under the ~100MB
// request-body ceiling Cloudflare's Free/Pro plans have historically
// enforced at the edge, once base64 inflates it (see videoJsonLimitBytes).
const MAX_VIDEO_UPLOAD_BYTES = 80 * 1024 * 1024;
// Derived from the byte constant above (not a separately-hardcoded string)
// so the two can never drift out of sync with each other.
const videoJsonLimitBytes = Math.ceil(MAX_VIDEO_UPLOAD_BYTES * 4 / 3) + 2 * 1024 * 1024;

// Extension must match the declared contentType, and the file's own first
// bytes must match that type's real signature — a renamed/mislabeled file
// (e.g. an .html file declared as image/png) is rejected either way.
const ALLOWED_TYPES = {
  'image/jpeg': { ext: ['jpg', 'jpeg'], magic: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: ['png'], magic: (b) => b.length >= 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/gif': { ext: ['gif'], magic: (b) => b.length >= 3 && b.slice(0, 3).toString('ascii') === 'GIF' },
  'image/webp': { ext: ['webp'], magic: (b) => b.length >= 12 && b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' },
  // SVG is text, not a binary signature — accept it if the first bytes look
  // like an XML/SVG document at all. sanitizeSvg() below is what actually
  // keeps a malicious upload from doing anything (never trust this magic
  // check alone the way the binary ones can be trusted).
  'image/svg+xml': { ext: ['svg'], magic: (b) => /^\s*(<\?xml|<svg)/i.test(b.slice(0, 300).toString('utf8')) },
  'video/mp4': { ext: ['mp4'], magic: (b) => b.length >= 8 && b.slice(4, 8).toString('ascii') === 'ftyp' },
  'video/quicktime': { ext: ['mov'], magic: (b) => b.length >= 8 && b.slice(4, 8).toString('ascii') === 'ftyp' },
  'video/webm': { ext: ['webm'], magic: (b) => b.length >= 4 && b.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
};

// SVG is served back same-origin under /media — a <script> or an
// on*="..." handler inside an uploaded SVG would run with that origin if
// anyone ever opened the file directly (not just via <img>, which doesn't
// execute it). Strips scripts/handlers/javascript: URIs before the file
// ever touches disk. Regex-based, not a full XML parse — good enough for
// "authenticated CMS user uploads a logo," not a defense against a
// determined attacker who already has panel access (nothing else uploaded
// through this endpoint is sandboxed from them either).
function sanitizeSvg(buffer) {
  let text = buffer.toString('utf8');
  text = text.replace(/<script[\s\S]*?<\/script\s*>/gi, '');
  text = text.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '');
  text = text.replace(/\son\w+\s*=\s*(".*?"|'.*?')/gi, '');
  text = text.replace(/(xlink:href|href)\s*=\s*(".*?"|'.*?')/gi, (m, attr, val) => {
    return /^["']\s*javascript:/i.test(val) ? `${attr}="#"` : m;
  });
  return Buffer.from(text, 'utf8');
}

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  message: { error: 'Demasiadas subidas, probá de nuevo en un rato.' },
});

// Single Node process, no clustering — a plain in-memory counter is enough.
// Only video jobs count against this (a plain image write is instant).
// Checked AFTER express.json() below, since contentType only exists once
// the body is parsed — a rejected request here still pays the parse cost,
// but that's a rare, self-inflicted case (an admin firing several big
// uploads at once), not something worth a header-based pre-parse trick for.
let activeTranscodes = 0;
const MAX_CONCURRENT_TRANSCODES = 2;
function transcodeConcurrencyGuard(req, res, next) {
  const contentType = String((req.body && req.body.contentType) || '');
  if (contentType.toLowerCase().startsWith('video/') && activeTranscodes >= MAX_CONCURRENT_TRANSCODES) {
    return res.status(429).json({ error: 'Ya hay compresiones de video en curso — esperá un momento y probá de nuevo.' });
  }
  next();
}

// Re-encodes to H.264/AAC mp4 regardless of the source container, so every
// video on the site ends up in the one format every browser plays natively.
// -threads 3 (not 4): this VPS also runs other live services, leave a core free.
function runFfmpeg(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y', '-i', inputPath,
      '-vf', "scale='min(1920,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      '-c:v', 'libx264', '-preset', 'faster', '-crf', '26', '-threads', '3',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath,
    ];
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderrTail = '';
    // MUST drain stderr — ffmpeg writes continuous progress output there,
    // and an undrained pipe fills within seconds for any real video,
    // hanging the process until the timeout kills it. Every time, not rarely.
    proc.stderr.on('data', (chunk) => {
      stderrTail += chunk.toString();
      if (stderrTail.length > 4000) stderrTail = stderrTail.slice(-4000);
    });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('timeout')); }, 4 * 60 * 1000);
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('ffmpeg exited with code ' + code + ': ' + stderrTail.slice(-500)));
    });
  });
}

app.post('/api/upload-media', requireAuth, uploadLimiter, express.json({ limit: videoJsonLimitBytes }), transcodeConcurrencyGuard, async (req, res) => {
  const { filename, contentType, dataBase64 } = req.body || {};
  if (!filename || !contentType || !dataBase64) {
    return res.status(400).json({ error: 'Faltan datos del archivo' });
  }
  const spec = ALLOWED_TYPES[String(contentType).toLowerCase()];
  const declaredExt = String(filename).toLowerCase().split('.').pop();
  if (!spec || !spec.ext.includes(declaredExt)) {
    return res.status(400).json({ error: 'Tipo de archivo no permitido' });
  }
  const isVideo = String(contentType).toLowerCase().startsWith('video/');

  const buffer = Buffer.from(dataBase64, 'base64');
  const maxBytes = isVideo ? MAX_VIDEO_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
  if (buffer.length > maxBytes) {
    return res.status(413).json({
      error: isVideo
        ? 'El video es muy pesado (máx ~80MB antes de comprimir). Para algo más grande, pediselo a Claude directamente.'
        : 'El archivo es muy pesado para este uploader (máx ~3MB). Para fotos grandes o videos largos, pediselo a Claude para que lo comprima y lo suba.',
    });
  }
  if (!spec.magic(buffer)) {
    return res.status(400).json({ error: 'El archivo no parece ser realmente del tipo declarado' });
  }
  const isSvg = String(contentType).toLowerCase() === 'image/svg+xml';
  const outBuffer = isSvg ? sanitizeSvg(buffer) : buffer;

  if (!isVideo) {
    const safeName = String(filename).toLowerCase().replace(/[^a-z0-9.\-]+/g, '-').slice(-80);
    const relPath = `uploads/${Date.now()}-${safeName}`;
    const fullPath = path.join(MEDIA_DIR, relPath);
    try {
      await fs.writeFile(fullPath, outBuffer);
      return res.status(200).json({ url: `/media/${relPath}` });
    } catch (err) {
      console.error('upload-media failed', err);
      return res.status(500).json({ error: 'No se pudo subir el archivo' });
    }
  }

  // video path: decode -> compress with ffmpeg -> commit, always ending up
  // as .mp4 regardless of the source container (mov/webm normalize too).
  const uid = crypto.randomUUID();
  const tempInput = path.join(os.tmpdir(), `upload-${uid}.${declaredExt}`);
  const tempOutput = path.join(UPLOADS_DIR, `.tmp-${uid}.mp4`); // same volume as the final path — fs.rename below must not cross filesystems
  const finalRelPath = `uploads/${Date.now()}-${uid}.mp4`;
  const finalFullPath = path.join(MEDIA_DIR, finalRelPath);

  activeTranscodes += 1;
  try {
    await fs.writeFile(tempInput, buffer);
    await runFfmpeg(tempInput, tempOutput);
    const stat = await fs.stat(tempOutput).catch(() => null);
    if (!stat || stat.size === 0) throw new Error('ffmpeg produced an empty file');
    await fs.rename(tempOutput, finalFullPath);
    if (res.headersSent) return; // client already gave up (e.g. a proxy timeout) — nothing to send
    return res.status(200).json({ url: `/media/${finalRelPath}` });
  } catch (err) {
    console.error('video compression failed', err);
    if (res.headersSent) return;
    return res.status(500).json({ error: 'No se pudo comprimir el video. Probá con un archivo más chico, o pediselo a Claude directamente.' });
  } finally {
    activeTranscodes -= 1;
    await fs.unlink(tempInput).catch(() => {});
    await fs.unlink(tempOutput).catch(() => {});
  }
});

// ---------- sitemap.xml / robots.txt ----------
// Excludes terminos/privacidad (already noindex) and admin (its whole point
// is not being discoverable — robots.txt is public, so its real path must
// never appear here). Blog articles and portfolio casos are listed
// individually since crawlers won't otherwise find pages reachable only via
// a client-side fetch + ?s= lookup.
app.get('/sitemap.xml', async (req, res) => {
  const content = await loadMergedContent();
  const slugs = content.slugs || {};
  const origin = req.protocol + '://' + req.get('host');
  const urls = [];
  urls.push(slugs.home || '');
  ['nosotros', 'portfolio', 'nobrand', 'blog'].forEach((key) => {
    if (isPageEnabled(content, key)) urls.push(slugs[key] || key);
  });
  if (isPageEnabled(content, 'blog')) {
    ((content.blog && content.blog.articles) || []).forEach((a) => {
      if (a.slug) urls.push('blog-post.html?s=' + encodeURIComponent(a.slug));
    });
  }
  if (isPageEnabled(content, 'portfolio')) {
    ((content.portfolio && content.portfolio.casos) || []).forEach((c) => {
      if (c.slug) urls.push('caso.html?s=' + encodeURIComponent(c.slug));
    });
  }
  const body = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => '  <url><loc>' + origin + '/' + u + '</loc></url>').join('\n') +
    '\n</urlset>\n';
  res.setHeader('Content-Type', 'application/xml');
  res.send(body);
});

app.get('/robots.txt', async (req, res) => {
  const origin = req.protocol + '://' + req.get('host');
  res.setHeader('Content-Type', 'text/plain');
  res.send(
    'User-agent: *\n' +
    'Allow: /\n' +
    'Disallow: /api/\n' +
    'Sitemap: ' + origin + '/sitemap.xml\n'
  );
});

// ---------- custom page slugs ----------
// Registered last (after every literal route above) so it never shadows
// them and so the 9 existing pages keep resolving by exact match without
// paying for a content.json read. Purely additive: the literal /*.html
// routes above keep working forever — this only adds an extra path that
// serves the same file when its slug matches the one saved in content.json.
app.get('/:seg', async (req, res, next) => {
  const seg = String(req.params.seg || '');
  if (!seg) return next();
  const content = await loadMergedContent();
  const slugs = content.slugs || {};
  const matchKey = Object.keys(SLUG_PAGE_FILES).find((k) => slugs[k] === seg);
  if (!matchKey) return next();
  if (TOGGLABLE_PAGES.includes(matchKey) && !(await canServePage(req, content, matchKey))) return next();
  return sendPageFile(res, path.join(ROOT, SLUG_PAGE_FILES[matchKey]), content);
});

// Global error handler (4 args — Express only calls this shape for
// errors). Catches things like express.json() choking on malformed JSON,
// which would otherwise fall through to Express's default handler and,
// outside NODE_ENV=production, leak a full stack trace to the client.
app.use((err, req, res, next) => {
  console.error('unhandled request error', err);
  if (res.headersSent) return next(err);
  res.status(400).json({ error: 'Solicitud inválida' });
});

// Runs once, synchronously, before the server ever accepts a request —
// never lazily on first request, which would race two simultaneous
// first-requests into both generating/writing a secret. If the file
// exists but can't be read, that's a fatal boot error (crash loudly)
// rather than silently regenerating it: a fresh secret would invalidate
// every existing session on every restart, an availability bug, not just
// a security one.
async function initSessionSecret() {
  try {
    SESSION_SECRET = await fs.readFile(SESSION_SECRET_FILE);
    return;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // exists but unreadable/corrupt — fail loudly
  }
  SESSION_SECRET = crypto.randomBytes(32);
  await fs.writeFile(SESSION_SECRET_FILE, SESSION_SECRET, { mode: 0o600 });
}

// Seeds exactly one owner user from the pre-existing shared ADMIN_TOKEN so
// a deploy of this change keeps working immediately with zero manual
// steps — Erik then renames/changes the password and adds 2FA from the new
// Usuarios panel. Runs once at boot (inside the same startup sequence as
// initSessionSecret), never per-request, so two simultaneous first
// requests can never both create a seed user.
async function bootstrapOwnerUser() {
  if (!process.env.ADMIN_TOKEN) return;
  const existing = await readUsersData(); // never throws — falls back to {users:[],roles:[...]}
  if (existing.users.length) return; // users.json already has real data — never overwrite it
  const passwordHash = await hashPassword(process.env.ADMIN_TOKEN);
  await fs.writeFile(USERS_FILE, JSON.stringify({
    users: [{
      id: crypto.randomUUID(),
      name: 'Admin',
      email: 'admin@tinopartners.com',
      passwordHash,
      roleId: 'owner',
      disabled: false,
      totpEnabled: false,
      createdAt: Date.now(),
    }],
    roles: DEFAULT_ROLES.slice(),
  }));
  console.log('Usuario semilla creado (admin@tinopartners.com, contraseña = ADMIN_TOKEN actual) — cambiala desde el panel de Usuarios apenas entres.');
}

ensureDirs().then(async () => {
  await initSessionSecret();
  await bootstrapOwnerUser();
  sweepStaleTempFiles();
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Tino Partners server listening on :${PORT} (DATA_DIR=${DATA_DIR})`);
  });
  // a video compression request can legitimately run longer than any other
  // route — make sure Node's own timeout doesn't cut it off before the
  // in-app ffmpeg timeout (4 min) ever gets a chance to.
  server.requestTimeout = 5 * 60 * 1000;
  server.headersTimeout = 5 * 60 * 1000 + 5000;
}).catch((err) => {
  console.error('fatal boot error', err);
  process.exit(1);
});
