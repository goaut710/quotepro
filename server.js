// ============================================================
//  QuotePro – server.js  (PostgreSQL / Supabase)
// ============================================================

const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcryptjs');
const path    = require('path');
const cors    = require('cors');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── PostgreSQL ───────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function query(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

// ─── Middleware ───────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'quotepro_secret_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'No autorizado' });
}

// ─── Init DB ──────────────────────────────────────────────────
async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id         SERIAL PRIMARY KEY,
      username   TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      company    TEXT DEFAULT 'Mi Empresa S.A.',
      address    TEXT DEFAULT 'Dirección de la empresa',
      phone      TEXT DEFAULT '+502 0000 0000',
      email      TEXT DEFAULT 'empresa@email.com',
      tax_rate   REAL DEFAULT 12,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS quotes (
      id           SERIAL PRIMARY KEY,
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
      created_at   TIMESTAMP DEFAULT NOW()
    )
  `);

  // Seed admin
  const existing = await queryOne('SELECT id FROM users WHERE username = $1', ['admin']);
  if (!existing) {
    const hash = bcrypt.hashSync('admin123', 10);
    await query(
      `INSERT INTO users (username, password, company, address, phone, email)
       VALUES ($1, $2, 'QuotePro Demo', 'Av. Principal 123, Ciudad', '+502 1234 5678', 'demo@quotepro.com')`,
      ['admin', hash]
    );
  }
  console.log('✅  Base de datos PostgreSQL lista');
}

// ─── AUTH ─────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await queryOne('SELECT * FROM users WHERE username = $1', [username]);
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    req.session.userId   = user.id;
    req.session.username = user.username;
    res.json({ ok: true, username: user.username });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Datos incompletos' });
    const exists = await queryOne('SELECT id FROM users WHERE username = $1', [username]);
    if (exists) return res.status(409).json({ error: 'Usuario ya existe' });
    const hash = bcrypt.hashSync(password, 10);
    await query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, hash]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── PROFILE ──────────────────────────────────────────────────
app.get('/api/profile', requireAuth, async (req, res) => {
  try {
    const user = await queryOne(
      'SELECT id, username, company, address, phone, email, tax_rate FROM users WHERE id = $1',
      [req.session.userId]
    );
    res.json(user);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/profile', requireAuth, async (req, res) => {
  try {
    const { company, address, phone, email, tax_rate, password } = req.body;
    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      await query(
        'UPDATE users SET company=$1, address=$2, phone=$3, email=$4, tax_rate=$5, password=$6 WHERE id=$7',
        [company, address, phone, email, tax_rate || 12, hash, req.session.userId]
      );
    } else {
      await query(
        'UPDATE users SET company=$1, address=$2, phone=$3, email=$4, tax_rate=$5 WHERE id=$6',
        [company, address, phone, email, tax_rate || 12, req.session.userId]
      );
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── QUOTES ───────────────────────────────────────────────────
app.get('/api/quotes', requireAuth, async (req, res) => {
  try {
    const { search } = req.query;
    let rows;
    if (search) {
      rows = await query(
        `SELECT * FROM quotes WHERE user_id=$1 AND (client_name ILIKE $2 OR quote_num ILIKE $2) ORDER BY created_at DESC`,
        [req.session.userId, `%${search}%`]
      );
    } else {
      rows = await query(
        'SELECT * FROM quotes WHERE user_id=$1 ORDER BY created_at DESC',
        [req.session.userId]
      );
    }
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quotes/next-num', requireAuth, async (req, res) => {
  try {
    const row = await queryOne(
      'SELECT COUNT(*) as cnt FROM quotes WHERE user_id=$1',
      [req.session.userId]
    );
    const n   = (parseInt(row.cnt) || 0) + 1;
    const num = `COT-${String(n).padStart(4, '0')}`;
    res.json({ quote_num: num });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/quotes', requireAuth, async (req, res) => {
  try {
    const { client_name, client_phone, client_email, items, subtotal, tax, total, notes, status } = req.body;
    const row = await queryOne(
      'SELECT COUNT(*) as cnt FROM quotes WHERE user_id=$1',
      [req.session.userId]
    );
    const n   = (parseInt(row.cnt) || 0) + 1;
    const qn  = `COT-${String(n).padStart(4, '0')}`;
    const result = await query(
      `INSERT INTO quotes (user_id, quote_num, client_name, client_phone, client_email, items, subtotal, tax, total, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [req.session.userId, qn, client_name, client_phone||'', client_email||'',
       JSON.stringify(items), subtotal||0, tax||0, total||0, notes||'', status||'pendiente']
    );
    res.json({ ok: true, id: result[0].id, quote_num: qn });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/quotes/:id', requireAuth, async (req, res) => {
  try {
    const { client_name, client_phone, client_email, items, subtotal, tax, total, notes, status } = req.body;
    await query(
      `UPDATE quotes SET client_name=$1, client_phone=$2, client_email=$3, items=$4,
       subtotal=$5, tax=$6, total=$7, notes=$8, status=$9 WHERE id=$10 AND user_id=$11`,
      [client_name, client_phone||'', client_email||'', JSON.stringify(items),
       subtotal||0, tax||0, total||0, notes||'', status||'pendiente',
       req.params.id, req.session.userId]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/quotes/:id', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM quotes WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ─── PDF GENERATION ──────────────────────────────────────────
app.post('/api/pdf', requireAuth, async (req, res) => {
  let payload;
  try { payload = JSON.parse(req.body.data || '{}'); }
  catch(e) { return res.status(400).send('Datos invalidos'); }

  const { quote_num, client_name, client_phone, client_email, items, total, notes, status, company, address, phone, email, date, signature } = payload;
  const LOGO =  + logo + ;
  const fmt = n => `Q ${Number(n||0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const statusColor = status === 'aprobada' ? '#d1fae5' : status === 'rechazada' ? '#fee2e2' : '#fef3c7';
  const statusText  = status === 'aprobada' ? '#065f46' : status === 'rechazada' ? '#991b1b' : '#92400e';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Cotizacion ${esc(quote_num)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;color:#111;background:#f0f0f0;padding:16px;font-size:13px}
.save-bar{background:#1a1a1a;padding:12px 18px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px;border-radius:8px;max-width:794px;margin-left:auto;margin-right:auto}
.save-btn{background:#e63329;color:#fff;border:none;border-radius:6px;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer}
.back-btn{background:#444;color:#fff;border:none;border-radius:6px;padding:10px 16px;font-size:13px;cursor:pointer}
.doc{background:#fff;padding:32px;max-width:794px;margin:0 auto;border-radius:8px}
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
.greeting{font-size:12px;color:#555;margin-bottom:14px;font-style:italic}
table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px;border:1.5px solid #333}
thead tr{background:#111;color:#fff}
th{padding:10px 12px;text-align:left;font-weight:600;font-size:11px;letter-spacing:0.5px;border:1px solid #444}
th:not(:first-child){text-align:right}
td{padding:9px 12px;border:1px solid #ccc;color:#333}
td:not(:first-child){text-align:right}
tr:nth-child(even) td{background:#f9f9f9}
.totals{display:flex;justify-content:flex-end;margin-bottom:16px}
.tbox{width:240px}
.tt{background:#e63329;color:#fff;padding:10px 14px;border-radius:6px;display:flex;justify-content:space-between;font-size:15px;font-weight:700}
.notes-box{background:#f7f7f7;border-radius:6px;padding:12px 16px;margin-bottom:18px;font-size:12px;color:#555}
.nl{font-size:9px;font-weight:700;letter-spacing:2px;color:#aaa;margin-bottom:5px;text-transform:uppercase}
.sigs{display:flex;gap:20px;margin-top:30px;padding-top:18px;border-top:1px solid #eee}
.sig-box{flex:1;text-align:center}
.sig-img{max-width:160px;max-height:68px;object-fit:contain;display:block;margin:0 auto 8px}
.sig-empty{height:68px;border:1.5px dashed #ddd;border-radius:6px;margin-bottom:8px}
.sig-line{border-top:1.5px solid #333;padding-top:7px;font-size:11px;color:#444;font-weight:600}
.sig-sub{font-size:10px;color:#aaa;margin-top:2px}
.footer{text-align:center;margin-top:16px;font-size:10px;color:#ccc}
@media print{.save-bar{display:none}body{background:#fff;padding:0}.doc{box-shadow:none;border-radius:0;padding:20px}}
</style>
</head>
<body>
<div class="save-bar">
  <button class="back-btn" onclick="history.back()">← Volver</button>
  <span style="color:#888;font-size:11px">PC: Imprimir → Guardar como PDF &nbsp;·&nbsp; Cel: Menu → Imprimir</span>
  <button class="save-btn" onclick="window.print()">Guardar PDF</button>
</div>
<div class="doc">
  <div class="header">
    <div class="logo-wrap">
      <img src="${LOGO}" class="logo-img" alt="Logo"/>
      <div>
        <div class="co-name">${esc(company||"Constructora D'Sanchez")}</div>
        <div class="co-info">${esc(address||'')}<br>${esc(phone||'')} ${phone&&email?'|':''} ${esc(email||'')}</div>
      </div>
    </div>
    <div>
      <div class="q-label">Cotizacion</div>
      <div class="q-num">${esc(quote_num)}</div>
      <div class="q-date">Fecha: ${esc(date||'')}</div>
      <div style="text-align:right"><span class="pill" style="background:${statusColor};color:${statusText}">${esc(status)}</span></div>
    </div>
  </div>
  <div class="to-box">
    <div class="to-lbl">Estimado Cliente</div>
    <div class="to-name">${esc(client_name)}</div>
    ${client_phone?`<div class="to-info">${esc(client_phone)}</div>`:''}
    ${client_email?`<div class="to-info">${esc(client_email)}</div>`:''}
  </div>
  <p class="greeting">Nos complace presentarle la siguiente cotizacion de servicios:</p>
  <table>
    <thead><tr><th>Descripcion del Servicio</th><th>Cant.</th><th>Precio Unit.</th><th>Desc.</th><th>Total</th></tr></thead>
    <tbody>
      ${(items||[]).map(i=>`<tr><td>${esc(i.desc)}</td><td>${i.qty}</td><td style="font-family:monospace">${fmt(i.price)}</td><td>${i.disc||0}%</td><td style="font-family:monospace;font-weight:700">${fmt(i.total)}</td></tr>`).join('')}
    </tbody>
  </table>
  <div class="totals">
    <div class="tbox">
      <div class="tt"><span>TOTAL</span><span style="font-family:monospace">${fmt(total)}</span></div>
    </div>
  </div>
  ${notes?`<div class="notes-box"><div class="nl">Terminos y Condiciones</div>${esc(notes)}</div>`:''}
  <div class="sigs">
    <div class="sig-box">
      ${signature?`<img src="${signature}" class="sig-img" alt="Firma"/>`:'<div class="sig-empty"></div>'}
      <div class="sig-line">Firma Autorizada</div>
      <div class="sig-sub">${esc(company||"Constructora D'Sanchez")}</div>
    </div>
    <div class="sig-box">
      <div class="sig-empty"></div>
      <div class="sig-line">Firma Cliente</div>
      <div class="sig-sub">${esc(client_name)}</div>
    </div>
  </div>
  <div class="footer">Generado con QuotePro · ${new Date().toLocaleString('es-GT')}</div>
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
  process.exit(1);
});
