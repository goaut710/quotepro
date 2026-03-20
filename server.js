// ============================================================
//  QuotePro – server.js  (compatible con Node.js v24)
//  Usa sql.js en lugar de better-sqlite3
// ============================================================

const express     = require('express');
const session     = require('express-session');
const bcrypt      = require('bcryptjs');
const path        = require('path');
const cors        = require('cors');
const fs          = require('fs');
const initSqlJs   = require('sql.js');

const app  = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'db', 'quotepro.db');

// ─── Ensure db folder exists ─────────────────────────────────
if (!fs.existsSync(path.join(__dirname, 'db'))) {
  fs.mkdirSync(path.join(__dirname, 'db'));
}

// ─── Middleware ───────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'quotepro_secret_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ─── Auth Middleware ──────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'No autorizado' });
}

// ─── DB helpers ───────────────────────────────────────────────
let db;

function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function runSql(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

function querySql(sql, params = []) {
  const stmt   = db.prepare(sql);
  const rows   = [];
  stmt.bind(params);
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push(row);
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = querySql(sql, params);
  return rows[0] || null;
}

function getLastId() {
  const row = queryOne('SELECT last_insert_rowid() as id');
  return row ? row.id : null;
}

// ─── Init DB ──────────────────────────────────────────────────
async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      company    TEXT DEFAULT 'Mi Empresa S.A.',
      address    TEXT DEFAULT 'Dirección de la empresa',
      phone      TEXT DEFAULT '+502 0000 0000',
      email      TEXT DEFAULT 'empresa@email.com',
      tax_rate   REAL DEFAULT 12,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS quotes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      quote_num    TEXT NOT NULL,
      client_name  TEXT NOT NULL,
      client_phone TEXT DEFAULT '',
      client_email TEXT DEFAULT '',
      items        TEXT NOT NULL,
      subtotal     REAL NOT NULL,
      tax          REAL NOT NULL,
      total        REAL NOT NULL,
      notes        TEXT DEFAULT '',
      status       TEXT DEFAULT 'pendiente',
      created_at   TEXT DEFAULT (datetime('now'))
    )
  `);

  saveDb();

  // Seed admin user
  const existing = queryOne('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!existing) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.run(
      `INSERT INTO users (username, password, company, address, phone, email)
       VALUES (?, ?, 'QuotePro Demo', 'Av. Principal 123, Ciudad', '+502 1234 5678', 'demo@quotepro.com')`,
      ['admin', hash]
    );
    saveDb();
  }

  console.log('✅  Base de datos lista');
}

// ─── AUTH ROUTES ─────────────────────────────────────────────

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = queryOne('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  req.session.userId   = user.id;
  req.session.username = user.username;
  res.json({ ok: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = queryOne(
    'SELECT id,username,company,address,phone,email,tax_rate FROM users WHERE id=?',
    [req.session.userId]
  );
  res.json(user);
});

app.put('/api/me', requireAuth, (req, res) => {
  const { company, address, phone, email, tax_rate } = req.body;
  runSql(
    'UPDATE users SET company=?,address=?,phone=?,email=?,tax_rate=? WHERE id=?',
    [company, address, phone, email, tax_rate, req.session.userId]
  );
  res.json({ ok: true });
});

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Datos incompletos' });
  const exists = queryOne('SELECT id FROM users WHERE username=?', [username]);
  if (exists) return res.status(400).json({ error: 'El usuario ya existe' });
  const hash = bcrypt.hashSync(password, 10);
  db.run('INSERT INTO users (username, password) VALUES (?,?)', [username, hash]);
  saveDb();
  res.json({ ok: true });
});

// ─── QUOTES ROUTES ───────────────────────────────────────────

app.get('/api/quotes', requireAuth, (req, res) => {
  const { search } = req.query;
  let sql    = 'SELECT id,quote_num,client_name,client_email,total,status,created_at FROM quotes WHERE user_id=?';
  const params = [req.session.userId];
  if (search) {
    sql += ' AND (client_name LIKE ? OR quote_num LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY id DESC';
  res.json(querySql(sql, params));
});

app.get('/api/quotes/:id', requireAuth, (req, res) => {
  const row = queryOne('SELECT * FROM quotes WHERE id=? AND user_id=?', [req.params.id, req.session.userId]);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  row.items = JSON.parse(row.items);
  res.json(row);
});

app.post('/api/quotes', requireAuth, (req, res) => {
  const { client_name, client_phone, client_email, items, subtotal, tax, total, notes, status } = req.body;

  const last = queryOne("SELECT quote_num FROM quotes WHERE user_id=? ORDER BY id DESC LIMIT 1", [req.session.userId]);
  let nextNum = 1;
  if (last) {
    const match = last.quote_num.match(/(\d+)$/);
    if (match) nextNum = parseInt(match[1]) + 1;
  }
  const quote_num = `COT-${String(nextNum).padStart(4, '0')}`;

  db.run(
    `INSERT INTO quotes (user_id,quote_num,client_name,client_phone,client_email,items,subtotal,tax,total,notes,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [req.session.userId, quote_num, client_name, client_phone || '', client_email || '',
     JSON.stringify(items), subtotal, tax, total, notes || '', status || 'pendiente']
  );
  saveDb();
  const id = getLastId();
  res.json({ ok: true, id, quote_num });
});

