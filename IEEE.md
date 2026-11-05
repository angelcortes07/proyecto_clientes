# ESPECIFICACIÓN DE REQUISITOS DE SOFTWARE (IEEE 830)
## Sistema de Gestión de Préstamos y Control de Clientes

**Versión:** 2.0 (Versión Final)  
**Autor:** [Tu Nombre]  
**Fecha:** [Fecha de hoy]

---

## 1. INTRODUCCIÓN

### 1.1 Propósito
Este documento describe de manera exhaustiva los requisitos funcionales y no funcionales del software **"Sistema de Gestión de Préstamos"**. Esta aplicación de escritorio está diseñada para optimizar el trabajo de un prestamista de dinero, permitiéndole automatizar el control de clientes, préstamos, cuotas y estados de cuenta, eliminando el margen de error del cálculo manual y facilitando la toma de decisiones mediante reportes estadísticos.

### 1.2 Alcance
El sistema es una aplicación de escritorio local (sin conexión a internet) que se ejecuta en Windows. Incluye:
- Autenticación de usuario.
- Gestión integral de clientes (CRUD).
- Gestión de préstamos y registro de pagos.
- Cálculo automatizado de saldos.
- Alertas visuales de cuotas vencidas.
- Panel de estadísticas en tiempo real.
- Exportación de datos a Excel.
- Copias de seguridad (respaldos).

**El sistema NO** calcula intereses por separado (el interés está incluido en el valor de la cuota), no realiza cobros automáticos, no envía mensajes SMS ni requiere conexión a la nube.

### 1.3 Definiciones, Siglas y Abreviaturas
- **SRS:** Especificación de Requisitos de Software.
- **CRUD:** Create, Read, Update, Delete (Crear, Leer, Actualizar, Eliminar).
- **Cliente:** Persona que adquiere un préstamo.
- **Cuota:** Pago periódico de valor fijo.
- **Saldo:** Dinero pendiente por pagar.
- **RF:** Requerimiento Funcional. **RNF:** Requerimiento No Funcional.
- **.exe:** Archivo ejecutable de Windows.

### 1.4 Referencias
- IEEE Std 830-1998, *Práctica recomendada para la especificación de requisitos de software*.
- Ley 1581 de 2012 (Colombia), protección de datos personales.

---

## 2. DESCRIPCIÓN GENERAL

### 2.1 Perspectiva del Producto
Programa independiente (*standalone*) instalable en Windows 10/11. Reemplaza los cuadernos físicos y las hojas de cálculo de Excel, centralizando la información en una base de datos local segura y rápida.

### 2.2 Funciones del Producto
El sistema cuenta con los siguientes módulos:
1. **Seguridad:** Inicio de sesión con clave.
2. **Directorio:** Búsqueda dinámica y gestión de clientes.
3. **Finanzas:** Registro de préstamos y pagos de cuotas.
4. **Auditoría:** Historial detallado de pagos por cliente.
5. **Analítica:** Dashboard con totales prestados, recuperados y por cobrar.
6. **Utilidades:** Generación de respaldos y exportación a CSV (Excel).

### 2.3 Características de los Usuarios
El sistema está diseñado para un **único usuario (el prestamista)**, quien posee conocimientos básicos de informática. Por ello, la interfaz utiliza conceptos visuales modernos (modo oscuro, botones grandes, barras de progreso) que minimizan la curva de aprendizaje.

### 2.4 Restricciones
- **Hardware:** Computador de escritorio o portátil con Windows 10 u 11.
- **Software:** Desarrollado en Python 3.15, interfaz gráfica con CustomTkinter y base de datos SQLite.
- **Distribución:** Debe entregarse compilado como un único archivo ejecutable (`.exe`) mediante PyInstaller, libre de dependencias externas para el usuario final.

### 2.5 Supuestos y Dependencias
- **Fórmula de negocio confirmada:** `Total a Pagar = Valor de la Cuota × Número de Cuotas`.
- `Saldo Pendiente = Total a Pagar - Total Pagado`.
- La fecha de vencimiento de las cuotas se calcula sumando los días de la periodicidad (7 días para semanal, 15 para quincenal, 30 para mensual) a partir de la fecha de inicio del préstamo.

---

## 3. REQUISITOS ESPECÍFICOS

### 3.1 Requerimientos Funcionales (RF)

#### Módulo de Seguridad
- **RF-01 (Autenticación):** El sistema debe solicitar una clave de acceso al iniciar para proteger la privacidad de los datos financieros.

#### Módulo de Clientes
- **RF-02 (Registro):** El sistema debe permitir registrar un cliente con nombre, cédula (único), celular y dirección.
- **RF-03 (Edición y Eliminación):** El sistema debe permitir modificar los datos de un cliente y eliminarlo. Al eliminar un cliente, se deben borrar en cascada todos sus préstamos y pagos asociados, previa confirmación.
- **RF-04 (Búsqueda Dinámica - *Automatización A*):** El sistema debe filtrar la tabla de clientes en tiempo real (mientras se escribe) al ingresar una parte del nombre o de la cédula.

