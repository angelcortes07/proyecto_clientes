const { ipcRenderer } = require('electron');
const $ = (id) => document.getElementById(id);
const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2500 });
const pesos = (n) => '$' + Math.round(n).toLocaleString('es-CO');
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let clientes = [];
let seleccionadoId = null;
let filtroActual = 'todos';

// ---------- FECHAS ----------
function hoyTexto() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function aFecha(texto) {
  const [y, m, d] = texto.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function sumarDias(texto, dias) {
  const f = aFecha(texto); f.setDate(f.getDate() + dias); return f;
}
const diasEntre = (a, b) => Math.round((b - a) / 86400000);
const fechaBonita = (f) => f.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

// ---------- CÁLCULOS CON MORA ----------
function calcular(c) {
  const total = c.valor_cuota * c.numero_cuotas;
  let saldoBase = Math.max(0, total - c.total_pagado);
  if (saldoBase <= 0) return { total, saldo: 0, color: 'verde', texto: 'Pagado', proxima: null };

  const cubiertas = Math.floor((c.total_pagado + 0.005) / c.valor_cuota);
  const proxima = sumarDias(c.fecha_inicio, c.frecuencia_dias * (cubiertas + 1));
  const hoy = aFecha(hoyTexto());
  const atraso = diasEntre(proxima, hoy);

  let mora = 0;
  if (atraso > 0 && c.interes_mora > 0) {
    mora = saldoBase * (c.interes_mora / 100) * atraso;
  }
  const saldoFinal = saldoBase + mora;

  if (atraso > 0) return { total, saldo: saldoFinal, color: 'rojo', texto: `Atrasado ${atraso} d. (+$${Math.round(mora)} mora)`, proxima, atraso };
  if (atraso === 0) return { total, saldo: saldoFinal, color: 'amarillo', texto: 'Vence hoy', proxima, atraso: 0 };
  return { total, saldo: saldoFinal, color: 'verde', texto: 'Al día', proxima, atraso };
}

// ---------- TEMAS ----------
const temaGuardado = localStorage.getItem('tema') || 'especial-aurora';
document.documentElement.dataset.tema = temaGuardado;
$('selector-tema').value = temaGuardado;
$('selector-tema').addEventListener('change', (e) => {
  document.documentElement.dataset.tema = e.target.value;
  localStorage.setItem('tema', e.target.value);
});

// ---------- MENÚ LATERAL (SIDEBAR) ----------
$('btn-toggle-menu').addEventListener('click', () => {
  $('sidebar').classList.toggle('collapsed');
});

// ---------- INICIO ----------
async function iniciarApp() {
  const hayUsuarios = await ipcRenderer.invoke('hay-usuarios');
  if (!hayUsuarios) {
    $('login-titulo').innerHTML = 'Crea tu usuario';
    $('login-sub').textContent = 'Primera vez: define tu cuenta';
    $('login-boton').textContent = 'CREAR Y ENTRAR';
  }

  $('toggle-clave').addEventListener('click', () => {
    const inp = $('login-clave'); const icon = $('toggle-clave').querySelector('i');
    if (inp.type === 'password') { inp.type = 'text'; icon.classList.replace('fa-eye', 'fa-eye-slash'); }
    else { inp.type = 'password'; icon.classList.replace('fa-eye-slash', 'fa-eye'); }
  });

  async function enviar() {
    const boton = $('login-boton'); const textoOriginal = boton.textContent;
    boton.disabled = true; boton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    $('login-error').textContent = '';
    const datos = { usuario: $('login-usuario').value, clave: $('login-clave').value };
    let res = await ipcRenderer.invoke(hayUsuarios ? 'iniciar-sesion' : 'crear-usuario', datos);
    if (res.success && !hayUsuarios) res = await ipcRenderer.invoke('iniciar-sesion', datos);

    if (res.success) {
      $('pantalla-login').style.display = 'none';
      await cargarDatos();
      mostrarAvisosAutomaticos();
    } else {
      $('login-error').textContent = res.error || 'Error';
      $('login-card').classList.add('error'); setTimeout(() => $('login-card').classList.remove('error'), 500);
      boton.disabled = false; boton.textContent = textoOriginal;
    }
  }
  $('login-boton').addEventListener('click', enviar);
  $('login-clave').addEventListener('keydown', (e) => { if (e.key === 'Enter') enviar(); });
}

// ---------- DATOS Y TABLA ----------
async function cargarDatos() {
  const res = await ipcRenderer.invoke('listar-clientes');
  if (!res.success) return Swal.fire('Error', res.error, 'error');
  clientes = res.clientes;
  
  const prestado = clientes.reduce((s, c) => s + (c.monto_prestado || 0), 0);
  const recuperado = clientes.reduce((s, c) => s + (c.total_pagado || 0), 0);
  const porCobrar = clientes.reduce((s, c) => s + calcular(c).saldo, 0);
  $('stat-prestado').textContent = pesos(prestado);
  $('stat-recuperado').textContent = pesos(recuperado);
  $('stat-porcobrar').textContent = pesos(porCobrar);

  dibujarTabla();
  if (seleccionadoId && clientes.some(c => c.id === seleccionadoId)) seleccionarCliente(seleccionadoId);
  else { seleccionadoId = null; dibujarVacio(); }
}

function dibujarTabla() {
  const q = $('buscar').value.trim().toLowerCase();
  let lista = clientes.filter((c) => c.nombre.toLowerCase().includes(q) || c.cedula.toLowerCase().includes(q));

  if (filtroActual === 'atrasados') lista = lista.filter((c) => calcular(c).color === 'rojo');
  if (filtroActual === 'hoy') lista = lista.filter((c) => calcular(c).color === 'amarillo' || calcular(c).color === 'rojo');

  $('tabla-clientes').innerHTML = lista.map((c) => {
    const r = calcular(c);
    return `<tr data-id="${c.id}" class="${c.id === seleccionadoId ? 'selected' : ''}">
      <td>${esc(c.nombre)}</td><td>${esc(c.cedula)}</td><td>${pesos(r.saldo)}</td>
      <td><span class="badge ${r.color}">${r.texto}</span></td></tr>`;
  }).join('') || `<tr><td colspan="4" class="vacio">No hay clientes en esta lista.</td></tr>`;
}

$('buscar').addEventListener('input', dibujarTabla);
$('tabla-clientes').addEventListener('click', (e) => {
  const fila = e.target.closest('tr[data-id]'); if (fila) seleccionarCliente(Number(fila.dataset.id));
});

// Filtros
const setFiltro = (f) => {
  filtroActual = f;
  $('filtro-todos').classList.toggle('activo', f === 'todos');
  $('filtro-hoy').classList.toggle('activo', f === 'hoy');
  $('filtro-atrasados').classList.toggle('activo', f === 'atrasados');
  dibujarTabla();
};
$('filtro-todos').addEventListener('click', () => setFiltro('todos'));
$('filtro-hoy').addEventListener('click', () => setFiltro('hoy'));
$('filtro-atrasados').addEventListener('click', () => setFiltro('atrasados'));

// ---------- DETALLE ----------
function dibujarVacio() {
  $('detalle').innerHTML = '<div class="vacio"><i class="fa-solid fa-hand-pointer fa-2x"></i><p>Selecciona un cliente para ver su información.</p></div>';
}

async function seleccionarCliente(id) {
  seleccionadoId = id;
  const c = clientes.find((x) => x.id === id);
  if (!c) return dibujarVacio();
  dibujarTabla();
  const r = calcular(c);
  const res = await ipcRenderer.invoke('listar-pagos', { cliente_id: id });
  const pagos = res.success ? res.pagos : [];

  $('detalle').innerHTML = `
    <h2 style="margin:0">${esc(c.nombre)} <span class="badge ${r.color}">${r.texto}</span></h2>
    <div style="opacity:0.8; font-size:14px; margin-top:5px;">Cédula ${esc(c.cedula)} · Cel. ${esc(c.celular) || 'sin dato'}<br>${esc(c.direccion) || 'Sin dirección'}</div>
    <div class="datos">
      <div class="dato"><small>Monto prestado</small><b>${pesos(c.monto_prestado)}</b></div>
      <div class="dato"><small>Cuota (${c.numero_cuotas} c. / ${c.frecuencia_dias} d.)</small><b>${pesos(c.valor_cuota)}</b></div>
      <div class="dato"><small>Total pagado</small><b>${pesos(c.total_pagado)}</b></div>
      <div class="dato"><small>Saldo pendiente</small><b style="color:var(--rojo)">${pesos(r.saldo)}</b></div>
      <div class="dato"><small>Próxima cuota</small><b>${r.proxima ? fechaBonita(r.proxima) : 'Pagado'}</b></div>
    </div>
    <div class="acciones">
      <button class="btn" data-accion="abonar" ${r.saldo <= 0 ? 'disabled' : ''}><i class="fa-solid fa-coins"></i> Abonar</button>
      <button class="btn wa" data-accion="whatsapp"><i class="fa-brands fa-whatsapp"></i> WhatsApp</button>
      <button class="btn sec" data-accion="editar"><i class="fa-solid fa-pen"></i> Editar</button>
      <button class="btn peligro" data-accion="borrar-cliente"><i class="fa-solid fa-trash"></i> Borrar</button>
    </div>
    <h3 style="margin-top:20px; font-size:16px;">Historial de Abonos</h3>
    ${pagos.length ? `<table><tbody>${pagos.map((p) => `
      <tr style="${p.estado === 'anulado' ? 'opacity:0.5; text-decoration:line-through;' : ''}">
      <td>${fechaBonita(aFecha(p.fecha))}</td><td>${pesos(p.valor)}</td>
      <td style="text-align:right">${p.estado === 'activo' ? `<button class="btn sec" style="padding:4px 8px;" data-anular-pago="${p.id}"><i class="fa-solid fa-ban"></i></button>` : 'Anulado'}</td></tr>`).join('')}</tbody></table>`
      : '<div class="vacio" style="padding:20px;">No tiene abonos.</div>'}`;
}

$('detalle').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.accion === 'abonar') abonar();
  else if (b.dataset.accion === 'editar') formularioCliente(clientes.find((c) => c.id === seleccionadoId));
  else if (b.dataset.accion === 'borrar-cliente') borrarCliente();
  else if (b.dataset.accion === 'whatsapp') abrirWhatsApp(seleccionadoId);
  else if (b.dataset.anularPago) anularPago(Number(b.dataset.anularPago));
});

