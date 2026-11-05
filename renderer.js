const { ipcRenderer } = require('electron');

// ==========================================
// 1. VARIABLES GLOBALES Y TEMAS
// ==========================================
let clienteSeleccionadoId = null;
const selectorTema = document.getElementById('selector-tema');
const body = document.body;
const temaGuardado = localStorage.getItem('tema-prestamos') || 'light-blue';
body.setAttribute('data-theme', temaGuardado);
selectorTema.value = temaGuardado;

selectorTema.addEventListener('change', (e) => {
    body.setAttribute('data-theme', e.target.value);
    localStorage.setItem('tema-prestamos', e.target.value);
});

const Toast = Swal.mixin({
  toast: true, position: "top-end", showConfirmButton: false, timer: 3000, timerProgressBar: true
});

function probarAlerta() {
    Toast.fire({ icon: 'info', title: '¡Notificación flotante funcionando!' });
}

function formatearDinero(valor) {
    return `$${valor.toLocaleString('es-CO')}`;
}

// ==========================================
// 2. FUNCIÓN 1: CALCULAR ESTADO DEL PRÉSTAMO
// ==========================================
function calcularEstado(prestamo, pagado) {
    if (!prestamo || prestamo.total_pagar === 0) return { texto: "Sin Préstamo", clase: "" };
    
    const total_a_pagar = prestamo.total_pagar;
    const saldo = total_a_pagar - pagado;
    
    if (saldo <= 0) return { texto: "Pagado", clase: "status-verde" };

    let cuotas_pagadas = Math.floor(pagado / prestamo.valor_cuota);
    if (cuotas_pagadas < 0) cuotas_pagadas = 0;

    let dias_periodo = 30; 
    const per = prestamo.periodicidad.toLowerCase();
    if (per.includes("diaria")) dias_periodo = 1;
    else if (per.includes("semanal")) dias_periodo = 7;
    else if (per.includes("quincenal")) dias_periodo = 15;

    const fechaInicio = new Date(prestamo.fecha_inicio + 'T00:00:00');
    const fechaProxima = new Date(fechaInicio);
    fechaProxima.setDate(fechaInicio.getDate() + (dias_periodo * (cuotas_pagadas + 1)));

    const hoy = new Date();
    hoy.setHours(0,0,0,0);
    fechaProxima.setHours(0,0,0,0);

    const diffTiempo = fechaProxima.getTime() - hoy.getTime();
    const diffDias = Math.floor(diffTiempo / (1000 * 3600 * 24));

    if (diffDias < 0) {
        return { texto: `Atrasado (${Math.abs(diffDias)} días)`, clase: "status-rojo" };
    } else if (diffDias === 0) {
        return { texto: "Vence hoy", clase: "status-amarillo" };
    } else {
        return { texto: "Al día", clase: "status-verde" };
    }
}

// ==========================================
// 3. CARGAR DATOS EN LA TABLA
// ==========================================
async function cargarDatos() {
    const clientes = await ipcRenderer.invoke('obtener-clientes');
    const tabla = document.getElementById('tabla-clientes');
    tabla.innerHTML = ''; 

    let tPrestado = 0, tRecuperado = 0, tPorCobrar = 0;

    clientes.forEach(c => {
        tPrestado += c.total_pagar;
        tRecuperado += c.pagado;
        let saldo = c.total_pagar - c.pagado;
        if(saldo < 0) saldo = 0;
        tPorCobrar += saldo;

        const estadoObj = calcularEstado(c, c.pagado);

        const fila = document.createElement('tr');
        fila.setAttribute('data-id', c.id);
        fila.innerHTML = `
            <td><strong>${c.nombre}</strong></td>
            <td>${c.cedula}</td>
            <td class="${estadoObj.clase}">${estadoObj.texto}</td>
        `;
        fila.addEventListener('click', () => seleccionarCliente(c.id, fila));
        tabla.appendChild(fila);
    });

    document.getElementById('stat-prestado').innerText = formatearDinero(tPrestado);
    document.getElementById('stat-recuperado').innerText = formatearDinero(tRecuperado);
    document.getElementById('stat-cobrar').innerText = formatearDinero(tPorCobrar);
}

