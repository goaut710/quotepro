// ═══════════════════════════════════════════════════════
//  QuotePro — app.js
//  Constructora D'Sanchez
// ═══════════════════════════════════════════════════════

let currentUser = null;
let currentQuote = null;
let editingId = null;
let signatureCanvas, signatureCtx, isDrawing = false;
let catalogProducts = [];

// ── UTILIDADES ───────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt = n => 'Q' + parseFloat(n || 0).toFixed(2);

function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  $(page)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
}

function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3000);
}

// ── AUTH ─────────────────────────────────────────────────
async function login() {
  const u = $('loginUser').value.trim();
  const p = $('loginPass').value.trim();
  if (!u || !p) return showToast('Completa todos los campos', 'error');
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    });
    if (!r.ok) throw new Error();
    const data = await r.json();
    currentUser = data.username;
    $('loginPage').classList.remove('active');
    $('app').classList.add('active');
    $('userDisplay').textContent = currentUser;
    showPage('newQuote');
    await loadCatalog();
    generateQuoteNumber();
    setToday();
  } catch {
    showToast('Usuario o contraseña incorrectos', 'error');
  }
}

function logout() {
  currentUser = null;
  $('app').classList.remove('active');
  $('loginPage').classList.add('active');
  $('loginUser').value = '';
  $('loginPass').value = '';
}

// ── NÚMERO Y FECHA ───────────────────────────────────────
async function generateQuoteNumber() {
  const quotes = await fetch('/api/quotes').then(r => r.json()).catch(() => []);
  const num = String(quotes.length + 1).padStart(4, '0');
  $('quoteNumber').value = `COT-${num}`;
}

function setToday() {
  $('quoteDate').value = new Date().toLocaleDateString('es-GT');
}

