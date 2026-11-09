const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Database } = require('node-sqlite3-wasm');

const RUTA_DB = app.isPackaged
  ? path.join(app.getPath('userData'), 'prestamos.db')
  : path.join(__dirname, 'prestamos.db');

const db = new Database(RUTA_DB);
db.exec('PRAGMA foreign_keys = ON');

// --- CREACIÓN Y MIGRACIÓN DE TABLAS ---
db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT UNIQUE NOT NULL,
  sal TEXT NOT NULL,
  clave_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cedula TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  celular TEXT,
  direccion TEXT,
  monto_prestado REAL NOT NULL DEFAULT 0,
  valor_cuota REAL NOT NULL,
  numero_cuotas INTEGER NOT NULL,
  frecuencia_dias INTEGER NOT NULL,
  fecha_inicio TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  valor REAL NOT NULL
);
`);

// Agregar columnas nuevas si no existen (Migración)
try { db.exec("ALTER TABLE clientes ADD COLUMN fecha_eliminacion TEXT DEFAULT NULL"); } catch(e){}
try { db.exec("ALTER TABLE clientes ADD COLUMN interes_mora REAL DEFAULT 0"); } catch(e){}
try { db.exec("ALTER TABLE pagos ADD COLUMN estado TEXT DEFAULT 'activo'"); } catch(e){}

// --- PURGAR PAPELERA (Clientes con más de 30 días eliminados) ---
db.run(`
  DELETE FROM clientes 
  WHERE fecha_eliminacion IS NOT NULL 
  AND date(fecha_eliminacion) < date('now', '-30 days')
`);

function crearVentana() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
}

app.whenReady().then(crearVentana);
app.on('window-all-closed', () => app.quit());

function canal(nombre, fn) {
  ipcMain.handle(nombre, (e, datos) => {
    try { return fn(datos || {}); } 
    catch (err) {
      let msg = err.message || String(err);
      if (msg.includes('UNIQUE') && msg.includes('cedula')) msg = 'Ya existe un cliente con esa cédula.';
      return { success: false, error: msg };
    }
  });
}

// ---------- USUARIOS ----------
const hashClave = (clave, sal) => crypto.scryptSync(clave, sal, 64).toString('hex');
canal('hay-usuarios', () => db.get('SELECT COUNT(*) AS total FROM usuarios').total > 0);
canal('crear-usuario', (d) => {
  if (db.get('SELECT COUNT(*) AS total FROM usuarios').total > 0) return { success: false, error: 'Ya existe un usuario.' };
  const usuario = String(d.usuario || '').trim();
  const clave = String(d.clave || '');
  if (!usuario) return { success: false, error: 'El usuario es obligatorio.' };
  if (clave.length < 4) return { success: false, error: 'La clave debe tener mínimo 4 caracteres.' };
  const sal = crypto.randomBytes(16).toString('hex');
  db.run('INSERT INTO usuarios (usuario, sal, clave_hash) VALUES (?, ?, ?)', [usuario, sal, hashClave(clave, sal)]);
  return { success: true };
});
canal('iniciar-sesion', (d) => {
  const u = db.get('SELECT * FROM usuarios WHERE usuario = ?', [String(d.usuario || '').trim()]);
  if (!u || hashClave(String(d.clave || ''), u.sal) !== u.clave_hash) return { success: false, error: 'Usuario o clave incorrectos.' };
  return { success: true };
});

// ---------- CLIENTES ----------
canal('listar-clientes', () => {
  const lista = db.all(`
    SELECT c.*, COALESCE((SELECT SUM(valor) FROM pagos WHERE cliente_id = c.id AND estado = 'activo'), 0) AS total_pagado
    FROM clientes c WHERE c.fecha_eliminacion IS NULL ORDER BY c.nombre COLLATE NOCASE`);
  return { success: true, clientes: lista };
});

canal('listar-eliminados', () => {
  const lista = db.all(`
    SELECT c.*, COALESCE((SELECT SUM(valor) FROM pagos WHERE cliente_id = c.id AND estado = 'activo'), 0) AS total_pagado,
    CAST(julianday('now') - julianday(c.fecha_eliminacion) AS INTEGER) as dias_en_papelera
    FROM clientes c WHERE c.fecha_eliminacion IS NOT NULL ORDER BY c.fecha_eliminacion DESC`);
  return { success: true, clientes: lista };
});

canal('guardar-cliente', (d) => {
  const cedula = String(d.cedula || '').trim();
  const nombre = String(d.nombre || '').trim();
  const celular = String(d.celular || '').trim();
  const direccion = String(d.direccion || '').trim();
  const monto = Number(d.monto_prestado);
  const cuota = Number(d.valor_cuota);
  const ncuotas = parseInt(d.numero_cuotas, 10);
  const frec = parseInt(d.frecuencia_dias, 10);
  const mora = Number(d.interes_mora) || 0;
  const fecha = String(d.fecha_inicio || '').trim();

  if (!cedula) return { success: false, error: 'La cédula es obligatoria.' };
  if (!nombre) return { success: false, error: 'El nombre es obligatorio.' };
  if (!(cuota > 0)) return { success: false, error: 'El valor de la cuota debe ser mayor a 0.' };
  
  if (d.id) {
    db.run(`UPDATE clientes SET cedula=?, nombre=?, celular=?, direccion=?, monto_prestado=?,
            valor_cuota=?, numero_cuotas=?, frecuencia_dias=?, interes_mora=?, fecha_inicio=? WHERE id=?`,
      [cedula, nombre, celular, direccion, monto, cuota, ncuotas, frec, mora, fecha, d.id]);
    return { success: true, id: d.id };
  }
  const r = db.run(`INSERT INTO clientes
    (cedula, nombre, celular, direccion, monto_prestado, valor_cuota, numero_cuotas, frecuencia_dias, interes_mora, fecha_inicio)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [cedula, nombre, celular, direccion, monto, cuota, ncuotas, frec, mora, fecha]);
  return { success: true, id: Number(r.lastInsertRowid) };
});

