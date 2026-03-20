// ============================================================
//  QuotePro – app.js
//  Frontend SPA logic
// ============================================================

// ─── State ───────────────────────────────────────────────────
let currentUser  = null;
let editingId    = null;   // quote id being edited
let modalQuoteId = null;
let logoDataURL  = null;
let rowCounter   = 0;

const API = '';  // same origin

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setDate();
  await checkSession();
});

async function checkSession() {
  try {
    const res = await fetch(`${API}/api/me`, { credentials: 'include' });
    if (res.ok) {
      currentUser = await res.json();
      bootApp();
    }
  } catch {}
}

function bootApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  fillCompanyFromProfile();
  updateUserBadge();
  addRow(); // default first row
  loadNextQuoteNum();
}

// ─── AUTH ────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) => {
    t.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register'));
  });
  document.getElementById('loginForm').classList.toggle('hidden',    tab !== 'login');
  document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
}

async function doLogin() {
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const err = document.getElementById('loginError');
  err.classList.add('hidden');
  if (!username || !password) return showError(err, 'Completa todos los campos');
  try {
    const res = await fetch(`${API}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) return showError(err, data.error || 'Error al iniciar sesión');
    currentUser = await (await fetch(`${API}/api/me`, { credentials: 'include' })).json();
    bootApp();
  } catch (e) { showError(err, 'Error de conexión'); }
}

async function doRegister() {
  const username = document.getElementById('regUser').value.trim();
  const password = document.getElementById('regPass').value;
  const err = document.getElementById('regError');
  err.classList.add('hidden');
  if (!username || !password) return showError(err, 'Completa todos los campos');
  try {
    const res = await fetch(`${API}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) return showError(err, data.error || 'Error al registrar');
    toast('Cuenta creada. Inicia sesión.', 'success');
    switchTab('login');
  } catch { showError(err, 'Error de conexión'); }
}

async function doLogout() {
  await fetch(`${API}/api/logout`, { method: 'POST', credentials: 'include' });
  currentUser = null;
  editingId   = null;
  document.getElementById('appShell').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
}

function showError(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }

function updateUserBadge() {
  if (!currentUser) return;
  const name = currentUser.username;
  document.getElementById('userNameDisplay').textContent = name;
  document.getElementById('userAvatar').textContent      = name[0].toUpperCase();
}

// ─── NAVIGATION ──────────────────────────────────────────────
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  document.querySelector(`.nav-item[data-page="${page}"]`).classList.add('active');

  if (page === 'history')  loadHistory();
  if (page === 'settings') loadSettings();

  // close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ─── QUOTE FORM ───────────────────────────────────────────────
function setDate() {
  const today = new Date().toISOString().split('T')[0];
  const el    = document.getElementById('quoteDate');
  if (el) el.value = today;
  const disp  = document.getElementById('dateDisplay');
  if (disp) disp.textContent = formatDate(today);
}

async function loadNextQuoteNum() {
  if (editingId) return;
  try {
    const quotes = await apiFetch('/api/quotes');
    const last   = quotes[0]?.quote_num;
    let num = 1;
    if (last) { const m = last.match(/(\d+)$/); if (m) num = +m[1] + 1; }
    const qn = `COT-${String(num).padStart(4,'0')}`;
    document.getElementById('quoteNum').value       = qn;
    document.getElementById('quoteNumDisplay').innerHTML = `${qn} · <span id="dateDisplay">${formatDate(document.getElementById('quoteDate').value)}</span>`;
  } catch {}
}

function fillCompanyFromProfile() {
  if (!currentUser) return;
  document.getElementById('companyName').value    = currentUser.company    || '';
  document.getElementById('companyAddress').value = currentUser.address    || '';
  document.getElementById('companyPhone').value   = currentUser.phone      || '';
  document.getElementById('companyEmail').value   = currentUser.email      || '';
  document.getElementById('taxRateDisplay').textContent = currentUser.tax_rate ?? 12;
}