// ---------- FORMULARIO DE CLIENTE ----------
async function formularioCliente(c) {
  const v = c || {};
  const { value: datos } = await Swal.fire({
    title: c ? '<i class="fa-solid fa-user-pen"></i> Editar cliente' : '<i class="fa-solid fa-user-plus"></i> Nuevo cliente',
    showCancelButton: true, 
    confirmButtonText: '<i class="fa-solid fa-check"></i> Guardar', 
    cancelButtonText: 'Cancelar', 
    width: 650,
    html: `<div class="form-grid">
      <div class="input-group">
        <label><i class="fa-solid fa-id-card"></i> Cédula *</label>
        <input id="f-cedula" class="swal2-input swal-custom-input" placeholder="Ej. 123456789" value="${esc(v.cedula)}">
      </div>
      <div class="input-group">
        <label><i class="fa-solid fa-user"></i> Nombre *</label>
        <input id="f-nombre" class="swal2-input swal-custom-input" placeholder="Nombre completo" value="${esc(v.nombre)}">
      </div>
      <div class="input-group">
        <label><i class="fa-solid fa-mobile-screen"></i> Celular</label>
        <input id="f-celular" class="swal2-input swal-custom-input" placeholder="Ej. 3001234567" value="${esc(v.celular)}">
      </div>
      <div class="input-group">
        <label><i class="fa-solid fa-location-dot"></i> Dirección</label>
        <input id="f-direccion" class="swal2-input swal-custom-input" placeholder="Dirección" value="${esc(v.direccion)}">
      </div>
      <div class="input-group">
        <label><i class="fa-solid fa-money-bill-wave"></i> Monto prestado</label>
        <input id="f-monto" type="number" class="swal2-input swal-custom-input" placeholder="0" value="${v.monto_prestado ?? ''}">
      </div>
      <div class="input-group">
        <label><i class="fa-solid fa-coins"></i> Valor cuota *</label>
        <input id="f-cuota" type="number" class="swal2-input swal-custom-input" placeholder="0" value="${v.valor_cuota ?? ''}">
      </div>
      <div class="input-group">
        <label><i class="fa-solid fa-list-ol"></i> N° cuotas *</label>
        <input id="f-ncuotas" type="number" class="swal2-input swal-custom-input" placeholder="Ej. 12" value="${v.numero_cuotas ?? ''}">
      </div>
      <div class="input-group">
        <label><i class="fa-solid fa-calendar-days"></i> Cada (días) *</label>
        <input id="f-frec" type="number" class="swal2-input swal-custom-input" placeholder="Ej. 30" value="${v.frecuencia_dias ?? 30}">
      </div>
      <div class="input-group">
        <label><i class="fa-solid fa-triangle-exclamation"></i> Mora diaria (%)</label>
        <input id="f-mora" type="number" step="0.1" class="swal2-input swal-custom-input" placeholder="0" value="${v.interes_mora ?? 0}">
      </div>
      <div class="input-group">
        <label><i class="fa-solid fa-calendar-plus"></i> Fecha préstamo *</label>
        <input id="f-fecha" type="date" class="swal2-input swal-custom-input" value="${v.fecha_inicio || hoyTexto()}">
      </div>
    </div>`,
    preConfirm: () => {
      const d = {
        id: c ? c.id : null, 
        cedula: $('f-cedula').value.trim(), 
        nombre: $('f-nombre').value.trim(),
        celular: $('f-celular').value.trim(), 
        direccion: $('f-direccion').value.trim(),
        monto_prestado: Number($('f-monto').value) || 0, 
        valor_cuota: Number($('f-cuota').value),
        numero_cuotas: parseInt($('f-ncuotas').value), 
        frecuencia_dias: parseInt($('f-frec').value),
        interes_mora: Number($('f-mora').value) || 0, 
        fecha_inicio: $('f-fecha').value
      };
      if (!d.cedula || !d.nombre || !(d.valor_cuota > 0) || !(d.numero_cuotas > 0)) {
        return Swal.showValidationMessage('Por favor, revisa los campos obligatorios (*).');
      }
      return d;
    }
  });
  
  if (!datos) return;
  const res = await ipcRenderer.invoke('guardar-cliente', datos);
  if (!res.success) return Swal.fire('Error', res.error, 'error');
  Toast.fire({ icon: 'success', title: c ? 'Cliente actualizado' : 'Cliente guardado' });
  seleccionadoId = res.id; 
  await cargarDatos();
}
$('btn-nuevo').addEventListener('click', () => formularioCliente(null));