canal('eliminar-cliente', (d) => {
  const hoy = new Date().toISOString().slice(0, 10);
  db.run('UPDATE clientes SET fecha_eliminacion = ? WHERE id = ?', [hoy, d.id]);
  return { success: true };
});

canal('restaurar-cliente', (d) => {
  db.run('UPDATE clientes SET fecha_eliminacion = NULL WHERE id = ?', [d.id]);
  return { success: true };
});

// ---------- PAGOS ----------
canal('listar-pagos', (d) => ({
  success: true,
  pagos: db.all('SELECT * FROM pagos WHERE cliente_id = ? ORDER BY fecha DESC, id DESC', [d.cliente_id])
}));

canal('registrar-pago', (d) => {
  const c = db.get('SELECT * FROM clientes WHERE id = ?', [d.cliente_id]);
  if (!c) return { success: false, error: 'Cliente no encontrado.' };
  const valor = Number(d.valor);
  if (!(valor > 0)) return { success: false, error: 'El valor del abono debe ser mayor a 0.' };

  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '') ? d.fecha : new Date().toISOString().slice(0, 10);
  db.run('INSERT INTO pagos (cliente_id, fecha, valor, estado) VALUES (?, ?, ?, ?)', [c.id, fecha, valor, 'activo']);
  return { success: true };
});

canal('anular-pago', (d) => {
  db.run("UPDATE pagos SET estado = 'anulado' WHERE id = ?", [d.id]);
  return { success: true };
});

// ---------- CIERRE DE CAJA ----------
canal('cierre-caja', () => {
  const hoy = new Date().toISOString().slice(0, 10);
  const res = db.get("SELECT COALESCE(SUM(valor), 0) as total FROM pagos WHERE fecha = ? AND estado = 'activo'", [hoy]);
  return { success: true, total: res.total };
});

// ---------- RESPALDO Y EXPORTAR ----------
ipcMain.handle('hacer-respaldo', async () => {
  const hoy = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog({ title: 'Guardar respaldo', defaultPath: `respaldo_${hoy}.db`, filters: [{ name: 'Base de datos', extensions: ['db'] }] });
  if (r.canceled || !r.filePath) return { success: false, cancelado: true };
  try { fs.copyFileSync(RUTA_DB, r.filePath); return { success: true }; } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('exportar-csv', async (e, filas) => {
  const hoy = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog({ title: 'Guardar CSV', defaultPath: `reporte_${hoy}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (r.canceled || !r.filePath) return { success: false, cancelado: true };
  try {
    const headers = ['Cédula', 'Nombre', 'Celular', 'Monto prestado', 'Valor cuota', 'Número cuotas', 'Total pagado', 'Saldo', 'Estado'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = filas.map((f) => [f.cedula, f.nombre, f.celular, f.monto_prestado, f.valor_cuota, f.numero_cuotas, f.total_pagado, f.saldo, f.estado]);
    fs.writeFileSync(r.filePath, '\ufeff' + [headers, ...rows].map((r) => r.map(esc).join(';')).join('\r\n'), 'utf8');
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('abrir-externo', async (e, url) => {
  if (typeof url === 'string' && (url.startsWith('http') || url.startsWith('whatsapp://'))) {
    try { await shell.openExternal(url); return { success: true }; } catch (err) { return { success: false, error: err.message }; }
  }
  return { success: false };
});

ipcMain.handle('notificar', async (e, titulo, cuerpo) => {
  new Notification({ title: titulo, body: cuerpo }).show();
  return { success: true };
});