import customtkinter as ctk
from tkinter import messagebox, ttk, filedialog
import sqlite3
from datetime import datetime, timedelta
import shutil
import csv
import os

# --- CONFIGURACIÓN ---
ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

# --- BASE DE DATOS ---
def conectar():
    return sqlite3.connect('control_clientes.db')

def inicializar_base_datos():
    conexion = conectar()
    cursor = conexion.cursor()
    cursor.execute('''CREATE TABLE IF NOT EXISTS clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, cedula TEXT UNIQUE NOT NULL, celular TEXT, direccion TEXT)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS prestamos (id INTEGER PRIMARY KEY AUTOINCREMENT, id_cliente INTEGER, monto_prestado REAL, valor_cuota REAL, numero_cuotas INTEGER, periodicidad TEXT, fecha_inicio TEXT, FOREIGN KEY (id_cliente) REFERENCES clientes(id))''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS cuotas_pagadas (id INTEGER PRIMARY KEY AUTOINCREMENT, id_prestamo INTEGER, fecha TEXT, valor_pagado REAL, FOREIGN KEY (id_prestamo) REFERENCES prestamos(id))''')
    conexion.commit()
    conexion.close()

# --- LÓGICA DE ESTADO ---
def obtener_estado(id_cliente):
    conexion = conectar()
    cursor = conexion.cursor()
    cursor.execute("SELECT id, valor_cuota, numero_cuotas, fecha_inicio, periodicidad FROM prestamos WHERE id_cliente=?", (id_cliente,))
    prestamo = cursor.fetchone()
    if not prestamo:
        conexion.close()
        return "Sin préstamo"
    id_prestamo, valor_cuota, num_cuotas, fecha_inicio, periodicidad = prestamo
    cursor.execute("SELECT SUM(valor_pagado) FROM cuotas_pagadas WHERE id_prestamo=?", (id_prestamo,))
    pagado = cursor.fetchone()[0] or 0.0
    conexion.close()
    
    if pagado >= (valor_cuota * num_cuotas): return "Pagado"
    try:
        fecha_dt = datetime.strptime(fecha_inicio, "%Y-%m-%d")
        cuotas_pagadas = int(pagado / valor_cuota) if valor_cuota > 0 else 0
        dias_periodo = 30 
        if periodicidad.lower() == "semanal": dias_periodo = 7
        elif periodicidad.lower() == "quincenal": dias_periodo = 15
        proxima_fecha = fecha_dt + timedelta(days=dias_periodo * (cuotas_pagadas + 1))
        if datetime.now() > proxima_fecha: return "Vencido"
    except: pass
    return "Al día"

# --- ACTUALIZAR ESTADÍSTICAS (DASHBOARD) ---
def actualizar_estadisticas():
    conn = conectar(); cur = conn.cursor()
    
    # Total Prestado
    cur.execute("SELECT SUM(monto_prestado) FROM prestamos")
    total_prestado = cur.fetchone()[0] or 0.0
    
    # Total Recuperado
    cur.execute("SELECT SUM(valor_pagado) FROM cuotas_pagadas")
    total_recuperado = cur.fetchone()[0] or 0.0
    
    # Total por Cobrar (Saldo de todos los préstamos)
    cur.execute("SELECT id, valor_cuota, numero_cuotas FROM prestamos")
    total_por_cobrar = 0.0
    for p in cur.fetchall():
        cur.execute("SELECT SUM(valor_pagado) FROM cuotas_pagadas WHERE id_prestamo=?", (p[0],))
        pagado = cur.fetchone()[0] or 0.0
        deuda = (p[1] * p[2]) - pagado
        if deuda > 0: total_por_cobrar += deuda
    conn.close()
    
    def fmt(val): return f"${val:,.0f}".replace(",", ".")
    
    lbl_prestado.configure(text=fmt(total_prestado))
    lbl_recuperado.configure(text=fmt(total_recuperado))
    lbl_por_cobrar.configure(text=fmt(total_por_cobrar))

