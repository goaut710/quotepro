# QuotePro – Sistema Profesional de Cotizaciones

Aplicación SaaS completa para generar, guardar y gestionar cotizaciones profesionales.

---

## 🚀 Instalación rápida

### 1. Requisitos
- Node.js 18 o superior → https://nodejs.org

### 2. Instalar dependencias
```bash
cd quotepro
npm install
```

### 3. Ejecutar el servidor
```bash
# Producción
npm start

# Desarrollo (con auto-reload)
npm run dev
```

### 4. Abrir en el navegador
```
http://localhost:3000
```

---

## 🔐 Credenciales de demo

| Usuario | Contraseña |
|---------|-----------|
| admin   | admin123  |

Puedes crear nuevas cuentas desde la pantalla de login.

---

## 📁 Estructura del proyecto

```
quotepro/
├── server.js          ← Backend Node.js + Express + SQLite
├── package.json       ← Dependencias
├── db/
│   └── quotepro.db    ← Base de datos SQLite (auto-generada)
└── public/
    ├── index.html     ← SPA principal
    ├── style.css      ← Estilos (tema oscuro + rojo)
    └── app.js         ← Lógica frontend
```

---

## ✨ Características

- ✅ Login / Registro de usuarios con contraseñas encriptadas (bcrypt)
- ✅ Sesión persistente 24h
- ✅ Numeración automática de cotizaciones (COT-0001, COT-0002...)
- ✅ Tabla dinámica de ítems con subtotal por fila
- ✅ Cálculo automático de subtotal, IVA (configurable) y total
- ✅ Descuento por ítem en porcentaje
- ✅ Logo de empresa personalizable (upload de imagen)
- ✅ Generación de PDF en A4 con diseño profesional
- ✅ Historial con búsqueda por cliente o número
- ✅ Ver detalle de cotización en modal
- ✅ Editar cotizaciones existentes
- ✅ Eliminar cotizaciones
- ✅ Estados: Pendiente / Aprobada / Rechazada
- ✅ Configuración de empresa (nombre, dirección, teléfono, email, % IVA)
- ✅ Diseño responsivo (funciona en móvil)
- ✅ API REST completa

---

## 🛠 API REST

| Método | Endpoint              | Descripción               |
|--------|-----------------------|---------------------------|
| POST   | /api/login            | Iniciar sesión            |
| POST   | /api/logout           | Cerrar sesión             |
| POST   | /api/register         | Crear cuenta              |
| GET    | /api/me               | Perfil del usuario        |
| PUT    | /api/me               | Actualizar perfil         |
| GET    | /api/quotes           | Listar cotizaciones       |
| POST   | /api/quotes           | Crear cotización          |
| GET    | /api/quotes/:id       | Ver cotización            |
| PUT    | /api/quotes/:id       | Editar cotización         |
| DELETE | /api/quotes/:id       | Eliminar cotización       |

---

## ⚙️ Variables de entorno

```env
PORT=3000    # Puerto del servidor (default: 3000)
```

---

## 📦 Dependencias

| Paquete           | Uso                          |
|-------------------|------------------------------|
| express           | Servidor web                 |
| better-sqlite3    | Base de datos SQLite         |
| bcryptjs          | Hash de contraseñas          |
| express-session   | Manejo de sesiones           |
| cors              | Cross-origin requests        |
| nodemon (dev)     | Auto-reload en desarrollo    |
