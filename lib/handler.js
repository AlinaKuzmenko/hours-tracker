// Shared API logic: runs locally (JSON file storage) and on Vercel (Upstash Redis)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const KEY = 'hours-db';

const WORDS = ['сонце', 'річка', 'яблуко', 'піаніно', 'зірка', 'липа', 'мед', 'вишня', 'весна', 'море', 'гора', 'хліб', 'дощ', 'калина'];

function normPhrase(s) {
  return String(s || '').toLowerCase().replace(/[’ʼ`]/g, "'").replace(/[^\p{L}\p{N}']+/gu, ' ').trim();
}

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
  if (!db) db = { people: [{ id: 'self', name: 'Я' }], entries: [], sessions: [], failures: 0, lockedUntil: 0 };
  if (!process.env.PASSPHRASE && !db.passphrase) {
    const pick = () => WORDS[crypto.randomInt(WORDS.length)];
    db.passphrase = `${pick()} ${pick()} ${pick()}`;
    await save(db);
  }
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
  const PASSPHRASE = normPhrase(process.env.PASSPHRASE || db.passphrase);

  if (req.method === 'POST' && url === '/api/login') {
    if (Date.now() < (db.lockedUntil || 0)) return send(res, 429, { error: 'Забагато спроб. Зачекайте хвилину і спробуйте ще раз.' });
    const { phrase } = await body(req);
    if (normPhrase(phrase) === PASSPHRASE) {
      const token = crypto.randomBytes(24).toString('hex');
      db.sessions.push(hash(token));
      db.sessions = db.sessions.slice(-50);
      db.failures = 0;
      await save(db);
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return send(res, 200, { ok: true }, { 'Set-Cookie': `s=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure}` });
    }
    db.failures = (db.failures || 0) + 1;
    if (db.failures >= 5) { db.lockedUntil = Date.now() + 60000; db.failures = 0; }
    await save(db);
    return send(res, 401, { error: 'Фраза не підійшла. Спробуйте ще раз.' });
  }

  const t = cookieToken(req);
  if (!t || !db.sessions.includes(hash(t))) return send(res, 401, { error: 'auth' });
  if (req.method === 'POST' && url === '/api/logout') {
    db.sessions = db.sessions.filter((h) => h !== hash(t));
    await save(db);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 's=; HttpOnly; Path=/; Max-Age=0' });
  }
  if (req.method === 'GET' && url === '/api/data') return send(res, 200, { people: db.people, entries: db.entries });

  if (req.method === 'POST' && url === '/api/entries') {
    const { personId, date, minutes } = await body(req);
    if (!db.people.some((p) => p.id === personId)) return send(res, 400, { error: 'Невідома людина' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: 'Некоректна дата' });
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 24 * 60) return send(res, 400, { error: 'Некоректний час' });
    const e = { id: id(), personId, date, minutes, created: new Date().toISOString() };
    db.entries.push(e);
    await save(db);
    return send(res, 200, e);
  }
  let m;
  if (req.method === 'DELETE' && (m = /^\/api\/entries\/(\w+)$/.exec(url))) {
    db.entries = db.entries.filter((e) => e.id !== m[1]);
    await save(db);
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url === '/api/people') {
    const name = String((await body(req)).name || '').trim().slice(0, 60);
    if (!name) return send(res, 400, { error: 'Порожнє імʼя' });
    if (db.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) return send(res, 400, { error: 'Така людина вже є' });
    const p = { id: id(), name };
    db.people.push(p);
    await save(db);
    return send(res, 200, p);
  }
  if (req.method === 'DELETE' && (m = /^\/api\/people\/(\w+)$/.exec(url))) {
    if (m[1] === 'self') return send(res, 400, { error: 'Себе видалити не можна' });
    db.people = db.people.filter((p) => p.id !== m[1]);
    db.entries = db.entries.filter((e) => e.personId !== m[1]);
    await save(db);
    return send(res, 200, { ok: true });
  }
  send(res, 404, { error: 'Не знайдено' });
}

module.exports = async (req, res) => {
  try { await api(req, res); } catch (e) { console.error(e); send(res, 500, { error: 'Помилка сервера' }); }
};
module.exports.load = load;