# --- EXPORTAR A CSV ---
def exportar_csv():
    try:
        ruta = filedialog.asksaveasfilename(defaultextension=".csv", filetypes=[("Archivos CSV", "*.csv")], title="Guardar Reporte")
        if not ruta: return
        
        conn = conectar(); cur = conn.cursor()
        cur.execute("SELECT id, nombre, cedula, celular FROM clientes")
        clientes = cur.fetchall()
        
        with open(ruta, mode='w', newline='', encoding='utf-8') as archivo:
            escritor = csv.writer(archivo, delimiter=';') # Punto y coma para que Excel en español lo lea bien
            escritor.writerow(["Nombre", "Cedula", "Celular", "Estado", "Monto Prestado", "Total Pagado", "Saldo Pendiente"])
            
            for c in clientes:
                id_c, nombre, cedula, celular = c
                estado = obtener_estado(id_c)
                cur.execute("SELECT id, monto_prestado, valor_cuota, numero_cuotas FROM prestamos WHERE id_cliente=?", (id_c,))
                p = cur.fetchone()
                if p:
                    cur.execute("SELECT SUM(valor_pagado) FROM cuotas_pagadas WHERE id_prestamo=?", (p[0],))
                    pagado = cur.fetchone()[0] or 0.0
                    saldo = (p[2] * p[3]) - pagado
                    escritor.writerow([nombre, cedula, celular, estado, p[1], pagado, saldo])
                else:
                    escritor.writerow([nombre, cedula, celular, estado, 0, 0, 0])
        conn.close()
        messagebox.showinfo("Éxito", "Reporte exportado correctamente.\nPuedes abrirlo con Excel.")
    except Exception as e:
        messagebox.showerror("Error", f"No se pudo exportar:\n{e}")

# --- HISTORIAL DE PAGOS ---
def abrir_historial(id_prestamo, id_cliente):
    v = ctk.CTkToplevel(ventana_principal); v.title("Historial de Pagos"); v.geometry("450x500"); v.grab_set()
    ctk.CTkLabel(v, text="Historial de Cuotas Pagadas", font=("Segoe UI", 18, "bold")).pack(pady=15)
    
    frame_tabla = ctk.CTkFrame(v, fg_color="transparent"); frame_tabla.pack(fill="both", expand=True, padx=20, pady=10)
    
    estilo = ttk.Style()
    estilo.configure("Hist.Treeview", font=("Segoe UI", 11), rowheight=30, background="#2b2b2b", fieldbackground="#2b2b2b", foreground="white")
    estilo.configure("Hist.Treeview.Heading", font=("Segoe UI", 11, "bold"), background="#1f538d", foreground="white")
    
    cols = ("id", "fecha", "valor")
    tabla_hist = ttk.Treeview(frame_tabla, columns=cols, show="headings", style="Hist.Treeview")
    tabla_hist.heading("id", text="ID"); tabla_hist.column("id", width=50)
    tabla_hist.heading("fecha", text="Fecha"); tabla_hist.column("fecha", width=150)
    tabla_hist.heading("valor", text="Valor Pagado"); tabla_hist.column("valor", width=150)
    tabla_hist.pack(fill="both", expand=True)
    
    def cargar_historial():
        for row in tabla_hist.get_children(): tabla_hist.delete(row)
        conn = conectar(); cur = conn.cursor()
        cur.execute("SELECT id, fecha, valor_pagado FROM cuotas_pagadas WHERE id_prestamo=? ORDER BY fecha DESC", (id_prestamo,))
        for pago in cur.fetchall():
            tabla_hist.insert("", "end", values=(pago[0], pago[1], f"${pago[2]:,.0f}".replace(",", ".")))
        conn.close()
        
    cargar_historial()
    
    def borrar_pago():
        sel = tabla_hist.selection()
        if not sel: return
        id_pago = tabla_hist.item(sel[0])['values'][0]
        if messagebox.askyesno("Confirmar", "¿Seguro que deseas eliminar este pago?"):
            conn = conectar(); cur = conn.cursor()
            cur.execute("DELETE FROM cuotas_pagadas WHERE id=?", (id_pago,))
            conn.commit(); conn.close()
            cargar_historial()
            actualizar_lista_clientes()
            actualizar_estadisticas()
            mostrar_ficha_derecha(None) # Recarga el panel derecho
            
    ctk.CTkButton(v, text="Eliminar Pago Seleccionado", command=borrar_pago, fg_color="#dc3545", hover_color="#c82333", height=35).pack(pady=10, padx=20, fill="x")

