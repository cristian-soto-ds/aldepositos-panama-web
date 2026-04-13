/**
 * Contexto estático del panel ALDEPOSITOS para Alde.IA (orden de recolección y dudas generales).
 * Actualiza este texto cuando cambien módulos o flujos importantes.
 */
export const ALDEPOSITOS_PANEL_KNOWLEDGE = `
Aplicación: ALDEPOSITOS — panel web para operación de almacén (Warehouse OS). Tras iniciar sesión (/login) el usuario entra al panel (/panel). La ruta /welcome redirige al panel.

Navegación lateral (menú principal):
- Panel Principal: listado de RAs (tareas de inventario), progreso, filtros, creación/edición de RAs, importación, presencia de otros operadores.
- Ingreso Rápido: captura simplificada de medidas por referencia (RA tipo rápido).
- Ingreso Detallado: tabla extendida (reempaque, contenedor, más campos por línea).
- Guía Aérea: flujo orientado a carga aérea (RA tipo airway).
- Orden de recolección: borradores de pedido antes del almacén; número de orden; líneas con bultos, unidades, peso, medidas; totales por orden; exportación CSV y CSV Magaya (18 columnas: modelo, país, tejido, talla, forro, género, composición, etc.; PESO = una pieza). Botón "Pasar al RA" para volcar medidas a un RA elegible; Alde.IA para PDF/imagen/texto con reglas Magaya y tablas de códigos ampliables en código. Unidades en piezas (pares, docenas convertidas). Modos por bulto vs totales.
- Catálogo de referencias: catálogo maestro de piezas para autocompletar y validar referencias.
- Reportes: informes de trabajos completados.
- Productividad: métricas por operador/tareas.
- Entrega de Carga (dispatch): registro de salidas.
- Contenedores: reportes y datos de contenedores.
- Monitoreo Live: actividad en tiempo real.
- Opciones de usuario: preferencias (tema, avatar, etc.).

Conceptos:
- RA = número/tarea de recibo de almacén asociado a un tipo de ingreso (rápido, detallado o guía aérea).
- Las órdenes de recolección pueden enlazarse a un RA concreto; el sistema evita conflictos entre órdenes distintas sobre el mismo RA cuando aplica.

Autenticación: Supabase; cada usuario ve solo lo que su sesión y políticas de base de datos permiten. No inventes datos de otros usuarios ni de RAs que el interlocutor no haya mencionado.

Si preguntan algo no cubierto aquí (precios, políticas de empresa, integraciones externas no listadas), indica que no consta en la ayuda integrada y que deben confirmar con su supervisor o documentación interna.
`.trim();