// ── ROWS ────────────────────────────────────────────────────────
function addRow(desc='', qty=1, price=0, disc=0) {
  const id   = `row_${rowCounter++}`;
  const body = document.getElementById('itemsBody');
  const tr   = document.createElement('tr');
  tr.id = id;
  tr.innerHTML = `
    <td><input class="td-input" placeholder="Descripción del producto o servicio" value="${esc(desc)}" oninput="calcRow('${id}')" /></td>
    <td><input class="td-input num" type="number" min="1" value="${qty}" oninput="calcRow('${id}')" /></td>
    <td><input class="td-input num" type="number" min="0" step="0.01" value="${price}" oninput="calcRow('${id}')" /></td>
    <td><input class="td-input num" type="number" min="0" max="100" value="${disc}" oninput="calcRow('${id}')" /></td>
    <td><span class="row-total" id="total_${id}">Q 0.00</span></td>
    <td>
      <button class="btn-del-row" onclick="delRow('${id}')" title="Eliminar fila">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
      </button>
    </td>
  `;
  body.appendChild(tr);
  calcRow(id);
}

function calcRow(id) {
  const tr    = document.getElementById(id);
  const [,qty,,price,,disc] = [...tr.querySelectorAll('input')].map(i => parseFloat(i.value) || 0);
  // inputs order: desc, qty, price, disc
  const inputs = tr.querySelectorAll('input');
  const q = parseFloat(inputs[1].value) || 0;
  const p = parseFloat(inputs[2].value) || 0;
  const d = parseFloat(inputs[3].value) || 0;
  const total = q * p * (1 - d/100);
  document.getElementById(`total_${id}`).textContent = fmt(total);
  calcTotals();
}

function delRow(id) {
  document.getElementById(id)?.remove();
  calcTotals();
}

function calcTotals() {
  let sub = 0;
  document.querySelectorAll('#itemsBody tr').forEach(tr => {
    const inputs = tr.querySelectorAll('input');
    const q = parseFloat(inputs[1]?.value) || 0;
    const p = parseFloat(inputs[2]?.value) || 0;
    const d = parseFloat(inputs[3]?.value) || 0;
    sub += q * p * (1 - d/100);
  });
  const rate = parseFloat(currentUser?.tax_rate ?? 12) / 100;
  const tax  = sub * rate;
  const total = sub + tax;
  document.getElementById('subtotalDisplay').textContent = fmt(sub);
  document.getElementById('taxDisplay').textContent      = fmt(tax);
  document.getElementById('totalDisplay').textContent    = fmt(total);
}

function getItems() {
  const items = [];
  document.querySelectorAll('#itemsBody tr').forEach(tr => {
    const inputs = tr.querySelectorAll('input');
    const desc  = inputs[0]?.value || '';
    const qty   = parseFloat(inputs[1]?.value) || 0;
    const price = parseFloat(inputs[2]?.value) || 0;
    const disc  = parseFloat(inputs[3]?.value) || 0;
    if (desc || price) items.push({ desc, qty, price, disc, total: qty * price * (1 - disc/100) });
  });
  return items;
}

function resetForm() {
  editingId = null;
  document.getElementById('itemsBody').innerHTML = '';
  document.getElementById('clientName').value  = '';
  document.getElementById('clientPhone').value = '';
  document.getElementById('clientEmail').value = '';
  document.getElementById('quoteNotes').value  = '';
  document.getElementById('quoteStatus').value = 'pendiente';
  setDate();
  addRow();
  loadNextQuoteNum();
  calcTotals();
}

