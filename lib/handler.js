// Shared API logic: runs locally (JSON file storage) and on Vercel (Upstash Redis)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const KEY = 'hours-db';

async function redis(cmd) {
  const r = await fetch(REDIS_URL, { method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}` }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

async function load() {
  let db = null;
  if (REDIS_URL) {
    const raw = await redis(['GET', KEY]);
    if (raw) db = JSON.parse(raw);
  } else {
    try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
  }
  if (!db) db = { people: [{ id: 'self', name: 'Я' }], entries: [], sessions: [] };
  return db;
}
async function save(db) {
  if (REDIS_URL) return void (await redis(['SET', KEY, JSON.stringify(db)]));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

const id = () => crypto.randomBytes(8).toString('hex');
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

function cookieToken(req) {
  const m = /(?:^|;\s*)s=([a-f0-9]+)/.exec(req.headers.cookie || '');
  return m && m[1];
}
function send(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}
// Gmail ignores dots and "+tags" in the part before the @, so those spellings are the same account.
function normalizeEmail(e) {
  let s = String(e || '').trim().toLowerCase().replace(/^["'<]+|["'>]+$/g, '');
  const at = s.lastIndexOf('@');
  if (at < 1) return s;
  let local = s.slice(0, at), domain = s.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '');
  return `${local}@${domain}`;
}
// ALLOWED_EMAILS may be separated by commas, semicolons, spaces or new lines.
const allowedEmails = () => (process.env.ALLOWED_EMAILS || '').split(/[\s,;]+/).map(normalizeEmail).filter(Boolean);

function redirect(res, location, cookies = []) {
  res.writeHead(302, { Location: location, 'Set-Cookie': cookies, 'Cache-Control': 'no-store' });
  res.end();
}
function cookie(name, value, maxAge, req) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}
function redirectUri(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers.host}/api/auth/callback`;
}
function body(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
  });
}

async function api(req, res) {
  const url = req.url.split('?')[0];
  const db = await load();
  if (req.method === 'GET' && url === '/api/auth/google') {
    const state = crypto.randomBytes(16).toString('hex');
    const q = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri(req),
      response_type: 'code',
      scope: 'openid email',
      state,
      prompt: 'select_account',
    });
    return redirect(res, 'https://accounts.google.com/o/oauth2/v2/auth?' + q, [cookie('oauth_state', state, 600, req)]);
  }

  if (req.method === 'GET' && url === '/api/auth/callback') {
    const params = new URL(req.url, 'http://x').searchParams;
    const clearState = cookie('oauth_state', '', 0, req);
    const fail = (why, email) => redirect(res, '/?login_error=' + why, [clearState, ...(email ? [`denied_email=${encodeURIComponent(email)}; SameSite=Lax; Path=/; Max-Age=120`] : [])]);
    const m = /(?:^|;\s*)oauth_state=([a-f0-9]+)/.exec(req.headers.cookie || '');
    if (!params.get('code') || !m || m[1] !== params.get('state')) return fail('failed');
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: params.get('code'),
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    const tok = await r.json();
    if (!tok.id_token) return fail('failed');
    // The token comes straight from Google over TLS, so decoding without a signature check is safe here.
    const claims = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString());
    if (claims.aud !== process.env.GOOGLE_CLIENT_ID) return fail('failed');
    // The address Google reports is shown on the denial page (in a short-lived cookie, not in the URL) to make mismatches easy to spot.
    if (!claims.email_verified || !allowedEmails().includes(normalizeEmail(claims.email))) return fail('denied', claims.email);
    const token = crypto.randomBytes(24).toString('hex');
    db.sessions.push(hash(token));
    db.sessions = db.sessions.slice(-50);
    await save(db);
    return redirect(res, '/', [clearState, cookie('s', token, 31536000, req)]);
  }

  const t = cookieToken(req);
  if (!t || !db.sessions.includes(hash(t))) return send(res, 401, { error: 'auth' });
  if (req.method === 'POST' && url === '/api/logout') {
    db.sessions = db.sessions.filter((h) => h !== hash(t));
    await save(db);
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('s', '', 0, req) });
  }
  if (req.method === 'GET' && url === '/api/data') return send(res, 200, { people: db.people, entries: db.entries });

  // Validates the fields of an entry; returns an error code or null.
  const checkEntry = ({ personId, date, minutes }) => {
    if (!db.people.some((p) => p.id === personId)) return 'unknown_person';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'bad_date';
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 24 * 60) return 'bad_minutes';
    return null;
  };

  if (req.method === 'POST' && url === '/api/entries') {
    const { personId, date, minutes } = await body(req);
    const bad = checkEntry({ personId, date, minutes });
    if (bad) return send(res, 400, { error: bad });
    const e = { id: id(), personId, date, minutes, created: new Date().toISOString() };
    db.entries.push(e);
    await save(db);
    return send(res, 200, e);
  }
  let m;
  if (req.method === 'PUT' && (m = /^\/api\/entries\/(\w+)$/.exec(url))) {
    const e = db.entries.find((x) => x.id === m[1]);
    if (!e) return send(res, 404, { error: 'not_found' });
    const { personId, date, minutes } = await body(req);
    const bad = checkEntry({ personId, date, minutes });
    if (bad) return send(res, 400, { error: bad });
    Object.assign(e, { personId, date, minutes });
    await save(db);
    return send(res, 200, e);
  }
  if (req.method === 'DELETE' && (m = /^\/api\/entries\/(\w+)$/.exec(url))) {
    db.entries = db.entries.filter((e) => e.id !== m[1]);
    await save(db);
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url === '/api/people') {
    const input = await body(req);
    const name = String(input.name || '').trim().slice(0, 60);
    const role = String(input.role || '').trim().slice(0, 60); // position, e.g. "piano teacher"
    if (!name) return send(res, 400, { error: 'empty_name' });
    if (db.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) return send(res, 400, { error: 'duplicate_person' });
    const p = { id: id(), name, role };
    db.people.push(p);
    await save(db);
    return send(res, 200, p);
  }
  if (req.method === 'PUT' && (m = /^\/api\/people\/(\w+)$/.exec(url))) {
    const p = db.people.find((x) => x.id === m[1]);
    if (!p) return send(res, 404, { error: 'not_found' });
    const input = await body(req);
    const role = String(input.role || '').trim().slice(0, 60);
    if (p.id !== 'self') { // the owner's own name is not editable
      const name = String(input.name || '').trim().slice(0, 60);
      if (!name) return send(res, 400, { error: 'empty_name' });
      if (db.people.some((x) => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase())) return send(res, 400, { error: 'duplicate_person' });
      p.name = name;
    }
    p.role = role;
    await save(db);
    return send(res, 200, p);
  }
  if (req.method === 'DELETE' && (m = /^\/api\/people\/(\w+)$/.exec(url))) {
    if (m[1] === 'self') return send(res, 400, { error: 'cannot_delete_self' });
    db.people = db.people.filter((p) => p.id !== m[1]);
    db.entries = db.entries.filter((e) => e.personId !== m[1]);
    await save(db);
    return send(res, 200, { ok: true });
  }
  send(res, 404, { error: 'not_found' });
}

module.exports = async (req, res) => {
  try { await api(req, res); } catch (e) { console.error(e); send(res, 500, { error: 'server_error' }); }
};
module.exports.load = load;
module.exports.normalizeEmail = normalizeEmail;
module.exports.allowedEmails = allowedEmails;