#### Módulo de Préstamos y Pagos
- **RF-05 (Creación de Préstamo):** El sistema debe permitir registrar un préstamo ingresando monto prestado, valor de la cuota, número de cuotas, periodicidad y fecha de inicio.
- **RF-06 (Registro de Pagos):** El sistema debe permitir registrar el pago de una cuota indicando la fecha del pago.
- **RF-07 (Cálculo Automático - *Automatización B*):** El sistema debe calcular automáticamente el Total a Pagar, el Total Pagado y el Saldo Pendiente, mostrando este último en un color llamativo.
- **RF-08 (Barra de Progreso):** El sistema debe mostrar una barra visual que indique el porcentaje de avance del pago del préstamo.
- **RF-09 (Historial y Corrección):** El sistema debe mostrar el historial de pagos de un cliente y permitir eliminar un pago registrado por error, recalculando el saldo inmediatamente.

#### Módulo de Alertas y Reportes
- **RF-10 (Alerta de Vencimiento - *Automatización C*):** El sistema debe comparar la fecha actual con la fecha esperada de la próxima cuota. Si está vencida, el cliente se marcará en rojo con el estado "Vencido". Si terminó de pagar, se marcará en verde con el estado "Pagado".
- **RF-11 (Filtros Rápidos):** El sistema debe permitir filtrar la tabla para ver "Todos", "Solo Vencidos" o "Solo Al Día".
- **RF-12 (Dashboard Estadístico):** El sistema debe mostrar en la parte superior tres totales que se actualicen en tiempo real: Total Prestado, Total Recuperado y Total por Cobrar.
- **RF-13 (Reporte del Día - *Automatización D*):** El sistema debe generar un reporte rápido con el total de dinero cobrado en la fecha actual.

#### Módulo de Utilidades
- **RF-14 (Exportación a Excel):** El sistema debe generar un archivo `.csv` delimitado por punto y coma (compatible con Excel en español) con el estado actual de todos los clientes.
- **RF-15 (Respaldo de Seguridad):** El sistema debe crear una copia física del archivo de base de datos (`.db`) con la fecha y hora del respaldo.

### 3.2 Requerimientos No Funcionales (RNF)

- **RNF-01 (Rendimiento):** La búsqueda de clientes y la actualización de la tabla deben ser instantáneas (menos de 1 segundo).
- **RNF-02 (Usabilidad):** La interfaz debe ser intuitiva, utilizando un diseño moderno (Modo Oscuro) con botones redondeados, fuentes legibles y distribución en panel dividido (lista a la izquierda, detalles a la derecha).
- **RNF-03 (Compatibilidad):** El sistema debe funcionar en computadores con Windows sin necesidad de instalar Python ni bases de datos adicionales.
- **RNF-04 (Seguridad):** Los datos deben almacenarse localmente en el equipo del usuario. No debe existir tráfico de datos hacia internet.
- **RNF-05 (Robustez):** El sistema debe validar los datos ingresados (por ejemplo, evitar cédulas duplicadas o montos vacíos) y mostrar mensajes de error amigables sin cerrarse inesperadamente.

### 3.3 Requisitos de Datos (Modelo Entidad-Relación)

**Tabla 1: `clientes`**
- `id` (Entero, PK, Autoincremental)
- `nombre` (Texto)
- `cedula` (Texto, Único)
- `celular` (Texto)
- `direccion` (Texto)

**Tabla 2: `prestamos`**
- `id` (Entero, PK, Autoincremental)
- `id_cliente` (Entero, FK)
- `monto_prestado` (Real)
- `valor_cuota` (Real)
- `numero_cuotas` (Entero)
- `periodicidad` (Texto: Semanal/Quincenal/Mensual)
- `fecha_inicio` (Texto, Formato AAAA-MM-DD)

**Tabla 3: `cuotas_pagadas`**
- `id` (Entero, PK, Autoincremental)
- `id_prestamo` (Entero, FK)
- `fecha` (Texto, Formato AAAA-MM-DD)
- `valor_pagado` (Real)

### 3.4 Interfaces

- **Interfaz de Usuario (UI):** 
  - Ventana de Login flotante y centrada.
  - Ventana Principal maximizable (mínimo 1300x750 píxeles) con Dashboard superior.
  - Ventanas modales (*Toplevel*) para la creación de clientes y préstamos, las cuales bloquean la ventana de fondo para evitar errores de duplicidad.
- **Interfaz de Hardware:** Teclado y mouse estándar.
- **Interfaz de Software:** Sistema operativo Windows (archivos con extensión `.exe`).

---

## 4. APÉNDICES

### 4.1 Historial de Cambios
| Versión | Fecha | Descripción del Cambio |
|---|---|---|
| 1.0 | [Fecha inicial] | Levantamiento básico de requisitos (búsqueda, cálculo y cuotas). |
| 2.0 | [Fecha actual] | Documento final. Se añadieron requisitos de Dashboard, Exportación a Excel, Historial de pagos, Modo oscuro y compilación a .exe. |

### 4.2 Notas de Implementación
- El sistema fue desarrollado utilizando el patrón de arquitectura MVC (Modelo-Vista-Controlador) de forma implícita.
- La base de datos se crea automáticamente en el directorio raíz la primera vez que se ejecuta el programa.
- El archivo ejecutable se generó con la instrucción `python -m PyInstaller --noconsole --onefile --collect-all customtkinter --name "SistemaPrestamos" main.py`.

**Fin del Documento.**