// ── SAVE ───────────────────────────────────────────────────────
async function saveQuote() {
  const clientName = document.getElementById('clientName').value.trim();
  if (!clientName) return toast('El nombre del cliente es obligatorio', 'error');

  const items    = getItems();
  if (!items.length) return toast('Agrega al menos un ítem', 'error');

  const rate     = parseFloat(currentUser?.tax_rate ?? 12) / 100;
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const tax      = subtotal * rate;
  const total    = subtotal + tax;

  const payload = {
    client_name:  clientName,
    client_phone: document.getElementById('clientPhone').value,
    client_email: document.getElementById('clientEmail').value,
    items,
    subtotal, tax, total,
    notes:  document.getElementById('quoteNotes').value,
    status: document.getElementById('quoteStatus').value,
  };

  try {
    let res;
    if (editingId) {
      res = await apiFetch(`/api/quotes/${editingId}`, 'PUT', payload);
      toast('Cotización actualizada ✓', 'success');
    } else {
      res = await apiFetch('/api/quotes', 'POST', payload);
      document.getElementById('quoteNum').value = res.quote_num;
      toast(`Cotización ${res.quote_num} guardada ✓`, 'success');
    }
    editingId = editingId || res.id;
  } catch (e) { toast('Error al guardar', 'error'); }
}

// ─── HISTORY ─────────────────────────────────────────────────
async function loadHistory(search='') {
  const list = document.getElementById('quotesList');
  list.innerHTML = '<div class="empty-state"><p>Cargando...</p></div>';
  try {
    const url = search ? `/api/quotes?search=${encodeURIComponent(search)}` : '/api/quotes';
    const quotes = await apiFetch(url);
    if (!quotes.length) {
      list.innerHTML = `<div class="empty-state">
        <svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
        <p>No hay cotizaciones guardadas</p>
      </div>`;
      return;
    }
    list.innerHTML = quotes.map(q => `
      <div class="quote-row">
        <span class="qr-num">${q.quote_num}</span>
        <div style="flex:1;overflow:hidden">
          <div class="qr-client">${esc(q.client_name)}</div>
          <div class="qr-email">${esc(q.client_email||'')}</div>
        </div>
        <span class="status-badge status-${q.status}">${q.status}</span>
        <span class="qr-total">${fmt(q.total)}</span>
        <span class="qr-date">${formatDate(q.created_at)}</span>
        <div class="qr-actions">
          <button class="qr-btn" onclick="openDetail(${q.id})">Ver</button>
          <button class="qr-btn del" onclick="deleteQuote(${q.id}, this)">Eliminar</button>
        </div>
      </div>
    `).join('');
  } catch { list.innerHTML = '<div class="empty-state"><p>Error al cargar historial</p></div>'; }
}

let searchTimeout;
function searchQuotes(val) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => loadHistory(val), 300);
}

async function deleteQuote(id, btn) {
  if (!confirm('¿Eliminar esta cotización?')) return;
  try {
    await apiFetch(`/api/quotes/${id}`, 'DELETE');
    btn.closest('.quote-row').remove();
    toast('Cotización eliminada', 'success');
  } catch { toast('Error al eliminar', 'error'); }
}

