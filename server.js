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
app.get('/api/pdf', requireAuth, (req, res) => {
  let payload;
  try { payload = JSON.parse(decodeURIComponent(req.query.data || '{}')); }
  catch(e) { return res.status(400).send('Datos inválidos'); }

  const { quote_num, client_name, client_phone, client_email, items, subtotal, tax, total, notes, status, company, address, phone, email, tax_rate, date, signature } = payload;

  // Fixed company logo (Constructora D'Sanchez)
  const LOGO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAHIAbADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8qqKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKADFLtoxS5o0ATbRtpefQ0Ux6Cba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LddttMshHFPNuHmSttCgDPJr2/4Q/s9eMvCXxs8J/EnT7G48RaFpEym7k0e5Vgse4bW2k1jiqLqQcep6WWY32Fanrofn5No8lveC3mlWG5yQwPA4z/Suq8AfCvxZ8SPFkXhvQdL8/W5UaSK1ldY92Bnrn09K/Zz4n/sk+DPiV4p1LxJ4f8YatoPiK/mMkpttlxiQtyWDHJrB8Kfsj+GdI1uDULPxB4ssjC/myxJJb/Mw9M89BXj4rA0sRv8AppY+jwuYV8I9VexS+Nf7FOv/AAt+B+l63r3i1ofE+haUs2paRblv9CkHJRCecivknxX4c8N+LPBWlalp1x/xO2WYXqHdggEBR35r9hfHln4d1zwRrWleIdXbQFubSWFNUjTzPs77Dh8HkYPNflZ+0R8IbX4K+OLHRra/m1Eze/tr/AMJrF8PobQaT4i0S2gu/FDqJvsV0hPmQJKcAqo5ByMnoK+ffGfgLULOzkvLi/sEnR8ojXIXAJ56HrSuByPhi/NjdzQxqjyTNhfLmCKD6knit7TpbXRdYWO2VJ5Ix+9PmFQx7ACvOJVaOeVHV4SjYKOcEfhUnkSWzq7MfnIAXJH15pgfXfg/9of4k/DvwHL4Vs73SF8P4wBLYo0uPQtn/GvZf2Jv2j/HXiT476L4Q8T6tb6j4W1BZ4biz+yoqsqxlgQwGeuK/PmCFLe7keeKKdMYxIpOMjIPFdd8NTdT/EHQf7PkENwlwHVpB8p+XpzQB/V18P8AXx4m8K6fqXl+WLmEMF9MV0deK/s4XGt3Xwb8OyeIGZ9UNspkZ+rD1r2qgAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q==';

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
table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px}
thead tr{background:#111;color:#fff}
th{padding:10px 12px;text-align:left;font-weight:600;font-size:11px;letter-spacing:0.5px}
th:not(:first-child){text-align:right}
td{padding:9px 12px;border-bottom:1px solid #f0f0f0;color:#333}
td:not(:first-child){text-align:right}
tr:nth-child(even) td{background:#fafafa}
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