// ==========================================
// 4. MOSTRAR DETALLES EN EL PANEL DERECHO
// ==========================================
async function seleccionarCliente(id, filaElemento) {
    clienteSeleccionadoId = id;
    
    document.querySelectorAll('#tabla-clientes tr').forEach(tr => tr.classList.remove('selected'));
    filaElemento.classList.add('selected');

    const data = await ipcRenderer.invoke('obtener-detalle-cliente', id);
    const panel = document.getElementById('panel-detalle');

    if (!data || !data.cliente) return;

    const { cliente, prestamo, pagado } = data;
    
    let html = `
        <div class="detalle-nombre">${cliente.nombre.toUpperCase()}</div>
        <div class="detalle-info">Cédula: ${cliente.cedula} | Cel: ${cliente.celular || 'N/A'}</div>
    `;

    if (!prestamo) {
        html += `
            <div style="text-align:center; margin-top: 20px;">
                <p style="margin-bottom: 20px; opacity:0.8;">Este cliente no tiene préstamos registrados.</p>
                <button class="btn" onclick="abrirFormularioPrestamo(${cliente.id})">
                    <i class="fa-solid fa-hand-holding-dollar"></i> Registrar Préstamo
                </button>
            </div>
        `;
    } else {
        const prestamoData = {
            total_pagar: prestamo.valor_cuota * prestamo.numero_cuotas,
            valor_cuota: prestamo.valor_cuota,
            fecha_inicio: prestamo.fecha_inicio,
            periodicidad: prestamo.periodicidad
        };
        
        const total = prestamoData.total_pagar;
        const saldo = total - pagado;
        const progreso = (pagado / total) * 100;
        const estadoObj = calcularEstado(prestamoData, pagado);

        html += `
            <div class="detalle-box">
                <h4>Estado del Préstamo</h4>
                <p class="${estadoObj.clase}" style="font-size: 1.5rem;">${estadoObj.texto}</p>
            </div>
            <div class="detalle-box">
                <h4>Total del Préstamo</h4>
                <p>${formatearDinero(total)}</p>
            </div>
            <progress value="${progreso}" max="100"></progress>
            <div style="display:flex; justify-content:space-between; font-weight:bold; margin-bottom: 20px;">
                <span>Pagado: ${formatearDinero(pagado)}</span>
                <span style="color: red;">Saldo: ${formatearDinero(saldo)}</span>
            </div>
            
            <button class="btn" style="background: green; margin-bottom: 10px;" onclick="abrirFormularioPago(${prestamo.id}, ${prestamo.valor_cuota}, ${saldo})">
                <i class="fa-solid fa-money-bill-wave"></i> Registrar Abono
            </button>
            <button class="btn" style="background: #17a2b8;" onclick="verHistorial('${cliente.nombre}', ${prestamo.id})">
                <i class="fa-solid fa-clock-rotate-left"></i> Ver Historial
            </button>
        `;
    }

    panel.innerHTML = html;
}

// ==========================================
// 5. FORMULARIOS (POPUPS)
// ==========================================

// A. Nuevo Cliente (CON VALIDACIÓN PARA EVITAR EL ERROR)
document.getElementById('btn-nuevo-cliente').addEventListener('click', async () => {
    const { value: formValues } = await Swal.fire({
        title: 'Registrar Nuevo Cliente',
        html:
            '<input id="swal-nombre" class="swal2-input" placeholder="Nombre completo">' +
            '<input id="swal-cedula" class="swal2-input" placeholder="Cédula">' +
            '<input id="swal-celular" class="swal2-input" placeholder="Celular">' +
            '<input id="swal-direccion" class="swal2-input" placeholder="Dirección">',
        focusConfirm: false, showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar',
        preConfirm: () => {
            // Atrapamos los valores y les quitamos los espacios vacíos
            const nombre = document.getElementById('swal-nombre').value.trim();
            const cedula = document.getElementById('swal-cedula').value.trim();
            const celular = document.getElementById('swal-celular').value.trim();
            const direccion = document.getElementById('swal-direccion').value.trim();

            // Si alguno está vacío, mostramos la alerta y NO dejamos cerrar el cuadro
            if (!nombre || !cedula) {
                Swal.showValidationMessage('¡El nombre y la cédula son obligatorios!');
                return false; 
            }

            return { nombre, cedula, celular, direccion };
        }
    });

    // Si el usuario llenó todo correctamente, se envían los datos
    if (formValues) {
        const res = await ipcRenderer.invoke('nuevo-cliente', formValues);
        if (res.success) {
            Toast.fire({ icon: 'success', title: 'Cliente guardado' });
            cargarDatos();
        } else {
            // Si la cédula ya existe, saltará este mensaje
            Swal.fire('Error al guardar', res.error, 'error');
        }
    }
});