// ─── MODAL DETAIL ─────────────────────────────────────────────
async function openDetail(id) {
  modalQuoteId = id;
  const q = await apiFetch(`/api/quotes/${id}`);
  document.getElementById('modalTitle').textContent = `Cotización ${q.quote_num}`;
  document.getElementById('modalBody').innerHTML = `
    <div class="detail-section">
      <h4>CLIENTE</h4>
      <div class="detail-row"><span class="label">Nombre</span><span class="value">${esc(q.client_name)}</span></div>
      ${q.client_phone ? `<div class="detail-row"><span class="label">Teléfono</span><span class="value">${esc(q.client_phone)}</span></div>` : ''}
      ${q.client_email ? `<div class="detail-row"><span class="label">Email</span><span class="value">${esc(q.client_email)}</span></div>` : ''}
      <div class="detail-row"><span class="label">Estado</span><span class="value"><span class="status-badge status-${q.status}">${q.status}</span></span></div>
      <div class="detail-row"><span class="label">Fecha</span><span class="value">${formatDate(q.created_at)}</span></div>
    </div>
    <div class="detail-section">
      <h4>ÍTEMS</h4>
      <table class="detail-items">
        <thead><tr><th>Descripción</th><th>Cant.</th><th>Precio</th><th>Total</th></tr></thead>
        <tbody>
          ${q.items.map(i => `<tr>
            <td>${esc(i.desc)}</td>
            <td>${i.qty}</td>
            <td>${fmt(i.price)}</td>
            <td>${fmt(i.total)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="detail-section">
      <h4>TOTALES</h4>
      <div class="detail-row"><span class="label">Subtotal</span><span class="value">${fmt(q.subtotal)}</span></div>
      <div class="detail-row"><span class="label">IVA</span><span class="value">${fmt(q.tax)}</span></div>
      <div class="detail-row"><span class="label">TOTAL</span><span class="value detail-total">${fmt(q.total)}</span></div>
    </div>
    ${q.notes ? `<div class="detail-section"><h4>NOTAS</h4><p style="font-size:13px;color:var(--text2)">${esc(q.notes)}</p></div>` : ''}
  `;
  document.getElementById('detailModal').classList.remove('hidden');
}

function closeModal(e) {
  if (e.target.id === 'detailModal') closeDetailModal();
}
function closeDetailModal() {
  document.getElementById('detailModal').classList.add('hidden');
  modalQuoteId = null;
}
async function deleteFromModal() {
  if (!modalQuoteId || !confirm('¿Eliminar esta cotización?')) return;
  await apiFetch(`/api/quotes/${modalQuoteId}`, 'DELETE');
  closeDetailModal();
  loadHistory();
  toast('Cotización eliminada', 'success');
}
async function editFromModal() {
  if (!modalQuoteId) return;
  const q = await apiFetch(`/api/quotes/${modalQuoteId}`);
  closeDetailModal();
  showPage('new');
  loadQuoteIntoForm(q);
}

function loadQuoteIntoForm(q) {
  editingId = q.id;
  document.getElementById('quoteNum').value    = q.quote_num;
  document.getElementById('clientName').value  = q.client_name;
  document.getElementById('clientPhone').value = q.client_phone || '';
  document.getElementById('clientEmail').value = q.client_email || '';
  document.getElementById('quoteNotes').value  = q.notes || '';
  document.getElementById('quoteStatus').value = q.status || 'pendiente';
  document.getElementById('itemsBody').innerHTML = '';
  q.items.forEach(i => addRow(i.desc, i.qty, i.price, i.disc || 0));
  calcTotals();
  document.getElementById('quoteNumDisplay').textContent = `Editando ${q.quote_num}`;
}

// ─── SETTINGS ─────────────────────────────────────────────────
function loadSettings() {
  if (!currentUser) return;
  document.getElementById('setCompany').value = currentUser.company    || '';
  document.getElementById('setAddress').value = currentUser.address    || '';
  document.getElementById('setPhone').value   = currentUser.phone      || '';
  document.getElementById('setEmail').value   = currentUser.email      || '';
  document.getElementById('setTax').value     = currentUser.tax_rate   ?? 12;
}

async function saveSettings() {
  const payload = {
    company:  document.getElementById('setCompany').value,
    address:  document.getElementById('setAddress').value,
    phone:    document.getElementById('setPhone').value,
    email:    document.getElementById('setEmail').value,
    tax_rate: parseFloat(document.getElementById('setTax').value) || 12,
  };
  await apiFetch('/api/me', 'PUT', payload);
  currentUser = { ...currentUser, ...payload };
  fillCompanyFromProfile();
  toast('Configuración guardada ✓', 'success');
}

// ─── LOGO ─────────────────────────────────────────────────────
function triggerLogoUpload() {
  document.getElementById('logoInput').click();
}
function loadLogo(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    logoDataURL = ev.target.result;
    const box   = document.getElementById('logoBox');
    box.innerHTML = `<img src="${logoDataURL}" alt="logo" />`;
  };
  reader.readAsDataURL(file);
}

// ─── PDF ─────────────────────────────────────────────────────
async function downloadPDF() {
  const items    = getItems();
  const subtotal = items.reduce((s,i) => s+i.total, 0);
  const rate     = parseFloat(currentUser?.tax_rate ?? 12) / 100;
  const tax      = subtotal * rate;
  const total    = subtotal + tax;
  const company  = document.getElementById('companyName').value   || 'Mi Empresa';
  const address  = document.getElementById('companyAddress').value || '';
  const phone    = document.getElementById('companyPhone').value   || '';
  const email    = document.getElementById('companyEmail').value   || '';
  const qNum     = document.getElementById('quoteNum').value       || 'COT-0001';
  const qDate    = document.getElementById('quoteDate').value      || '';
  const client   = document.getElementById('clientName').value     || '-';
  const cPhone   = document.getElementById('clientPhone').value    || '';
  const cEmail   = document.getElementById('clientEmail').value    || '';
  const notes    = document.getElementById('quoteNotes').value     || '';
  const status   = document.getElementById('quoteStatus').value    || 'pendiente';

  // Detect mobile
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Build printable HTML
  const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Cotización ${qNum}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; color: #111; background: #fff; padding: 32px; max-width: 794px; margin: auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; border-bottom: 2px solid #e63329; padding-bottom: 20px; }
  .company-name { font-size: 18px; font-weight: 700; }
  .company-info { font-size: 12px; color: #555; margin-top: 4px; }
  .quote-title { font-size: 26px; font-weight: 800; color: #e63329; text-align: right; }
  .quote-num { font-size: 18px; font-weight: 700; font-family: monospace; text-align: right; margin-top: 4px; }
  .quote-date { font-size: 12px; color: #555; text-align: right; margin-top: 4px; }
  .status-badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 700; text-transform: uppercase; margin-top: 6px; }
  .client-box { background: #f8f8f8; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px; }
  .client-label { font-size: 10px; font-weight: 700; letter-spacing: 1.5px; color: #888; margin-bottom: 8px; }
  .client-name { font-size: 15px; font-weight: 700; }
  .client-info { font-size: 12px; color: #555; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px; }
  thead tr { background: #111; color: #fff; }
  th { padding: 9px 10px; text-align: left; }
  th:not(:first-child) { text-align: right; }
  td { padding: 8px 10px; border-bottom: 1px solid #eee; }
  td:not(:first-child) { text-align: right; font-family: monospace; }
  tr:nth-child(even) { background: #f8f8f8; }
  .totals { display: flex; justify-content: flex-end; margin-bottom: 28px; }
  .totals-box { width: 240px; }
  .totals-row { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid #eee; font-size: 13px; color: #555; }
  .totals-row span:last-child { font-family: monospace; }
  .total-final { background: #e63329; color: #fff; padding: 10px; border-radius: 6px; display: flex; justify-content: space-between; font-size: 16px; font-weight: 700; margin-top: 6px; }
  .notes-box { background: #f8f8f8; border-radius: 8px; padding: 12px 16px; margin-bottom: 28px; font-size: 12px; color: #444; }
  .notes-label { font-size: 10px; font-weight: 700; letter-spacing: 1.5px; color: #888; margin-bottom: 6px; }
  .signatures { display: flex; justify-content: space-around; margin-top: 40px; padding-top: 28px; border-top: 1px solid #eee; }
  .sig-line { width: 160px; border-top: 1.5px solid #333; margin: 0 auto; padding-top: 8px; font-size: 11px; color: #555; text-align: center; }
  .footer { text-align: center; margin-top: 24px; font-size: 10px; color: #bbb; }
  .print-btn { position: fixed; bottom: 20px; right: 20px; background: #e63329; color: #fff; border: none; border-radius: 10px; padding: 14px 24px; font-size: 15px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.2); z-index: 999; }
  @media print { .print-btn { display: none; } body { padding: 0; } }
</style>
</head>
<body>
<div class="header">
  <div>
    ${logoDataURL ? `<img src="${logoDataURL}" style="height:50px;object-fit:contain;margin-bottom:6px;display:block"/>` : ''}
    <div class="company-name">${esc(company)}</div>
    <div class="company-info">${esc(address)}</div>
    <div class="company-info">${esc(phone)}${email ? ' · ' + esc(email) : ''}</div>
  </div>
  <div>
    <div class="quote-title">COTIZACIÓN</div>
    <div class="quote-num">${qNum}</div>
    <div class="quote-date">Fecha: ${formatDate(qDate)}</div>
    <div style="text-align:right">
      <span class="status-badge" style="background:${status==='aprobada'?'#d1fae5':status==='rechazada'?'#fee2e2':'#fef3c7'};color:${status==='aprobada'?'#065f46':status==='rechazada'?'#991b1b':'#92400e'}">${status}</span>
    </div>
  </div>
</div>

<div class="client-box">
  <div class="client-label">DATOS DEL CLIENTE</div>
  <div class="client-name">${esc(client)}</div>
  ${cPhone ? `<div class="client-info">${esc(cPhone)}</div>` : ''}
  ${cEmail ? `<div class="client-info">${esc(cEmail)}</div>` : ''}
</div>

<table>
  <thead><tr><th>Descripción</th><th>Cant.</th><th>Precio</th><th>Desc.</th><th>Total</th></tr></thead>
  <tbody>
    ${items.map(i => `<tr>
      <td>${esc(i.desc)}</td>
      <td>${i.qty}</td>
      <td>${fmt(i.price)}</td>
      <td>${i.disc||0}%</td>
      <td>${fmt(i.total)}</td>
    </tr>`).join('')}
  </tbody>
</table>

<div class="totals">
  <div class="totals-box">
    <div class="totals-row"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
    <div class="totals-row"><span>IVA (${currentUser?.tax_rate??12}%)</span><span>${fmt(tax)}</span></div>
    <div class="total-final"><span>TOTAL</span><span>${fmt(total)}</span></div>
  </div>
</div>

${notes ? `<div class="notes-box"><div class="notes-label">NOTAS</div>${esc(notes)}</div>` : ''}

<div class="signatures">
  <div><div class="sig-line">Firma Cliente</div></div>
  <div><div class="sig-line">Firma Técnico / Vendedor</div></div>
</div>

<div class="footer">Generado con QuotePro · ${new Date().toLocaleString()}</div>

<button class="print-btn" onclick="window.print()">🖨️ Guardar / Imprimir PDF</button>
</body></html>`;

  // Open in new tab — works on both desktop and mobile
  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, '_blank');

  if (!win) {
    // If popup blocked, fallback: show instructions
    toast('Permite las ventanas emergentes para ver el PDF', 'error');
  } else {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast('PDF listo — usa el botón rojo para guardar/imprimir', 'success');
  }
}

// ─── HELPERS ─────────────────────────────────────────────────
function fmt(n) {
  return `Q ${Number(n||0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function formatDate(d) {
  if (!d) return '';
  try {
    const dt = new Date(d.includes('T') ? d : d + 'T12:00:00');
    return dt.toLocaleDateString('es-GT', { day:'2-digit', month:'short', year:'numeric' });
  } catch { return d; }
}
function toast(msg, type='success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `toast ${type}`;
  t.classList.remove('hidden');
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => t.classList.add('hidden'), 3200);
}

async function apiFetch(url, method='GET', body=null) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res  = await fetch(`${API}${url}`, opts);
  if (!res.ok) { const e = await res.json().catch(()=>({error:'Error'})); throw new Error(e.error); }
  return res.json();
}

// Enter key on login
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !document.getElementById('loginScreen').classList.contains('hidden')) {
    doLogin();
  }
});
