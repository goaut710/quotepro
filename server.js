const express = require('express');
const path = require('path');
const { SqliteDatabase } = require('./db-helper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Base de datos ──────────────────────────────────────────────────────────
const db = new SqliteDatabase(path.join(__dirname, 'db', 'quotepro.db'));

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

// Usuario por defecto
const bcrypt = require('bcryptjs');
const hashedPwd = bcrypt.hashSync('admin123', 10);
try {
  db.run(`INSERT OR IGNORE INTO users (username, password) VALUES ('admin', '${hashedPwd}')`);
} catch(e) {}

// ── AUTH ───────────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  res.json({ success: true, username: user.username });
});

// ── COTIZACIONES ───────────────────────────────────────────────────────────
app.get('/api/quotes', (req, res) => {
  const quotes = db.all('SELECT * FROM quotes ORDER BY created_at DESC');
  res.json(quotes);
});

app.get('/api/quotes/:id', (req, res) => {
  const quote = db.get('SELECT * FROM quotes WHERE id = ?', [req.params.id]);
  if (!quote) return res.status(404).json({ error: 'No encontrada' });
  res.json(quote);
});

app.post('/api/quotes', (req, res) => {
  const count = db.get('SELECT COUNT(*) as c FROM quotes');
  const num = String((count?.c || 0) + 1).padStart(4, '0');
  const quote_number = `COT-${num}`;
  const {
    client_name, client_email, client_phone, client_address,
    project_description, items, subtotal, tax_rate, tax_amount, total,
    signature, status
  } = req.body;

  db.run(`INSERT INTO quotes
    (quote_number, client_name, client_email, client_phone, client_address,
     project_description, items, subtotal, tax_rate, tax_amount, total, signature, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [quote_number, client_name, client_email, client_phone, client_address,
     project_description, items, subtotal, tax_rate, tax_amount, total, signature, status || 'Pendiente']
  );
  const newQ = db.get('SELECT * FROM quotes WHERE quote_number = ?', [quote_number]);
  res.json(newQ);
});

app.put('/api/quotes/:id', (req, res) => {
  const {
    client_name, client_email, client_phone, client_address,
    project_description, items, subtotal, tax_rate, tax_amount, total,
    signature, status
  } = req.body;
  db.run(`UPDATE quotes SET
    client_name=?, client_email=?, client_phone=?, client_address=?,
    project_description=?, items=?, subtotal=?, tax_rate=?, tax_amount=?,
    total=?, signature=?, status=?, updated_at=datetime('now')
    WHERE id=?`,
    [client_name, client_email, client_phone, client_address,
     project_description, items, subtotal, tax_rate, tax_amount,
     total, signature, status, req.params.id]
  );
  res.json({ success: true });
});

app.delete('/api/quotes/:id', (req, res) => {
  db.run('DELETE FROM quotes WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ── CATÁLOGO DE PRODUCTOS ──────────────────────────────────────────────────
app.get('/api/products', (req, res) => {
  const products = db.all('SELECT * FROM products ORDER BY name ASC');
  res.json(products);
});

app.post('/api/products', (req, res) => {
  const { name, description, price, unit } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Nombre y precio requeridos' });
  db.run('INSERT INTO products (name, description, price, unit) VALUES (?,?,?,?)',
    [name, description || '', price, unit || 'unidad']);
  const prod = db.get('SELECT * FROM products ORDER BY id DESC LIMIT 1');
  res.json(prod);
});

app.put('/api/products/:id', (req, res) => {
  const { name, description, price, unit } = req.body;
  db.run('UPDATE products SET name=?, description=?, price=?, unit=? WHERE id=?',
    [name, description, price, unit, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/products/:id', (req, res) => {
  db.run('DELETE FROM products WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ── PDF PROFESIONAL ────────────────────────────────────────────────────────
const LOGO_BASE64 = require('./logo-base64');

app.get('/api/quotes/:id/pdf', (req, res) => {
  const quote = db.get('SELECT * FROM quotes WHERE id = ?', [req.params.id]);
  if (!quote) return res.status(404).send('No encontrada');

  let items = [];
  try { items = JSON.parse(quote.items || '[]'); } catch(e) {}

  const filas = items.map(item => `
    <tr>
      <td style="padding:8px 10px;border:1px solid #333;font-size:13px;">${item.description || ''}</td>
      <td style="padding:8px 10px;border:1px solid #333;text-align:center;font-size:13px;">${item.quantity || 0}</td>
      <td style="padding:8px 10px;border:1px solid #333;text-align:right;font-size:13px;">Q${parseFloat(item.price || 0).toFixed(2)}</td>
      <td style="padding:8px 10px;border:1px solid #333;text-align:right;font-size:13px;">Q${parseFloat(item.total || 0).toFixed(2)}</td>
    </tr>`).join('');

  const signature = quote.signature
    ? `<img src="${quote.signature}" style="height:60px;"/>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, sans-serif; background:#fff; color:#111; padding:30px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; }
  .logo-box img { max-height:90px; max-width:160px; }
  .title-box { text-align:right; }
  .title-box h1 { font-size:28px; font-weight:900; color:#111; letter-spacing:1px; }
  .title-box p { font-size:13px; color:#444; margin-top:4px; }
  .info-bar { display:flex; justify-content:space-between; margin-bottom:18px; background:#f5f5f5; padding:14px 16px; border-left:4px solid #111; }
  .info-bar .col { font-size:12.5px; color:#333; line-height:1.7; }
  .info-bar .col strong { display:inline-block; min-width:90px; font-weight:700; color:#111; }
  .desc-section { margin-bottom:16px; }
  .desc-section label { font-size:12px; font-weight:700; color:#111; letter-spacing:.5px; text-transform:uppercase; }
  .desc-section p { font-size:13px; color:#333; margin-top:6px; min-height:50px; border-bottom:1px solid #ccc; padding-bottom:8px; }
  table { width:100%; border-collapse:collapse; margin-bottom:14px; }
  thead tr { background:#111; color:#fff; }
  thead th { padding:10px; font-size:12px; font-weight:700; text-align:left; letter-spacing:.5px; text-transform:uppercase; border:1px solid #111; }
  thead th:nth-child(2), thead th:nth-child(3), thead th:nth-child(4) { text-align:center; }
  tbody tr:nth-child(even) { background:#fafafa; }
  .totals { display:flex; justify-content:flex-end; margin-bottom:20px; }
  .totals-box { width:260px; border:1px solid #ccc; }
  .totals-box .row { display:flex; justify-content:space-between; padding:7px 12px; font-size:13px; border-bottom:1px solid #eee; }
  .totals-box .row.total { background:#111; color:#fff; font-weight:700; font-size:14px; }
  .validity { font-size:12px; color:#555; margin-bottom:24px; font-style:italic; }
  .signatures { display:flex; justify-content:space-between; margin-top:40px; }
  .sig-col { text-align:center; width:42%; }
  .sig-col .sig-img { min-height:60px; margin-bottom:4px; }
  .sig-col .line { border-top:1.5px solid #111; margin-bottom:6px; }
  .sig-col span { font-size:12px; color:#555; }
  @media print {
    body { padding:20px; }
    button { display:none !important; }
  }
</style>
</head>
<body>

<!-- BOTÓN GUARDAR -->
<div style="text-align:center;margin-bottom:20px;">
  <button onclick="window.print()" style="background:#111;color:#fff;border:none;padding:12px 32px;font-size:15px;border-radius:6px;cursor:pointer;letter-spacing:.5px;">
    🖨️ Imprimir / Guardar PDF
  </button>
</div>

<!-- ENCABEZADO -->
<div class="header">
  <div class="logo-box">
    <img src="data:image/jpeg;base64,${LOGO_BASE64}" alt="Logo"/>
  </div>
  <div class="title-box">
    <h1>COTIZACIÓN ${quote.quote_number}</h1>
    <p>Fecha: ${new Date(quote.created_at).toLocaleDateString('es-GT')}</p>
    <p style="margin-top:4px;font-size:12px;color:#666;">Estado: ${quote.status}</p>
  </div>
</div>

<!-- INFO EMPRESA Y CLIENTE -->
<div class="info-bar">
  <div class="col">
    <strong>Empresa:</strong> Constructora D'Sanchez<br/>
    <strong>Dirección:</strong> Carcha A.V.<br/>
    <strong>Teléfono:</strong> +502 4995 4123<br/>
    <strong>Email:</strong> sanchezsierra035@gmail.com
  </div>
  <div class="col" style="text-align:right;">
    <strong>Cliente:</strong> ${quote.client_name || '—'}<br/>
    ${quote.client_phone ? `<strong>Tel:</strong> ${quote.client_phone}<br/>` : ''}
    ${quote.client_email ? `<strong>Email:</strong> ${quote.client_email}<br/>` : ''}
    ${quote.client_address ? `<strong>Dir:</strong> ${quote.client_address}` : ''}
  </div>
</div>

<!-- DESCRIPCIÓN DEL PROYECTO -->
<div class="desc-section">
  <label>Descripción del Proyecto</label>
  <p>${quote.project_description || ''}</p>
</div>

<!-- TABLA DE PRODUCTOS -->
<table>
  <thead>
    <tr>
      <th>Descripción del Producto / Servicio</th>
      <th style="width:80px;text-align:center;">Cantidad</th>
      <th style="width:100px;text-align:center;">Precio</th>
      <th style="width:110px;text-align:center;">Total</th>
    </tr>
  </thead>
  <tbody>
    ${filas || '<tr><td colspan="4" style="text-align:center;padding:20px;border:1px solid #333;color:#999;">Sin productos</td></tr>'}
  </tbody>
</table>

<!-- TOTALES -->
<div class="totals">
  <div class="totals-box">
    <div class="row"><span>Subtotal</span><span>Q${parseFloat(quote.subtotal||0).toFixed(2)}</span></div>
    <div class="row"><span>IVA (${quote.tax_rate||12}%)</span><span>Q${parseFloat(quote.tax_amount||0).toFixed(2)}</span></div>
    <div class="row total"><span>TOTAL</span><span>Q${parseFloat(quote.total||0).toFixed(2)}</span></div>
  </div>
</div>

<div class="validity">* Cotización válida por 30 días a partir de la fecha de emisión.</div>

<!-- FIRMAS -->
<div class="signatures">
  <div class="sig-col">
    <div class="sig-img"></div>
    <div class="line"></div>
    <span>Firma del Cliente</span>
  </div>
  <div class="sig-col">
    <div class="sig-img">${signature}</div>
    <div class="line"></div>
    <span>Firma del Vendedor — Constructora D'Sanchez</span>
  </div>
</div>

</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ── INICIO ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Base de datos lista`);
  console.log(`✅ QuotePro corriendo en http://localhost:${PORT}`);
});