# --- VENTANA PRINCIPAL ---
def abrir_ventana_principal():
    global ventana_principal, entrada_buscar, tabla, panel_derecho, lbl_prestado, lbl_recuperado, lbl_por_cobrar, filtro_actual
    
    filtro_actual = "Todos"
    ventana_principal = ctk.CTk()
    ventana_principal.title("Sistema de Gestión de Préstamos PRO")
    ventana_principal.geometry("1300x750")
    
    # --- DASHBOARD (ESTADÍSTICAS) ---
    frame_stats = ctk.CTkFrame(ventana_principal, height=80, corner_radius=0, fg_color="#1a1a1a")
    frame_stats.pack(fill="x", padx=0, pady=0)
    
    def crear_tarjeta(parent, titulo, color_texto):
        f = ctk.CTkFrame(parent, fg_color="#2b2b2b", corner_radius=10)
        f.pack(side="left", expand=True, fill="both", padx=10, pady=10)
        ctk.CTkLabel(f, text=titulo, font=("Segoe UI", 11), text_color="gray").pack(pady=(5,0))
        lbl = ctk.CTkLabel(f, text="$0", font=("Segoe UI", 20, "bold"), text_color=color_texto)
        lbl.pack(pady=(0,5))
        return lbl
        
    lbl_prestado = crear_tarjeta(frame_stats, "TOTAL PRESTADO", "#3498db")
    lbl_recuperado = crear_tarjeta(frame_stats, "TOTAL RECUPERADO", "#2ecc71")
    lbl_por_cobrar = crear_tarjeta(frame_stats, "POR COBRAR (EN LA CALLE)", "#e74c3c")
    
    # --- CONTENEDOR PRINCIPAL ---
    frame_main = ctk.CTkFrame(ventana_principal, fg_color="transparent")
    frame_main.pack(fill="both", expand=True, padx=10, pady=10)
    
    frame_izquierdo = ctk.CTkFrame(frame_main, width=800, corner_radius=0, fg_color="transparent")
    frame_izquierdo.pack(side="left", fill="both", expand=True)
    
    panel_derecho = ctk.CTkFrame(frame_main, width=400, corner_radius=15)
    panel_derecho.pack(side="right", fill="y", padx=(10,0))
    
    # ================= PANEL IZQUIERDO =================
    # Buscador y Botones
    frame_sup = ctk.CTkFrame(frame_izquierdo, fg_color="transparent")
    frame_sup.pack(pady=(0,10), fill="x")
    
    entrada_buscar = ctk.CTkEntry(frame_sup, width=250, height=35, placeholder_text="🔍 Buscar...")
    entrada_buscar.pack(side="left", padx=5)
    entrada_buscar.bind("<KeyRelease>", actualizar_lista_clientes)
    
    ctk.CTkButton(frame_sup, text="+ Nuevo Cliente", command=abrir_formulario_cliente, width=110, height=35).pack(side="left", padx=5)
    ctk.CTkButton(frame_sup, text="Exportar Excel", command=exportar_csv, fg_color="#27ae60", hover_color="#2ecc71", width=110, height=35).pack(side="right", padx=5)
    ctk.CTkButton(frame_sup, text="Respaldo BD", command=hacer_respaldo, fg_color="#7f8c8d", hover_color="#95a5a6", width=100, height=35).pack(side="right", padx=5)
    
    # Filtros
    frame_filtros = ctk.CTkFrame(frame_izquierdo, fg_color="transparent")
    frame_filtros.pack(fill="x", pady=(0,10))
    
    def cambiar_filtro(f):
        global filtro_actual
        filtro_actual = f
        btn_todos.configure(fg_color="#1f538d" if f=="Todos" else "transparent")
        btn_vencidos.configure(fg_color="#dc3545" if f=="Vencido" else "transparent")
        btn_al_dia.configure(fg_color="#28a745" if f=="Al día" else "transparent")
        actualizar_lista_clientes()
        
    btn_todos = ctk.CTkButton(frame_filtros, text="Todos", width=80, height=28, fg_color="#1f538d", command=lambda: cambiar_filtro("Todos"))
    btn_todos.pack(side="left", padx=5)
    btn_vencidos = ctk.CTkButton(frame_filtros, text="Vencidos", width=80, height=28, fg_color="transparent", command=lambda: cambiar_filtro("Vencido"))
    btn_vencidos.pack(side="left", padx=5)
    btn_al_dia = ctk.CTkButton(frame_filtros, text="Al Día", width=80, height=28, fg_color="transparent", command=lambda: cambiar_filtro("Al día"))
    btn_al_dia.pack(side="left", padx=5)
    
    # Tabla
    estilo = ttk.Style()
    estilo.theme_use("clam")
    estilo.configure("Treeview.Heading", font=("Segoe UI", 11, "bold"), background="#1f538d", foreground="white", relief="flat")
    estilo.configure("Treeview", font=("Segoe UI", 11), rowheight=35, background="#2b2b2b", fieldbackground="#2b2b2b", foreground="white", borderwidth=0)
    estilo.map("Treeview", background=[('selected', '#1f538d')])
    
    columnas = ("nombre", "cedula", "estado")
    tabla = ttk.Treeview(frame_izquierdo, columns=columnas, show="headings")
    for col in columnas: tabla.heading(col, text=col.capitalize())
    tabla.column("nombre", width=300); tabla.column("cedula", width=150); tabla.column("estado", width=150)
    tabla.tag_configure("vencido", foreground="#ff4d4d", font=("Segoe UI", 11, "bold"))
    tabla.tag_configure("pagado", foreground="#2ecc71", font=("Segoe UI", 11, "bold"))
    tabla.tag_configure("normal", foreground="#ecf0f1")
    tabla.pack(fill="both", expand=True)
    tabla.bind("<<TreeviewSelect>>", mostrar_ficha_derecha)
    
    mostrar_panel_vacio()
    actualizar_lista_clientes()
    actualizar_estadisticas()
    ventana_principal.mainloop()

