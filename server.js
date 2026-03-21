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
  let payload;
  try { payload = JSON.parse(req.body.data || '{}'); }
  catch(e) { return res.status(400).send('Datos inválidos'); }

  const { quote_num, client_name, client_phone, client_email, items, subtotal, tax, total, notes, status, company, address, phone, email, tax_rate, date, signature } = payload;

  // Fixed company logo (Constructora D'Sanchez)
  const LOGO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAHIAbADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8qqKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKADFLtoxS5o0ATbRtpefQ0Ux6Cba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';

  const fmt = n => `Q ${Number(n||0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const statusColor = status === 'aprobada' ? '#d1fae5' : status === 'rechazada' ? '#fee2e2' : '#fef3c7';
  const statusText  = status === 'aprobada' ? '#065f46' : status === 'rechazada' ? '#991b1b' : '#92400e';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Cotización ${esc(quote_num)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;color:#111;background:#f0f0f0;padding:16px;font-size:13px}
.save-bar{background:#1a1a1a;padding:12px 18px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px;border-radius:8px;max-width:794px;margin-left:auto;margin-right:auto}
.save-btn{background:#e63329;color:#fff;border:none;border-radius:6px;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer}
.back-btn{background:#444;color:#fff;border:none;border-radius:6px;padding:10px 16px;font-size:13px;cursor:pointer}
.doc{background:#fff;padding:32px;max-width:794px;margin:0 auto;border-radius:8px;box-shadow:0 2px 16px rgba(0,0,0,0.1)}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:16px;border-bottom:3px solid #e63329;gap:12px;flex-wrap:wrap}
.logo-wrap{display:flex;align-items:center;gap:14px}
.logo-img{width:72px;height:72px;object-fit:contain;border-radius:6px;border:1px solid #eee}
.co-name{font-size:17px;font-weight:800;color:#111;margin-bottom:4px}
.co-info{font-size:11px;color:#666;line-height:1.6}
.q-label{font-size:28px;font-weight:900;color:#e63329;letter-spacing:-1px;text-align:right}
.q-num{font-size:15px;font-weight:700;font-family:monospace;text-align:right;margin-top:2px;color:#333}
.q-date{font-size:11px;color:#666;text-align:right;margin-top:2px}
.pill{display:inline-block;margin-top:6px;padding:3px 12px;border-radius:20px;font-size:10px;font-weight:700;text-transform:uppercase}
.to-box{background:#f7f7f7;border-radius:8px;padding:14px 18px;margin-bottom:16px;border-left:4px solid #e63329}
.to-lbl{font-size:9px;font-weight:700;letter-spacing:2px;color:#aaa;margin-bottom:6px;text-transform:uppercase}
.to-name{font-size:15px;font-weight:700;color:#111}
.to-info{font-size:12px;color:#666;margin-top:3px}
.greeting{font-size:12px;color:#555;margin-bottom:14px;font-style:italic;padding:0 2px}
table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px;border:1.5px solid #333}
thead tr{background:#111;color:#fff}
th{padding:10px 12px;text-align:left;font-weight:600;font-size:11px;letter-spacing:0.5px;border:1px solid #444}
th:not(:first-child){text-align:right}
td{padding:9px 12px;border:1px solid #ccc;color:#333}
td:not(:first-child){text-align:right}
tr:nth-child(even) td{background:#f9f9f9}
.totals{display:flex;justify-content:flex-end;margin-bottom:16px}
.tbox{width:240px}
.tr{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #eee;font-size:13px;color:#666}
.tt{background:#e63329;color:#fff;padding:10px 14px;border-radius:6px;display:flex;justify-content:space-between;font-size:15px;font-weight:700;margin-top:8px}
.notes-box{background:#f7f7f7;border-radius:6px;padding:12px 16px;margin-bottom:18px;font-size:12px;color:#555}
.nl{font-size:9px;font-weight:700;letter-spacing:2px;color:#aaa;margin-bottom:5px;text-transform:uppercase}
.sigs{display:flex;gap:20px;margin-top:30px;padding-top:18px;border-top:1px solid #eee}
.sig-box{flex:1;text-align:center}
.sig-img{max-width:160px;max-height:68px;object-fit:contain;display:block;margin:0 auto 8px}
.sig-empty{height:68px;border:1.5px dashed #ddd;border-radius:6px;margin-bottom:8px}
.sig-line{border-top:1.5px solid #333;padding-top:7px;font-size:11px;color:#444;font-weight:600}
.sig-sub{font-size:10px;color:#aaa;margin-top:2px}
.footer{text-align:center;margin-top:16px;font-size:10px;color:#ccc;padding-bottom:8px}
@media print{.save-bar{display:none}body{background:#fff;padding:0}.doc{box-shadow:none;border-radius:0;padding:20px}}
</style>
</head>
<body>

<div class="save-bar">
  <button class="back-btn" onclick="history.back()">← Volver</button>
  <span style="color:#888;font-size:11px">PC: Imprimir → Guardar como PDF &nbsp;·&nbsp; Cel: Menú → Imprimir</span>
  <button class="save-btn" onclick="window.print()">🖨️ Guardar PDF</button>
</div>

<div class="doc">
  <div class="header">
    <div class="logo-wrap">
      <img src="${LOGO}" class="logo-img" alt="Logo Constructora D'Sanchez"/>
      <div>
        <div class="co-name">${esc(company||"Constructora D'Sanchez")}</div>
        <div class="co-info">
          ${esc(address||'')}<br>
          ${esc(phone||'')}${phone&&email?' &nbsp;|&nbsp; ':''}${esc(email||'')}
        </div>
      </div>
    </div>
    <div>
      <div class="q-label">Cotización</div>
      <div class="q-num">${esc(quote_num)}</div>
      <div class="q-date">Fecha: ${esc(date||'')}</div>
      <div style="text-align:right">
        <span class="pill" style="background:${statusColor};color:${statusText}">${esc(status)}</span>
      </div>
    </div>
  </div>

  <div class="to-box">
    <div class="to-lbl">Estimado Cliente</div>
    <div class="to-name">${esc(client_name)}</div>
    ${client_phone?`<div class="to-info">📞 ${esc(client_phone)}</div>`:''}
    ${client_email?`<div class="to-info">✉️ ${esc(client_email)}</div>`:''}
  </div>

  <p class="greeting">Nos complace presentarle la siguiente cotización de servicios. Quedamos a su disposición para cualquier consulta.</p>

  <table>
    <thead>
      <tr>
        <th>Descripción del Servicio</th>
        <th>Cant.</th>
        <th>Precio Unit.</th>
        <th>Desc.</th>
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      ${(items||[]).map((i,idx)=>`
      <tr>
        <td>${esc(i.desc)}</td>
        <td>${i.qty}</td>
        <td style="font-family:monospace">${fmt(i.price)}</td>
        <td>${i.disc||0}%</td>
        <td style="font-family:monospace;font-weight:700">${fmt(i.total)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="tbox">
      <div class="tr"><span>Subtotal</span><span style="font-family:monospace">${fmt(subtotal)}</span></div>
      <div class="tr"><span>IVA (${tax_rate||12}%)</span><span style="font-family:monospace">${fmt(tax)}</span></div>
      <div class="tt"><span>GRAND TOTAL</span><span style="font-family:monospace">${fmt(total)}</span></div>
    </div>
  </div>

  ${notes?`<div class="notes-box"><div class="nl">Términos y Condiciones</div>${esc(notes)}</div>`:''}

  <div class="sigs">
    <div class="sig-box">
      ${signature?`<img src="${signature}" class="sig-img" alt="Firma autorizada"/>`:'<div class="sig-empty"></div>'}
      <div class="sig-line">Firma Autorizada</div>
      <div class="sig-sub">${esc(company||"Constructora D'Sanchez")}</div>
    </div>
    <div class="sig-box">
      <div class="sig-empty"></div>
      <div class="sig-line">Firma Cliente</div>
      <div class="sig-sub">${esc(client_name)}</div>
    </div>
  </div>

  <div class="footer">Generado con QuotePro &nbsp;·&nbsp; ${new Date().toLocaleString('es-GT')}</div>
</div>

</body></html>`);
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