// ---------- ABONOS Y PAPELERA ----------
async function abonar() {
  const c = clientes.find((x) => x.id === seleccionadoId); const r = calcular(c);
  const { value: valor } = await Swal.fire({
    title: 'Registrar abono', html: `Saldo actual: <b>${pesos(r.saldo)}</b>`,
    input: 'number', inputAttributes: { min: 1, step: 'any' },
    showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar',
    inputValidator: (v) => (!(Number(v) > 0) ? 'Valor inválido.' : null)
  });
  if (!valor) return;
  const res = await ipcRenderer.invoke('registrar-pago', { cliente_id: c.id, valor: Number(valor), fecha: hoyTexto() });
  if (res.success) { Toast.fire({ icon: 'success', title: 'Abono guardado' }); await cargarDatos(); }
}

async function anularPago(id) {
  const conf = await Swal.fire({ title: '¿Anular abono?', text: 'Quedará en el historial tachado.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí' });
  if (!conf.isConfirmed) return;
  await ipcRenderer.invoke('anular-pago', { id }); await cargarDatos();
}

async function borrarCliente() {
  const c = clientes.find((x) => x.id === seleccionadoId);
  const conf = await Swal.fire({ title: `¿Enviar a ${c.nombre} a la papelera?`, text: 'Se borrará en 30 días automáticamente.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, borrar' });
  if (!conf.isConfirmed) return;
  await ipcRenderer.invoke('eliminar-cliente', { id: c.id });
  seleccionadoId = null; dibujarVacio(); await cargarDatos();
}