def mostrar_panel_vacio():
    for widget in panel_derecho.winfo_children(): widget.destroy()
    ctk.CTkLabel(panel_derecho, text="Selecciona un cliente", font=("Segoe UI", 18), text_color="gray").pack(pady=100)

def mostrar_ficha_derecha(event):
    seleccion = tabla.selection()
    if not seleccion: return
    
    item = tabla.item(seleccion[0])
    id_cliente, nombre = item['tags'][0], item['values'][0]
    
    for widget in panel_derecho.winfo_children(): widget.destroy()
    
    ctk.CTkLabel(panel_derecho, text=nombre.upper(), font=("Segoe UI", 22, "bold")).pack(pady=(20, 10))
    
    conn = conectar(); cur = conn.cursor()
    cur.execute("SELECT cedula, celular, direccion FROM clientes WHERE id=?", (id_cliente,))
    cedula, celular, direccion = cur.fetchone()
    ctk.CTkLabel(panel_derecho, text=f"Cédula: {cedula} | Cel: {celular}", font=("Segoe UI", 12), text_color="gray").pack(pady=(0, 20))
    
    cur.execute("SELECT id, monto_prestado, valor_cuota, numero_cuotas, periodicidad, fecha_inicio FROM prestamos WHERE id_cliente=?", (id_cliente,))
    prestamo = cur.fetchone()
    
    if not prestamo:
        ctk.CTkLabel(panel_derecho, text="Sin préstamos registrados", font=("Segoe UI", 14)).pack(pady=20)
        ctk.CTkButton(panel_derecho, text="+ Registrar Préstamo", command=lambda: abrir_ventana_prestamo(id_cliente), height=40).pack(fill="x", padx=40)
    else:
        id_prestamo, monto, valor_cuota, num_cuotas, periodicidad, fecha_inicio = prestamo
        cur.execute("SELECT SUM(valor_pagado) FROM cuotas_pagadas WHERE id_prestamo=?", (id_prestamo,))
        pagado = cur.fetchone()[0] or 0.0
        total_pagar = valor_cuota * num_cuotas
        saldo = total_pagar - pagado
        
        def fmt(val): return f"${val:,.0f}".replace(",", ".")
        
        frame_data = ctk.CTkFrame(panel_derecho, fg_color="#2b2b2b", corner_radius=10)
        frame_data.pack(fill="x", padx=20, pady=10)
        
        ctk.CTkLabel(frame_data, text="Total del Préstamo", font=("Segoe UI", 12, "bold"), text_color="gray").pack(pady=(15,0))
        ctk.CTkLabel(frame_data, text=fmt(total_pagar), font=("Segoe UI", 24, "bold")).pack()
        
        progreso = pagado / total_pagar if total_pagar > 0 else 0
        barra = ctk.CTkProgressBar(frame_data, height=15, progress_color="#2ecc71")
        barra.pack(fill="x", padx=20, pady=15)
        barra.set(progreso)
        
        frame_detalles = ctk.CTkFrame(frame_data, fg_color="transparent")
        frame_detalles.pack(fill="x", padx=20, pady=(0,15))
        ctk.CTkLabel(frame_detalles, text=f"Pagado: {fmt(pagado)}", font=("Segoe UI", 12)).pack(anchor="w")
        ctk.CTkLabel(frame_detalles, text=f"Saldo: {fmt(saldo)}", font=("Segoe UI", 14, "bold"), text_color="#ff4d4d").pack(anchor="w")
        
        # Botones de acción del préstamo
        ctk.CTkButton(panel_derecho, text="+ Registrar Pago de Cuota", command=lambda: abrir_ventana_pago(id_prestamo, valor_cuota), fg_color="#28a745", hover_color="#218838", height=45).pack(fill="x", padx=40, pady=(20, 5))
        ctk.CTkButton(panel_derecho, text="📜 Ver Historial de Pagos", command=lambda: abrir_historial(id_prestamo, id_cliente), fg_color="#17a2b8", hover_color="#138496", height=35).pack(fill="x", padx=40, pady=5)
        
    conn.close()