// B. Registrar Préstamo
async function abrirFormularioPrestamo(id_cliente) {
    const hoy = new Date().toISOString().split('T')[0];
    const { value: formValues } = await Swal.fire({
        title: 'Registrar Préstamo',
        html:
            '<input id="swal-monto" class="swal2-input" type="number" placeholder="Monto Prestado">' +
            '<input id="swal-cuota" class="swal2-input" type="number" placeholder="Valor Cuota">' +
            '<input id="swal-num" class="swal2-input" type="number" placeholder="Número de Cuotas">' +
            '<select id="swal-per" class="swal2-select"><option value="Mensual">Mensual</option><option value="Quincenal">Quincenal</option><option value="Semanal">Semanal</option><option value="Diaria">Diaria</option></select>' +
            `<input id="swal-fecha" class="swal2-input" type="date" value="${hoy}">`,
        focusConfirm: false, showCancelButton: true, confirmButtonText: 'Guardar Préstamo',
        preConfirm: () => {
            return {
                id_cliente: id_cliente,
                monto_prestado: parseFloat(document.getElementById('swal-monto').value),
                valor_cuota: parseFloat(document.getElementById('swal-cuota').value),
                numero_cuotas: parseInt(document.getElementById('swal-num').value),
                periodicidad: document.getElementById('swal-per').value,
                fecha_inicio: document.getElementById('swal-fecha').value
            }
        }
    });

    if (formValues) {
        const res = await ipcRenderer.invoke('nuevo-prestamo', formValues);
        if (res.success) {
            Toast.fire({ icon: 'success', title: 'Préstamo registrado' });
            cargarDatos();
            const fila = document.querySelector(`tr[data-id="${id_cliente}"]`);
            if(fila) seleccionarCliente(id_cliente, fila);
        } else {
            Swal.fire('Error', res.error, 'error');
        }
    }
}

// C. Registrar Abono
async function abrirFormularioPago(id_prestamo, valor_cuota, saldo) {
    const minimo = valor_cuota / 2;
    const hoy = new Date().toISOString().split('T')[0];

    const { value: monto } = await Swal.fire({
        title: 'Registrar Abono',
        html: `
            <p style="margin-bottom:10px; font-weight:bold;">Cuota: ${formatearDinero(valor_cuota)} | Mínimo: ${formatearDinero(minimo)}</p>
            <p style="margin-bottom:10px; color:red;">Saldo pendiente: ${formatearDinero(saldo)}</p>
            <input id="swal-abono" class="swal2-input" type="number" placeholder="Monto a abonar" value="${valor_cuota}">
            <input id="swal-fecha-pago" class="swal2-input" type="date" value="${hoy}">
        `,
        focusConfirm: false, showCancelButton: true, confirmButtonText: 'Confirmar Abono',
        preConfirm: () => {
            const montoIngresado = parseFloat(document.getElementById('swal-abono').value);
            const fecha = document.getElementById('swal-fecha-pago').value;
            
            if (montoIngresado < minimo && montoIngresado !== saldo) {
                Swal.showValidationMessage(`El abono mínimo permitido es: ${formatearDinero(minimo)}`);
                return false;
            }
            if (montoIngresado > saldo) {
                Swal.showValidationMessage(`El abono no puede superar el saldo: ${formatearDinero(saldo)}`);
                return false;
            }
            return { monto: montoIngresado, fecha: fecha };
        }
    });

    if (monto) {
        const res = await ipcRenderer.invoke('registrar-pago', {
            id_prestamo: id_prestamo,
            fecha: monto.fecha,
            monto: monto.monto
        });
        if (res.success) {
            Toast.fire({ icon: 'success', title: 'Abono registrado' });
            cargarDatos();
            const fila = document.querySelector(`tr.selected`);
            if(fila) seleccionarCliente(clienteSeleccionadoId, fila);
        } else {
            Swal.fire('Error', res.error, 'error');
        }
    }
}

// D. Ver Historial
async function verHistorial(nombre, id_prestamo) {
    const historial = await ipcRenderer.invoke('obtener-historial', id_prestamo);
    
    let html = '<table style="width:100%; text-align:left;"><tr><th>Fecha</th><th>Monto</th><th>Acción</th></tr>';
    if(historial.length === 0) {
        html += '<tr><td colspan="3">No hay pagos registrados</td></tr>';
    } else {
        historial.forEach(p => {
            html += `<tr>
                <td>${p.fecha}</td>
                <td>${formatearDinero(p.valor_pagado)}</td>
                <td><button onclick="borrarPago(${p.id})" style="color:red; border:none; background:none; cursor:pointer;"><i class="fa-solid fa-trash"></i></button></td>
            </tr>`;
        });
    }
    html += '</table>';

    Swal.fire({
        title: `Historial: ${nombre}`,
        html: html,
        icon: 'info',
        confirmButtonText: 'Cerrar'
    });
}

async function borrarPago(id_pago) {
    const confirm = await Swal.fire({
        title: '¿Eliminar pago?',
        text: "Esta acción no se puede deshacer",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonText: 'Cancelar',
        confirmButtonText: 'Sí, eliminar'
    });

    if (confirm.isConfirmed) {
        await ipcRenderer.invoke('eliminar-pago', id_pago);
        Swal.close();
        Toast.fire({ icon: 'success', title: 'Pago eliminado' });
        cargarDatos();
        const fila = document.querySelector(`tr.selected`);
        if(fila) seleccionarCliente(clienteSeleccionadoId, fila);
    }
}

document.getElementById('btn-respaldo').addEventListener('click', async () => {
    const res = await ipcRenderer.invoke('hacer-respaldo');
    if (res.success) Toast.fire({ icon: 'success', title: 'Respaldo guardado' });
});

// Iniciar
cargarDatos();