// ── TABLA DE ÍTEMS ───────────────────────────────────────
function addItem(name = '', qty = 1, price = 0) {
  const tbody = $('itemsBody');
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input class="item-input" type="text" placeholder="Descripción del producto/servicio" value="${name}"/></td>
    <td><input class="item-input item-qty" type="number" min="1" value="${qty}" onchange="calcRow(this)"/></td>
    <td><input class="item-input item-price" type="number" min="0" step="0.01" value="${price}" onchange="calcRow(this)"/></td>
    <td class="item-total">Q0.00</td>
    <td><button class="btn-del-row" onclick="removeRow(this)">✕</button></td>
  `;
  tbody.appendChild(row);
  calcRow(row.querySelector('.item-qty'));
}

function calcRow(input) {
  const row = input.closest('tr');
  const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
  const price = parseFloat(row.querySelector('.item-price').value) || 0;
  row.querySelector('.item-total').textContent = fmt(qty * price);
  calcTotals();
}

function removeRow(btn) {
  btn.closest('tr').remove();
  calcTotals();
}

function calcTotals() {
  let sub = 0;
  document.querySelectorAll('#itemsBody tr').forEach(row => {
    const qty = parseFloat(row.querySelector('.item-qty')?.value) || 0;
    const price = parseFloat(row.querySelector('.item-price')?.value) || 0;
    sub += qty * price;
  });
  const taxRate = parseFloat($('taxRate')?.value) || 12;
  const tax = sub * taxRate / 100;
  $('subtotalDisplay').textContent = fmt(sub);
  $('taxDisplay').textContent = fmt(tax);
  $('totalDisplay').textContent = fmt(sub + tax);
}

// ── CATÁLOGO DE PRODUCTOS ────────────────────────────────
async function loadCatalog() {
  const res = await fetch('/api/products').catch(() => ({ json: () => [] }));
  catalogProducts = await res.json().catch(() => []);
  renderCatalog();
}

function renderCatalog(filter = '') {
  const list = $('catalogList');
  if (!list) return;
  const filtered = catalogProducts.filter(p =>
    p.name.toLowerCase().includes(filter.toLowerCase()) ||
    (p.description || '').toLowerCase().includes(filter.toLowerCase())
  );
  if (!filtered.length) {
    list.innerHTML = '<div class="catalog-empty">No hay productos. ¡Agrega el primero!</div>';
    return;
  }
  list.innerHTML = filtered.map(p => `
    <div class="catalog-item">
      <div class="catalog-item-info">
        <span class="catalog-name">${p.name}</span>
        <span class="catalog-desc">${p.description || ''}</span>
        <span class="catalog-price">${fmt(p.price)} / ${p.unit || 'unidad'}</span>
      </div>
      <div class="catalog-actions">
        <button class="btn-add-to-quote" onclick="addFromCatalog(${p.id})" title="Agregar a cotización">＋</button>
        <button class="btn-edit-product" onclick="editProduct(${p.id})" title="Editar">✏️</button>
        <button class="btn-del-product" onclick="deleteProduct(${p.id})" title="Eliminar">🗑️</button>
      </div>
    </div>`).join('');
}

function addFromCatalog(id) {
  const p = catalogProducts.find(x => x.id === id);
  if (!p) return;
  // Si estamos en nueva cotización, agregar el producto
  if ($('newQuote').classList.contains('active')) {
    addItem(p.name, 1, p.price);
    showToast(`"${p.name}" agregado a la cotización`);
  } else {
    showPage('newQuote');
    setTimeout(() => addItem(p.name, 1, p.price), 200);
    showToast(`"${p.name}" agregado a la cotización`);
  }
}

async function saveProduct() {
  const name = $('prodName').value.trim();
  const description = $('prodDesc').value.trim();
  const price = parseFloat($('prodPrice').value) || 0;
  const unit = $('prodUnit').value.trim() || 'unidad';
  const editId = $('editProdId').value;

  if (!name || !price) return showToast('Nombre y precio son requeridos', 'error');

  const url = editId ? `/api/products/${editId}` : '/api/products';
  const method = editId ? 'PUT' : 'POST';

  await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, price, unit })
  });

  $('prodName').value = '';
  $('prodDesc').value = '';
  $('prodPrice').value = '';
  $('prodUnit').value = 'unidad';
  $('editProdId').value = '';
  $('saveProdBtn').textContent = '+ Guardar Producto';

  await loadCatalog();
  showToast(editId ? 'Producto actualizado' : 'Producto guardado');
}

function editProduct(id) {
  const p = catalogProducts.find(x => x.id === id);
  if (!p) return;
  $('prodName').value = p.name;
  $('prodDesc').value = p.description || '';
  $('prodPrice').value = p.price;
  $('prodUnit').value = p.unit || 'unidad';
  $('editProdId').value = p.id;
  $('saveProdBtn').textContent = '💾 Actualizar Producto';
  $('prodName').focus();
}

async function deleteProduct(id) {
  if (!confirm('¿Eliminar este producto del catálogo?')) return;
  await fetch(`/api/products/${id}`, { method: 'DELETE' });
  await loadCatalog();
  showToast('Producto eliminado');
}

// ── GUARDAR COTIZACIÓN ───────────────────────────────────
async function saveQuote(status = 'Pendiente') {
  const items = [];
  document.querySelectorAll('#itemsBody tr').forEach(row => {
    const desc = row.querySelector('input[type=text]')?.value || '';
    const qty = parseFloat(row.querySelector('.item-qty')?.value) || 0;
    const price = parseFloat(row.querySelector('.item-price')?.value) || 0;
    if (desc || qty || price) {
      items.push({ description: desc, quantity: qty, price, total: qty * price });
    }
  });

  const sub = items.reduce((a, b) => a + b.total, 0);
  const taxRate = parseFloat($('taxRate')?.value) || 12;
  const tax = sub * taxRate / 100;

  const payload = {
    client_name: $('clientName').value.trim(),
    client_email: $('clientEmail').value.trim(),
    client_phone: $('clientPhone').value.trim(),
    client_address: $('clientAddress').value.trim(),
    project_description: $('projectDesc').value.trim(),
    items: JSON.stringify(items),
    subtotal: sub,
    tax_rate: taxRate,
    tax_amount: tax,
    total: sub + tax,
    signature: $('signatureData').value || null,
    status
  };

  const url = editingId ? `/api/quotes/${editingId}` : '/api/quotes';
  const method = editingId ? 'PUT' : 'POST';

  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const saved = await r.json();

  showToast('✅ Cotización guardada correctamente');
  editingId = null;
  clearForm();
  return saved;
}

async function saveAndPDF() {
  const saved = await saveQuote('Pendiente');
  const id = saved.id || editingId;
  if (id) openPDF(id);
}

function openPDF(id) {
  window.open(`/api/quotes/${id}/pdf`, '_blank');
}

function clearForm() {
  $('clientName').value = '';
  $('clientEmail').value = '';
  $('clientPhone').value = '';
  $('clientAddress').value = '';
  $('projectDesc').value = '';
  $('itemsBody').innerHTML = '';
  $('signatureData').value = '';
  clearSignature();
  generateQuoteNumber();
  calcTotals();
}

// ── FIRMA DIGITAL ────────────────────────────────────────
function initSignature() {
  signatureCanvas = $('signatureCanvas');
  if (!signatureCanvas) return;
  signatureCtx = signatureCanvas.getContext('2d');
  signatureCtx.strokeStyle = '#111';
  signatureCtx.lineWidth = 2;
  signatureCtx.lineCap = 'round';

  const getPos = e => {
    const rect = signatureCanvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  };

  signatureCanvas.addEventListener('mousedown', e => { isDrawing = true; const p = getPos(e); signatureCtx.beginPath(); signatureCtx.moveTo(p.x, p.y); });
  signatureCanvas.addEventListener('mousemove', e => { if (!isDrawing) return; const p = getPos(e); signatureCtx.lineTo(p.x, p.y); signatureCtx.stroke(); });
  signatureCanvas.addEventListener('mouseup', () => { isDrawing = false; saveSignature(); });
  signatureCanvas.addEventListener('touchstart', e => { e.preventDefault(); isDrawing = true; const p = getPos(e); signatureCtx.beginPath(); signatureCtx.moveTo(p.x, p.y); }, { passive: false });
  signatureCanvas.addEventListener('touchmove', e => { e.preventDefault(); if (!isDrawing) return; const p = getPos(e); signatureCtx.lineTo(p.x, p.y); signatureCtx.stroke(); }, { passive: false });
  signatureCanvas.addEventListener('touchend', () => { isDrawing = false; saveSignature(); });
}

function saveSignature() {
  if ($('signatureData')) $('signatureData').value = signatureCanvas.toDataURL();
}

function clearSignature() {
  if (signatureCtx) signatureCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
  if ($('signatureData')) $('signatureData').value = '';
}

// ── HISTORIAL ────────────────────────────────────────────
async function loadHistory() {
  const quotes = await fetch('/api/quotes').then(r => r.json()).catch(() => []);
  const search = $('searchHistory')?.value?.toLowerCase() || '';
  const filtered = quotes.filter(q =>
    (q.client_name || '').toLowerCase().includes(search) ||
    (q.quote_number || '').toLowerCase().includes(search)
  );
  const tbody = $('historyBody');
  if (!tbody) return;
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:#666;">Sin cotizaciones</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(q => `
    <tr>
      <td>${q.quote_number}</td>
      <td>${q.client_name || '—'}</td>
      <td>${fmt(q.total)}</td>
      <td><span class="badge badge-${q.status?.toLowerCase()}">${q.status}</span></td>
      <td>${new Date(q.created_at).toLocaleDateString('es-GT')}</td>
      <td class="history-actions">
        <button onclick="viewQuote(${q.id})" title="Ver PDF">📄</button>
        <button onclick="editQuote(${q.id})" title="Editar">✏️</button>
        <button onclick="deleteQuote(${q.id})" title="Eliminar">🗑️</button>
      </td>
    </tr>`).join('');
}

function viewQuote(id) { openPDF(id); }

async function editQuote(id) {
  const q = await fetch(`/api/quotes/${id}`).then(r => r.json());
  editingId = id;
  $('clientName').value = q.client_name || '';
  $('clientEmail').value = q.client_email || '';
  $('clientPhone').value = q.client_phone || '';
  $('clientAddress').value = q.client_address || '';
  $('projectDesc').value = q.project_description || '';
  $('quoteNumber').value = q.quote_number;
  $('taxRate').value = q.tax_rate || 12;
  $('itemsBody').innerHTML = '';
  let items = [];
  try { items = JSON.parse(q.items || '[]'); } catch(e) {}
  items.forEach(item => addItem(item.description, item.quantity, item.price));
  if (q.signature) $('signatureData').value = q.signature;
  calcTotals();
  showPage('newQuote');
  showToast('Cotización cargada para editar');
}

async function deleteQuote(id) {
  if (!confirm('¿Eliminar esta cotización?')) return;
  await fetch(`/api/quotes/${id}`, { method: 'DELETE' });
  loadHistory();
  showToast('Cotización eliminada');
}

// ── NAVEGACIÓN ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Login con Enter
  $('loginPass')?.addEventListener('keypress', e => e.key === 'Enter' && login());

  // Navegación sidebar
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      showPage(page);
      if (page === 'history') loadHistory();
      if (page === 'catalog') { loadCatalog(); }
    });
  });

  // Inicializar firma
  initSignature();

  // Buscar en historial
  $('searchHistory')?.addEventListener('input', loadHistory);

  // Buscar en catálogo
  $('searchCatalog')?.addEventListener('input', e => renderCatalog(e.target.value));

  // Tax rate
  $('taxRate')?.addEventListener('change', calcTotals);

  // Iniciar con login
  $('loginPage')?.classList.add('active');
});