# --- FUNCIONES GLOBALES ---
def actualizar_lista_clientes(event=None):
    for row in tabla.get_children(): tabla.delete(row)
    busqueda = entrada_buscar.get()
    
    conn = conectar(); cur = conn.cursor()
    cur.execute("SELECT id, nombre, cedula FROM clientes WHERE nombre LIKE ? OR cedula LIKE ?", ('%' + busqueda + '%', '%' + busqueda + '%'))
    
    for fila in cur.fetchall():
        estado = obtener_estado(fila[0])
        
        # Aplicar filtro
        if filtro_actual == "Vencido" and estado != "Vencido": continue
        if filtro_actual == "Al día" and estado != "Al día": continue
        
        tag = "vencido" if estado == "Vencido" else ("pagado" if estado == "Pagado" else "normal")
        tabla.insert("", "end", values=(fila[1], fila[2], estado), tags=(fila[0], tag))
    conn.close()
    actualizar_estadisticas()

def hacer_respaldo():
    try:
        shutil.copy('control_clientes.db', f"respaldo_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db")
        messagebox.showinfo("Éxito", "Respaldo guardado exitosamente.")
    except Exception as e: messagebox.showerror("Error", str(e))

# --- VENTANAS EMERGENTES ---
def abrir_ventana_pago(id_prestamo, valor_cuota):
    v = ctk.CTkToplevel(ventana_principal); v.title("Registrar Pago"); v.geometry("350x300"); v.grab_set()
    ctk.CTkLabel(v, text="Registrar Pago", font=("Segoe UI", 20, "bold")).pack(pady=20)
    ctk.CTkLabel(v, text=f"Valor: ${valor_cuota:,.0f}".replace(",", "."), font=("Segoe UI", 16), text_color="#2ecc71").pack(pady=5)
    ctk.CTkLabel(v, text="Fecha (AAAA-MM-DD):").pack()
    e_fecha = ctk.CTkEntry(v, height=35); e_fecha.insert(0, datetime.now().strftime("%Y-%m-%d")); e_fecha.pack(pady=10)
    
    def guardar():
        try:
            conn = conectar(); cur = conn.cursor()
            cur.execute("INSERT INTO cuotas_pagadas (id_prestamo, fecha, valor_pagado) VALUES (?,?,?)", (id_prestamo, e_fecha.get(), valor_cuota))
            conn.commit(); conn.close(); v.destroy()
            actualizar_lista_clientes(); mostrar_ficha_derecha(None)
        except Exception as e: messagebox.showerror("Error", str(e))
        
    ctk.CTkButton(v, text="Confirmar Pago", command=guardar, fg_color="#28a745", height=40).pack(pady=20, fill="x", padx=40)