// ---------- BOTONES DEL SIDEBAR (MENÚ) ----------
$('nav-papelera').addEventListener('click', async () => {
  const res = await ipcRenderer.invoke('listar-eliminados');
  if (!res.success || res.clientes.length === 0) return Swal.fire('Papelera', 'No hay clientes eliminados.', 'info');
  
  const html = res.clientes.map(c => `
    <div style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid #eee; align-items:center;">
      <div style="text-align:left;"><b>${esc(c.nombre)}</b><br><small>Se borra en ${30 - c.dias_en_papelera} días</small></div>
      <button class="swal2-styled" style="margin:0; background:#0984e3;" onclick="restaurarCliente(${c.id})">Restaurar</button>
    </div>`).join('');
    
  Swal.fire({ title: 'Clientes en Papelera', html: `<div style="max-height:300px; overflow:auto; text-align:left">${html}</div>`, confirmButtonText: 'Cerrar' });
});
window.restaurarCliente = async (id) => {
  await ipcRenderer.invoke('restaurar-cliente', { id });
  Swal.close(); Toast.fire({ icon: 'success', title: 'Restaurado' }); await cargarDatos();
};

$('nav-caja').addEventListener('click', async () => {
  const res = await ipcRenderer.invoke('cierre-caja');
  Swal.fire({ title: 'Cierre de Caja (Hoy)', html: `<h1 style="color:#1e8e3e; font-size:40px; margin:10px 0;">${pesos(res.total)}</h1><p>Total cobrado hoy.</p>`, icon: 'success' });
});

