const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── BASE DE DATOS ──────────────────────────────────────
let db = null;

async function initDB() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  const dbPath = path.join(__dirname, 'db', 'quotepro.db');
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  function saveDB() {
    try {
      const data = db.export();
      fs.writeFileSync(dbPath, Buffer.from(data));
    } catch(e) {}
  }

  // Crear tablas
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_number TEXT UNIQUE NOT NULL,
    client_name TEXT,
    client_email TEXT,
    client_phone TEXT,
    client_address TEXT,
    project_description TEXT,
    items TEXT,
    subtotal REAL,
    tax_rate REAL DEFAULT 12,
    tax_amount REAL,
    total REAL,
    signature TEXT,
    status TEXT DEFAULT 'Pendiente',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    unit TEXT DEFAULT 'unidad',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Crear usuario admin
  const pwd = bcrypt.hashSync('admin123', 10);
  db.run(`INSERT OR IGNORE INTO users (username, password) VALUES ('admin', '${pwd}')`);
  db.run(`UPDATE users SET password='${pwd}' WHERE username='admin'`);
  saveDB();
  console.log('✅ Base de datos lista');
  console.log('✅ Usuario admin creado');

  // Helpers
  function dbGet(sql, params = []) {
    try {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      if (stmt.step()) { const r = stmt.getAsObject(); stmt.free(); return r; }
      stmt.free(); return null;
    } catch(e) { console.error('dbGet:', e.message); return null; }
  }

  function dbAll(sql, params = []) {
    try {
      const results = db.exec(sql);
      if (!results.length) return [];
      const { columns, values } = results[0];
      return values.map(row => { const o = {}; columns.forEach((c,i) => o[c]=row[i]); return o; });
    } catch(e) { console.error('dbAll:', e.message); return []; }
  }

  function dbRun(sql, params = []) {
    try { db.run(sql, params); saveDB(); } catch(e) { console.error('dbRun:', e.message); }
  }

  // ── RUTAS ──────────────────────────────────────────

  // Reset admin (emergencia)
  app.get('/api/reset-admin', (req, res) => {
    try {
      db.run(`DELETE FROM users WHERE username='admin'`);
      db.run(`INSERT INTO users (username, password) VALUES ('admin', '${pwd}')`);
      saveDB();
      res.json({ success: true, message: 'Admin reseteado OK. Usuario: admin, Contraseña: admin123' });
    } catch(e) { res.json({ error: e.message }); }
  });

  // Login
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = dbGet('SELECT * FROM users WHERE username = ?', [username]);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    res.json({ success: true, username: user.username });
  });

  // Cotizaciones
  app.get('/api/quotes', (req, res) => res.json(dbAll('SELECT * FROM quotes ORDER BY created_at DESC')));

  app.get('/api/quotes/:id', (req, res) => {
    const q = dbGet('SELECT * FROM quotes WHERE id = ?', [req.params.id]);
    if (!q) return res.status(404).json({ error: 'No encontrada' });
    res.json(q);
  });

  app.post('/api/quotes', (req, res) => {
    const count = dbGet('SELECT COUNT(*) as c FROM quotes');
    const num = String((count?.c || 0) + 1).padStart(4, '0');
    const qn = `COT-${num}`;
    const { client_name, client_email, client_phone, client_address,
      project_description, items, subtotal, tax_rate, tax_amount, total, signature, status } = req.body;
    dbRun(`INSERT INTO quotes (quote_number,client_name,client_email,client_phone,client_address,
      project_description,items,subtotal,tax_rate,tax_amount,total,signature,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [qn, client_name, client_email, client_phone, client_address,
       project_description, items, subtotal, tax_rate, tax_amount, total, signature, status||'Pendiente']);
    res.json(dbGet('SELECT * FROM quotes WHERE quote_number = ?', [qn]));
  });

  app.put('/api/quotes/:id', (req, res) => {
    const { client_name, client_email, client_phone, client_address,
      project_description, items, subtotal, tax_rate, tax_amount, total, signature, status } = req.body;
    dbRun(`UPDATE quotes SET client_name=?,client_email=?,client_phone=?,client_address=?,
      project_description=?,items=?,subtotal=?,tax_rate=?,tax_amount=?,total=?,signature=?,status=?,
      updated_at=datetime('now') WHERE id=?`,
      [client_name, client_email, client_phone, client_address,
       project_description, items, subtotal, tax_rate, tax_amount, total, signature, status, req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/quotes/:id', (req, res) => {
    dbRun('DELETE FROM quotes WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // Productos / Catálogo
  app.get('/api/products', (req, res) => res.json(dbAll('SELECT * FROM products ORDER BY name ASC')));

  app.post('/api/products', (req, res) => {
    const { name, description, price, unit } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'Nombre y precio requeridos' });
    dbRun('INSERT INTO products (name, description, price, unit) VALUES (?,?,?,?)',
      [name, description||'', price, unit||'unidad']);
    const prod = dbAll('SELECT * FROM products ORDER BY id DESC LIMIT 1');
    res.json(prod[0] || {});
  });

  app.put('/api/products/:id', (req, res) => {
    const { name, description, price, unit } = req.body;
    dbRun('UPDATE products SET name=?,description=?,price=?,unit=? WHERE id=?',
      [name, description, price, unit, req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/products/:id', (req, res) => {
    dbRun('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // PDF
  const LOGO_BASE64 = require('./logo-base64');

  app.get('/api/quotes/:id/pdf', (req, res) => {
    const quote = dbGet('SELECT * FROM quotes WHERE id = ?', [req.params.id]);
    if (!quote) return res.status(404).send('No encontrada');

    let items = [];
    try { items = JSON.parse(quote.items || '[]'); } catch(e) {}

    const filas = items.map(item => `
      <tr>
        <td style="padding:8px 10px;border:1px solid #333;font-size:13px;">${item.description||''}</td>
        <td style="padding:8px 10px;border:1px solid #333;text-align:center;font-size:13px;">${item.quantity||0}</td>
        <td style="padding:8px 10px;border:1px solid #333;text-align:right;font-size:13px;">Q${parseFloat(item.price||0).toFixed(2)}</td>
        <td style="padding:8px 10px;border:1px solid #333;text-align:right;font-size:13px;">Q${parseFloat(item.total||0).toFixed(2)}</td>
      </tr>`).join('');

    const signature = quote.signature ? `<img src="${quote.signature}" style="height:60px;"/>` : '';

    const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:Arial,sans-serif; background:#fff; color:#111; padding:30px; }
.header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; }
.logo-box img { max-height:90px; max-width:160px; }
.title-box { text-align:right; }
.title-box h1 { font-size:28px; font-weight:900; color:#111; }
.info-bar { display:flex; justify-content:space-between; margin-bottom:18px; background:#f5f5f5; padding:14px 16px; border-left:4px solid #111; }
.info-bar .col { font-size:12.5px; color:#333; line-height:1.8; }
.info-bar .col strong { display:inline-block; min-width:90px; font-weight:700; }
.desc-section { margin-bottom:16px; }
.desc-section label { font-size:12px; font-weight:700; text-transform:uppercase; }
.desc-section p { font-size:13px; margin-top:6px; min-height:50px; border-bottom:1px solid #ccc; padding-bottom:8px; }
table { width:100%; border-collapse:collapse; margin-bottom:14px; }
thead tr { background:#111; color:#fff; }
thead th { padding:10px; font-size:12px; font-weight:700; text-align:left; border:1px solid #111; text-transform:uppercase; }
thead th:nth-child(2),thead th:nth-child(3),thead th:nth-child(4) { text-align:center; }
tbody tr:nth-child(even) { background:#fafafa; }
.totals { display:flex; justify-content:flex-end; margin-bottom:20px; }
.totals-box { width:260px; border:1px solid #ccc; }
.totals-box .row { display:flex; justify-content:space-between; padding:7px 12px; font-size:13px; border-bottom:1px solid #eee; }
.totals-box .row.total { background:#111; color:#fff; font-weight:700; font-size:14px; }
.validity { font-size:12px; color:#555; margin-bottom:24px; font-style:italic; }
.signatures { display:flex; justify-content:space-between; margin-top:40px; }
.sig-col { text-align:center; width:42%; }
.sig-col .line { border-top:1.5px solid #111; margin-bottom:6px; margin-top:70px; }
.sig-col span { font-size:12px; color:#555; }
@media print { button { display:none !important; } }
</style></head><body>
<div style="text-align:center;margin-bottom:20px;">
  <button onclick="window.print()" style="background:#111;color:#fff;border:none;padding:12px 32px;font-size:15px;border-radius:6px;cursor:pointer;">
    🖨️ Imprimir / Guardar PDF
  </button>
</div>
<div class="header">
  <div class="logo-box"><img src="data:image/jpeg;base64,${LOGO_BASE64}" alt="Logo"/></div>
  <div class="title-box">
    <h1>COTIZACIÓN ${quote.quote_number}</h1>
    <p style="font-size:13px;color:#444;margin-top:4px;">Fecha: ${new Date(quote.created_at).toLocaleDateString('es-GT')}</p>
    <p style="font-size:12px;color:#666;margin-top:2px;">Estado: ${quote.status}</p>
  </div>
</div>
<div class="info-bar">
  <div class="col">
    <strong>Empresa:</strong> Constructora D'Sanchez<br/>
    <strong>Dirección:</strong> Carcha A.V.<br/>
    <strong>Teléfono:</strong> +502 4995 4123<br/>
    <strong>Email:</strong> sanchezsierra035@gmail.com
  </div>
  <div class="col" style="text-align:right;">
    <strong>Cliente:</strong> ${quote.client_name||'—'}<br/>
    ${quote.client_phone?`<strong>Tel:</strong> ${quote.client_phone}<br/>`:''}
    ${quote.client_email?`<strong>Email:</strong> ${quote.client_email}<br/>`:''}
    ${quote.client_address?`<strong>Dir:</strong> ${quote.client_address}`:''}
  </div>
</div>
<div class="desc-section">
  <label>Descripción del Proyecto</label>
  <p>${quote.project_description||''}</p>
</div>
<table>
  <thead><tr>
    <th>Descripción del Producto / Servicio</th>
    <th style="width:80px;text-align:center;">Cantidad</th>
    <th style="width:100px;text-align:center;">Precio</th>
    <th style="width:110px;text-align:center;">Total</th>
  </tr></thead>
  <tbody>${filas||'<tr><td colspan="4" style="text-align:center;padding:20px;border:1px solid #333;color:#999;">Sin productos</td></tr>'}</tbody>
</table>
<div class="totals">
  <div class="totals-box">
    <div class="row"><span>Subtotal</span><span>Q${parseFloat(quote.subtotal||0).toFixed(2)}</span></div>
    <div class="row"><span>IVA (${quote.tax_rate||12}%)</span><span>Q${parseFloat(quote.tax_amount||0).toFixed(2)}</span></div>
    <div class="row total"><span>TOTAL</span><span>Q${parseFloat(quote.total||0).toFixed(2)}</span></div>
  </div>
</div>
<div class="validity">* Cotización válida por 30 días a partir de la fecha de emisión.</div>
<div class="signatures">
  <div class="sig-col"><div class="line"></div><span>Firma del Cliente</span></div>
  <div class="sig-col"><div style="min-height:60px;">${signature}</div><div class="line"></div><span>Firma del Vendedor — Constructora D'Sanchez</span></div>
</div>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });

  // Iniciar servidor
  app.listen(PORT, () => {
    console.log(`✅ QuotePro corriendo en http://localhost:${PORT}`);
  });
}

// Iniciar todo
initDB().catch(err => {
  console.error('Error al inicializar:', err);
  process.exit(1);
});