app.put('/api/quotes/:id', requireAuth, (req, res) => {
  const { client_name, client_phone, client_email, items, subtotal, tax, total, notes, status } = req.body;
  const existing = queryOne('SELECT id FROM quotes WHERE id=? AND user_id=?', [req.params.id, req.session.userId]);
  if (!existing) return res.status(404).json({ error: 'No encontrada' });
  runSql(
    `UPDATE quotes SET client_name=?,client_phone=?,client_email=?,items=?,subtotal=?,tax=?,total=?,notes=?,status=? WHERE id=?`,
    [client_name, client_phone || '', client_email || '', JSON.stringify(items), subtotal, tax, total, notes || '', status, req.params.id]
  );
  res.json({ ok: true });
});

app.delete('/api/quotes/:id', requireAuth, (req, res) => {
  runSql('DELETE FROM quotes WHERE id=? AND user_id=?', [req.params.id, req.session.userId]);
  res.json({ ok: true });
});

// ─── PDF GENERATION ──────────────────────────────────────────
app.post('/api/pdf', requireAuth, (req, res) => {
  const { quote_num, client_name, client_phone, client_email, items, subtotal, tax, total, notes, status, company, address, phone, email, tax_rate, date } = req.body;

  const fmt = n => `Q ${Number(n||0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const statusColor = status === 'aprobada' ? '#d1fae5' : status === 'rechazada' ? '#fee2e2' : '#fef3c7';
  const statusText  = status === 'aprobada' ? '#065f46' : status === 'rechazada' ? '#991b1b' : '#92400e';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Cotización ${esc(quote_num)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; color: #111; background: #fff; padding: 32px; max-width: 794px; margin: auto; font-size: 13px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; border-bottom: 2px solid #e63329; padding-bottom: 18px; }
  .quote-title { font-size: 26px; font-weight: 800; color: #e63329; }
  .client-box { background: #f8f8f8; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  thead tr { background: #111; color: #fff; }
  th, td { padding: 8px 10px; text-align: left; }
  th:not(:first-child), td:not(:first-child) { text-align: right; }
  tr:nth-child(even) td { background: #f8f8f8; }
  td { border-bottom: 1px solid #eee; }
  .totals { display: flex; justify-content: flex-end; margin-bottom: 20px; }
  .totals-box { width: 220px; }
  .t-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #eee; color: #555; }
  .t-total { background: #e63329; color: #fff; padding: 8px 10px; border-radius: 6px; display: flex; justify-content: space-between; font-size: 15px; font-weight: 700; margin-top: 6px; }
  .sigs { display: flex; justify-content: space-around; margin-top: 36px; padding-top: 24px; border-top: 1px solid #eee; }
  .sig { width: 140px; border-top: 1.5px solid #333; padding-top: 6px; font-size: 11px; color: #555; text-align: center; }
  .footer { text-align: center; margin-top: 20px; font-size: 10px; color: #bbb; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<div class="header">
  <div>
    <div style="font-size:17px;font-weight:700;">${esc(company)}</div>
    <div style="font-size:11px;color:#555;margin-top:3px;">${esc(address)}</div>
    <div style="font-size:11px;color:#555;">${esc(phone)}${email?' · '+esc(email):''}</div>
  </div>
  <div style="text-align:right;">
    <div class="quote-title">COTIZACIÓN</div>
    <div style="font-size:16px;font-weight:700;font-family:monospace;">${esc(quote_num)}</div>
    <div style="font-size:11px;color:#555;">Fecha: ${esc(date||'')}</div>
    <span style="display:inline-block;margin-top:4px;background:${statusColor};color:${statusText};padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700;text-transform:uppercase;">${esc(status)}</span>
  </div>
</div>

<div class="client-box">
  <div style="font-size:9px;font-weight:700;letter-spacing:1.5px;color:#888;margin-bottom:6px;">DATOS DEL CLIENTE</div>
  <div style="font-size:14px;font-weight:700;">${esc(client_name)}</div>
  ${client_phone?`<div style="font-size:12px;color:#555;">${esc(client_phone)}</div>`:''}
  ${client_email?`<div style="font-size:12px;color:#555;">${esc(client_email)}</div>`:''}
</div>

<table>
  <thead><tr><th>Descripción</th><th>Cant.</th><th>Precio</th><th>Desc.</th><th>Total</th></tr></thead>
  <tbody>
    ${(items||[]).map((i,idx)=>`<tr><td>${esc(i.desc)}</td><td style="text-align:right">${i.qty}</td><td style="text-align:right;font-family:monospace">${fmt(i.price)}</td><td style="text-align:right">${i.disc||0}%</td><td style="text-align:right;font-family:monospace;font-weight:700">${fmt(i.total)}</td></tr>`).join('')}
  </tbody>
</table>

<div class="totals">
  <div class="totals-box">
    <div class="t-row"><span>Subtotal</span><span style="font-family:monospace">${fmt(subtotal)}</span></div>
    <div class="t-row"><span>IVA (${tax_rate||12}%)</span><span style="font-family:monospace">${fmt(tax)}</span></div>
    <div class="t-total"><span>TOTAL</span><span style="font-family:monospace">${fmt(total)}</span></div>
  </div>
</div>

${notes?`<div style="background:#f8f8f8;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:12px;color:#444;"><div style="font-size:9px;font-weight:700;letter-spacing:1.5px;color:#888;margin-bottom:6px;">NOTAS</div>${esc(notes)}</div>`:''}

<div class="sigs">
  <div><div class="sig">Firma Cliente</div></div>
  <div><div class="sig">Firma Técnico / Vendedor</div></div>
</div>

<div class="footer">Generado con QuotePro · ${new Date().toLocaleString()}</div>
</body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${quote_num}.html"`);
  res.send(html);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => console.log(`✅  QuotePro corriendo en http://localhost:${PORT}`));
}).catch(err => {
  console.error('Error iniciando DB:', err);
});