$('nav-exportar').addEventListener('click', async () => {
  if (!clientes.length) return Swal.fire('Sin datos', 'No hay clientes.', 'info');
  const filas = clientes.map((c) => {
    const r = calcular(c);
    return { cedula: c.cedula, nombre: c.nombre, celular: c.celular, monto_prestado: c.monto_prestado, valor_cuota: c.valor_cuota, numero_cuotas: c.numero_cuotas, total_pagado: c.total_pagado, saldo: r.saldo, estado: r.texto };
  });
  const res = await ipcRenderer.invoke('exportar-csv', filas);
  if (res.success) Toast.fire({ icon: 'success', title: 'Exportado' });
});

$('nav-respaldo').addEventListener('click', async () => {
  const res = await ipcRenderer.invoke('hacer-respaldo');
  if (res.success) Toast.fire({ icon: 'success', title: 'Respaldo guardado' });
});

$('nav-ayuda').addEventListener('click', () => {
  Swal.fire({ title: 'Ayuda', html: 'Usa el menú lateral para gestionar la papelera, caja y avisos.', icon: 'info' });
});

// ---------- AVISOS Y WHATSAPP MASIVO ----------
window.enviarAvisoDesdeModal = (id) => { Swal.close(); abrirWhatsApp(id); };

function mostrarAvisosAutomaticos(esManual = false) {
  const pendientes = clientes.filter(c => ['rojo', 'amarillo'].includes(calcular(c).color));
  
  if (pendientes.length === 0) {
    if (esManual) Swal.fire('¡Todo al día!', 'No hay cobros pendientes.', 'success');
    return;
  }

  ipcRenderer.invoke('notificar', 'Ruta de Cobro', `Tienes ${pendientes.length} cliente(s) para cobrar hoy.`);

  let listaHtml = pendientes.map(c => {
    const r = calcular(c);
    return `<div style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #eee;">
      <div style="text-align:left;"><b>${esc(c.nombre)}</b><br><small style="color:${r.color === 'rojo' ? '#d63031' : '#f0b400'}; font-weight:bold;">${r.texto}</small></div>
      <button class="swal2-styled" style="margin:0; background:#25d366; padding:6px 12px; font-size:14px; color:white;" onclick="window.enviarAvisoDesdeModal(${c.id})"><i class="fa-brands fa-whatsapp"></i> Enviar</button>
    </div>`;
  }).join('');

  Swal.fire({
    title: '🔔 Ruta de Cobro',
    html: `<p style="text-align:left; margin-bottom:10px">Tienes <b>${pendientes.length}</b> cliente(s) pendientes.</p>
           <div style="max-height:300px; overflow-y:auto; border:1px solid #ddd; border-radius:8px; padding:5px; background:#f9f9f9; margin-bottom:15px;">${listaHtml}</div>
           <button class="swal2-styled" style="width:100%; background:#128C7E;" onclick="enviarTodosWA()">Abrir todos los WhatsApps</button>`,
    confirmButtonText: 'Cerrar', width: 500
  });
}

window.enviarTodosWA = () => {
  const pendientes = clientes.filter(c => ['rojo', 'amarillo'].includes(calcular(c).color));
  Swal.close();
  Toast.fire({ icon: 'info', title: 'Abriendo WhatsApps...' });
  pendientes.forEach((c, index) => {
    setTimeout(() => { abrirWhatsApp(c.id, true); }, index * 1500);
  });
};

$('nav-avisos').addEventListener('click', () => mostrarAvisosAutomaticos(true));

// ---------- LÓGICA WHATSAPP ----------
function limpiarTelefono(tel) {
  let digits = String(tel || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('57')) return digits;
  if (digits.length === 10) return '57' + digits;
  if (digits.length > 10 && digits.startsWith('3')) return '57' + digits.slice(0, 10);
  return digits;
}

async function abrirWhatsApp(id = seleccionadoId, masivo = false) {
  const c = clientes.find((x) => x.id === id);
  if (!c || !c.celular) { if (!masivo) Swal.fire('Error', 'Cliente sin celular registrado.', 'warning'); return; }

  const tel = limpiarTelefono(c.celular);
  const r = calcular(c);
  const texto = r.color === 'rojo' 
    ? `Hola ${c.nombre}, le saluda. Le recordamos que su cuota está atrasada. Saldo actual: ${pesos(r.saldo)}.`
    : `Hola ${c.nombre}, le recordamos que hoy vence su cuota por valor de ${pesos(c.valor_cuota)}.`;
  
  const url = `https://api.whatsapp.com/send?phone=${tel}&text=${encodeURIComponent(texto)}`;
  await ipcRenderer.invoke('abrir-externo', url);
}

// INICIAR
iniciarApp();