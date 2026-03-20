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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => console.log(`✅  QuotePro corriendo en http://localhost:${PORT}`));
}).catch(err => {
  console.error('Error iniciando DB:', err);
});