def abrir_ventana_prestamo(id_cliente):
    v = ctk.CTkToplevel(ventana_principal); v.title("Nuevo Préstamo"); v.geometry("400x500"); v.grab_set()
    ctk.CTkLabel(v, text="Nuevo Préstamo", font=("Segoe UI", 20, "bold")).pack(pady=20)
    frame = ctk.CTkFrame(v, fg_color="transparent"); frame.pack(padx=20, fill="x")
    
    def campo(texto, defecto=""):
        ctk.CTkLabel(frame, text=texto).pack(anchor="w")
        e = ctk.CTkEntry(frame, height=35)
        if defecto: e.insert(0, defecto)
        e.pack(fill="x", pady=(0,10))
        return e
        
    e_monto = campo("Monto Prestado:"); e_cuota = campo("Valor Cuota:")
    e_num = campo("Número de Cuotas:"); e_per = campo("Periodicidad (Semanal/Quincenal/Mensual):")
    e_fecha = campo("Fecha Inicio:", datetime.now().strftime("%Y-%m-%d"))
    
    def guardar():
        try:
            m = float(e_monto.get().replace(".", ""))
            c = float(e_cuota.get().replace(".", ""))
            conn = conectar(); cur = conn.cursor()
            cur.execute("INSERT INTO prestamos (id_cliente, monto_prestado, valor_cuota, numero_cuotas, periodicidad, fecha_inicio) VALUES (?,?,?,?,?,?)",
                           (id_cliente, m, c, int(e_num.get()), e_per.get(), e_fecha.get()))
            conn.commit(); conn.close(); v.destroy(); actualizar_lista_clientes(); mostrar_ficha_derecha(None)
        except: messagebox.showerror("Error", "Revisa los números")
        
    ctk.CTkButton(v, text="Guardar Préstamo", command=guardar, fg_color="#28a745", height=40).pack(pady=20, fill="x", padx=20)

def abrir_formulario_cliente():
    v = ctk.CTkToplevel(ventana_principal); v.title("Nuevo Cliente"); v.geometry("400x450"); v.grab_set()
    ctk.CTkLabel(v, text="Nuevo Cliente", font=("Segoe UI", 20, "bold")).pack(pady=20)
    frame = ctk.CTkFrame(v, fg_color="transparent"); frame.pack(padx=20, fill="x")
    
    def campo(texto):
        ctk.CTkLabel(frame, text=texto).pack(anchor="w")
        e = ctk.CTkEntry(frame, height=35); e.pack(fill="x", pady=(0,10)); return e
        
    e_nombre = campo("Nombre:"); e_cedula = campo("Cédula:"); e_celular = campo("Celular:"); e_direccion = campo("Dirección:")
    
    def guardar():
        if not e_nombre.get() or not e_cedula.get():
            messagebox.showwarning("Aviso", "Nombre y cédula obligatorios"); return
        try:
            conn = conectar(); cur = conn.cursor()
            cur.execute("INSERT INTO clientes (nombre, cedula, celular, direccion) VALUES (?,?,?,?)", (e_nombre.get(), e_cedula.get(), e_celular.get(), e_direccion.get()))
            conn.commit(); conn.close(); v.destroy(); actualizar_lista_clientes()
        except: messagebox.showerror("Error", "La cédula ya existe")
        
    ctk.CTkButton(v, text="Guardar Cliente", command=guardar, fg_color="#28a745", height=40).pack(pady=20, fill="x", padx=20)

# --- LOGIN ---
def verificar_clave():
    if entrada_clave.get() == "admin123":
        ventana_login.destroy(); abrir_ventana_principal()
    else: messagebox.showerror("Error", "Clave incorrecta")

if __name__ == "__main__":
    inicializar_base_datos()
    ventana_login = ctk.CTk()
    ventana_login.title("Acceso"); ventana_login.geometry("400x350")
    ventana_login.update_idletasks()
    x = (ventana_login.winfo_screenwidth() // 2) - 200; y = (ventana_login.winfo_screenheight() // 2) - 175
    ventana_login.geometry(f"+{x}+{y}")
    
    frame_login = ctk.CTkFrame(ventana_login, corner_radius=20); frame_login.pack(pady=40, padx=40, fill="both", expand=True)
    ctk.CTkLabel(frame_login, text="Bienvenido", font=("Segoe UI", 28, "bold")).pack(pady=(30,10))
    ctk.CTkLabel(frame_login, text="Clave de acceso:", font=("Segoe UI", 14)).pack()
    entrada_clave = ctk.CTkEntry(frame_login, show="*", height=40, width=200, justify="center", font=("Segoe UI", 16)); entrada_clave.pack(pady=10)
    entrada_clave.bind("<Return>", lambda event: verificar_clave())
    ctk.CTkButton(frame_login, text="INGRESAR", command=verificar_clave, height=45, font=("Segoe UI", 14, "bold"), fg_color="#28a745").pack(pady=20, fill="x", padx=40)
    ventana_login.mainloop()