// =========================================================
//  مدارك الطفل — خادم تخزين البيانات
//  تخزين key→value في SQLite + مزامنة لحظية عبر SSE
//  يحل محل Firebase. كل مجموعة (children, subscriptions, ...)
//  تُحفظ كصف واحد، فحفظ مجموعة لا يلمس الباقي.
// =========================================================
const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN = process.env.API_TOKEN || '';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');
const BODY_LIMIT = process.env.BODY_LIMIT || '30mb'; // يكفي للمرفقات base64

if (!TOKEN) {
  console.error('[madarek-api] ⚠️  API_TOKEN غير محدد — اضبطه في متغيرات البيئة قبل التشغيل.');
  process.exit(1);
}

// ---------- قاعدة البيانات ----------
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER)');

const qGetAll = db.prepare('SELECT key, value FROM kv');
const qUpsert = db.prepare(
  'INSERT INTO kv(key, value, updated_at) VALUES(?, ?, ?) ' +
  'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
);

// ---------- التطبيق ----------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: BODY_LIMIT }));

// توثيق بسيط بالتوكن (Bearer أو ?token=)
function auth(req, res, next) {
  const h = req.get('authorization') || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || '');
  if (t !== TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// ---------- مزامنة لحظية (SSE) ----------
const clients = new Map(); // clientId -> res

app.get('/api/stream', auth, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // مهم: يمنع nginx من حجز البث
  });
  res.flushHeaders();
  const id = (req.query.clientId || crypto.randomUUID()).toString();
  clients.set(id, res);
  res.write('retry: 3000\n');
  res.write(`event: ready\ndata: ${JSON.stringify({ clientId: id })}\n\n`);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(id); });
});

function broadcast(key, value, exceptId) {
  const payload = `data: ${JSON.stringify({ key, value })}\n\n`;
  for (const [id, res] of clients) {
    if (id === exceptId) continue;
    try { res.write(payload); } catch (e) { clients.delete(id); }
  }
}

// ---------- قراءة كل البيانات (تحميل أولي) ----------
app.get('/api/data', auth, (req, res) => {
  const out = {};
  for (const row of qGetAll.all()) {
    try { out[row.key] = JSON.parse(row.value); } catch (e) {}
  }
  res.json(out);
});

// ---------- حفظ مجموعة واحدة ----------
app.put('/api/data/:key', auth, (req, res) => {
  const key = String(req.params.key || '').slice(0, 100);
  if (!key) return res.status(400).json({ error: 'missing key' });
  const value = (req.body && Object.prototype.hasOwnProperty.call(req.body, '__value'))
    ? req.body.__value
    : req.body;
  let str;
  try { str = JSON.stringify(value); } catch (e) { return res.status(400).json({ error: 'bad value' }); }
  qUpsert.run(key, str, Date.now());
  broadcast(key, value, req.get('x-client-id') || '');
  res.json({ ok: true });
});

// ---------- نقل جماعي (للترحيل من Firebase دفعة واحدة) ----------
app.post('/api/bulk', auth, (req, res) => {
  const obj = req.body || {};
  const now = Date.now();
  const tx = db.transaction((entries) => {
    for (const [k, v] of entries) qUpsert.run(k, JSON.stringify(v), now);
  });
  const entries = Object.entries(obj);
  tx(entries);
  for (const [k, v] of entries) broadcast(k, v, req.get('x-client-id') || '');
  res.json({ ok: true, count: entries.length });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, keys: qGetAll.all().length, clients: clients.size });
});

app.listen(PORT, HOST, () => {
  console.log(`[madarek-api] يعمل على http://${HOST}:${PORT} — قاعدة البيانات: ${DB_PATH}`);
});
