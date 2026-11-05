const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { Database } = require('node-sqlite3-wasm');
const fs = require('fs');

let db;
try {
    db = new Database(path.join(__dirname, 'control_clientes.db'));
} catch (error) {
    console.error("Error al abrir la base de datos:", error);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 850,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false 
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

ipcMain.handle('obtener-clientes', () => {
    try {
        const query = `
            SELECT c.id, c.nombre, c.cedula, c.celular,
            IFNULL(p.valor_cuota * p.numero_cuotas, 0) as total_pagar,
            IFNULL((SELECT SUM(valor_pagado) FROM cuotas_pagadas WHERE id_prestamo = p.id), 0) as pagado,
            p.fecha_inicio, p.periodicidad
            FROM clientes c
            LEFT JOIN prestamos p ON c.id = p.id_cliente
        `;
        const stmt = db.prepare(query);
        const result = stmt.all();
        stmt.finalize();
        return result;
    } catch (e) { return []; }
});

ipcMain.handle('obtener-detalle-cliente', (event, id_cliente) => {
    try {
        const stmtCliente = db.prepare('SELECT * FROM clientes WHERE id = ?');
        const cliente = stmtCliente.get(id_cliente);
        stmtCliente.finalize();

        const stmtPrestamo = db.prepare('SELECT * FROM prestamos WHERE id_cliente = ?');
        const prestamo = stmtPrestamo.get(id_cliente);
        stmtPrestamo.finalize();

        let pagado = 0;
        if (prestamo) {
            const stmtPagos = db.prepare('SELECT SUM(valor_pagado) as total FROM cuotas_pagadas WHERE id_prestamo = ?');
            const resPagos = stmtPagos.get(prestamo.id);
            pagado = resPagos.total || 0;
            stmtPagos.finalize();
        }
        return { cliente, prestamo, pagado };
    } catch (e) { return null; }
});

// ESTA ES LA PARTE CRÍTICA QUE ESTAMOS BLINDANDO
ipcMain.handle('nuevo-cliente', (event, datos) => {
    console.log("--> Datos que llegaron a main.js:", datos); // ESTO NOS DIRÁ QUÉ ESTÁ PASANDO
    
    try {
        if (!datos) {
            return { success: false, error: "No se recibieron datos desde el formulario." };
        }

        // Limpiamos los datos por si llegan con espacios
        const nombre = datos.nombre ? String(datos.nombre).trim() : "";
        const cedula = datos.cedula ? String(datos.cedula).trim() : "";
        const celular = datos.celular ? String(datos.celular).trim() : "";
        const direccion = datos.direccion ? String(datos.direccion).trim() : "";

        if (nombre === "" || cedula === "") {
            return { success: false, error: "¡El nombre y la cédula no pueden estar vacíos!" };
        }

        const stmt = db.prepare('INSERT INTO clientes (nombre, cedula, celular, direccion) VALUES (?, ?, ?, ?)');
        stmt.run(nombre, cedula, celular, direccion);
        stmt.finalize();
        return { success: true };
    } catch (error) {
        console.error("--> Error de SQLite atrapado:", error.message);
        if (error.message.includes("UNIQUE constraint failed")) {
            return { success: false, error: "Esta cédula ya está registrada." };
        }
        return { success: false, error: error.message };
    }
});

ipcMain.handle('nuevo-prestamo', (event, datos) => {
    try {
        const stmt = db.prepare('INSERT INTO prestamos (id_cliente, monto_prestado, valor_cuota, numero_cuotas, periodicidad, fecha_inicio) VALUES (?, ?, ?, ?, ?, ?)');
        stmt.run(datos.id_cliente, datos.monto_prestado, datos.valor_cuota, datos.numero_cuotas, datos.periodicidad, datos.fecha_inicio);
        stmt.finalize();
        return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('registrar-pago', (event, datos) => {
    try {
        const stmt = db.prepare('INSERT INTO cuotas_pagadas (id_prestamo, fecha, valor_pagado) VALUES (?, ?, ?)');
        stmt.run(datos.id_prestamo, datos.fecha, datos.monto);
        stmt.finalize();
        return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('obtener-historial', (event, id_prestamo) => {
    try {
        const stmt = db.prepare('SELECT id, fecha, valor_pagado FROM cuotas_pagadas WHERE id_prestamo = ? ORDER BY fecha DESC');
        const result = stmt.all(id_prestamo);
        stmt.finalize();
        return result;
    } catch (e) { return []; }
});

ipcMain.handle('eliminar-pago', (event, id_pago) => {
    try {
        const stmt = db.prepare('DELETE FROM cuotas_pagadas WHERE id = ?');
        stmt.run(id_pago);
        stmt.finalize();
        return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('hacer-respaldo', async () => {
    try {
        const { filePath } = await dialog.showSaveDialog({
            title: 'Guardar Respaldo',
            defaultPath: `respaldo_${new Date().getTime()}.db`,
            filters: [{ name: 'Base de Datos', extensions: ['db'] }]
        });
        if (filePath) {
            fs.copyFileSync(path.join(__dirname, 'control_clientes.db'), filePath);
            return { success: true };
        }
        return { success: false, canceled: true };
    } catch (error) { return { success: false, error: error.message }; }
});