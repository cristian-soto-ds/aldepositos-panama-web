/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONFIGURACIÓN — Recepción de camiones (recepción logística)
 * ═══════════════════════════════════════════════════════════════════════════
 * Edita este archivo para personalizar textos, colores, rampas y estados
 * sin tocar la lógica de los módulos Operador y Pantalla TV.
 */

/** Identificador de la tabla en Supabase (sincronización en la nube). */
export const RECEPTION_TABLE = "reception_trucks";

/** Clave localStorage (respaldo si Supabase no está disponible). */
export const RECEPTION_STORAGE_KEY = "aldepositos-reception-queue-v1";

/** Canal Broadcast para sincronización instantánea entre pestañas. */
export const RECEPTION_BROADCAST_CHANNEL = "aldepositos-reception-sync-v1";

// ─── ESTADOS DEL CAMIÓN ───────────────────────────────────────────────────────
// Para agregar una rampa nueva (ej. RAMPA_3):
// 1. Añade el id en RECEPTION_STATUS y RECEPTION_STATUS_LABELS.
// 2. Añade la columna en RECEPTION_KANBAN_COLUMNS.
// 3. Si debe verse en TV, inclúyela en RECEPTION_TV_STATUS_IDS.

export const RECEPTION_STATUS = {
  EN_FILA: "EN_FILA",
  RAMPA_1: "RAMPA_1",
  RAMPA_2: "RAMPA_2",
  COMPLETADO: "COMPLETADO",
} as const;

export type ReceptionStatusId =
  (typeof RECEPTION_STATUS)[keyof typeof RECEPTION_STATUS];

/** Textos visibles de cada estado (cámbialos aquí). */
export const RECEPTION_STATUS_LABELS: Record<ReceptionStatusId, string> = {
  EN_FILA: "En Fila",
  RAMPA_1: "Rampa 1",
  RAMPA_2: "Rampa 2",
  COMPLETADO: "Completado",
};

/**
 * Estados que disparan la generación del Recibo de Almacén al mover un camión.
 * Por defecto: solo al entrar a una rampa.
 */
export const RECEPTION_RECEIPT_ON_STATUS: ReceptionStatusId[] = [
  RECEPTION_STATUS.RAMPA_1,
  RECEPTION_STATUS.RAMPA_2,
];

/** Columnas del tablero Kanban del módulo Operador (orden de izquierda a derecha). */
export const RECEPTION_KANBAN_COLUMNS: ReceptionStatusId[] = [
  RECEPTION_STATUS.EN_FILA,
  RECEPTION_STATUS.RAMPA_1,
  RECEPTION_STATUS.RAMPA_2,
  RECEPTION_STATUS.COMPLETADO,
];

/**
 * Estados visibles en la Pantalla TV (solo lectura).
 * Por defecto: fila + rampas (sin completados).
 */
export const RECEPTION_TV_STATUS_IDS: ReceptionStatusId[] = [
  RECEPTION_STATUS.EN_FILA,
  RECEPTION_STATUS.RAMPA_1,
  RECEPTION_STATUS.RAMPA_2,
];

/** Título agrupado en TV para todas las rampas. */
export const RECEPTION_TV_GROUP_RAMPS = true;

// ─── COLORES (Tailwind) ───────────────────────────────────────────────────────

export const RECEPTION_COLUMN_THEME: Record<
  ReceptionStatusId,
  { header: string; card: string; badge: string; stripe: string; actionIdle: string; actionActive: string }
> = {
  EN_FILA: {
    header: "bg-slate-700 text-white border-slate-600",
    card: "bg-white border-slate-200 text-slate-900",
    badge: "bg-slate-100 text-slate-700",
    stripe: "from-slate-500 to-slate-700",
    actionIdle:
      "border-2 border-slate-300 bg-slate-100 text-slate-800 hover:border-slate-400 hover:bg-slate-200",
    actionActive:
      "border-2 border-slate-800 bg-slate-700 text-white shadow-md ring-2 ring-slate-400/60 ring-offset-1",
  },
  RAMPA_1: {
    header: "bg-amber-600 text-white border-amber-500",
    card: "bg-amber-50 border-amber-200 text-amber-950",
    badge: "bg-amber-100 text-amber-800",
    stripe: "from-amber-400 to-amber-600",
    actionIdle:
      "border-2 border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-400 hover:bg-amber-100",
    actionActive:
      "border-2 border-amber-600 bg-amber-500 text-white shadow-md ring-2 ring-amber-300/70 ring-offset-1",
  },
  RAMPA_2: {
    header: "bg-orange-600 text-white border-orange-500",
    card: "bg-orange-50 border-orange-200 text-orange-950",
    badge: "bg-orange-100 text-orange-800",
    stripe: "from-orange-400 to-orange-600",
    actionIdle:
      "border-2 border-orange-300 bg-orange-50 text-orange-900 hover:border-orange-400 hover:bg-orange-100",
    actionActive:
      "border-2 border-orange-600 bg-orange-500 text-white shadow-md ring-2 ring-orange-300/70 ring-offset-1",
  },
  COMPLETADO: {
    header: "bg-emerald-700 text-white border-emerald-600",
    card: "bg-emerald-50 border-emerald-200 text-emerald-950",
    badge: "bg-emerald-100 text-emerald-800",
    stripe: "from-emerald-400 to-emerald-600",
    actionIdle:
      "border-2 border-emerald-300 bg-emerald-50 text-emerald-900 hover:border-emerald-400 hover:bg-emerald-100",
    actionActive:
      "border-2 border-emerald-700 bg-emerald-600 text-white shadow-md ring-2 ring-emerald-300/70 ring-offset-1",
  },
};

/** Tema alto contraste para Pantalla TV (fondo oscuro). */
export const RECEPTION_TV_THEME = {
  pageBg: "bg-[#0a0f1a]",
  panelBg: "bg-[#111827]",
  panelBorder: "border-slate-700",
  title: "text-white",
  subtitle: "text-slate-400",
  filaHeader: "bg-slate-600 text-white",
  rampaHeader: "bg-amber-500 text-black",
  cardBg: "bg-[#1e293b] border-slate-600 text-white",
  cardMuted: "text-slate-400",
  accent: "text-amber-400",
};

// ─── TEXTOS DE INTERFAZ ───────────────────────────────────────────────────────

export const RECEPTION_COPY = {
  operatorTitle: "Recepción de camiones",
  operatorSubtitle:
    "Tablero Kanban, reporte diario de OR y pantalla TV para bodega.",
  tvTitle: "Recepción de camiones — Pantalla",
  tvSubtitle: "Actualización en vivo para proveedores y supervisión",
  reportLabel: "Generar reporte",
  reportHint:
    "Excel del día: OR recibidas, hora de llegada, espera en fila, tiempo de descarga y resumen con Alde.IA.",
  searchPlaceholder: "Buscar por placa, RA, proveedor o cliente…",
  emptyColumn: "Sin camiones",
  receiptTitle: "Recibo de Almacén",
  companyName: "ALDEPÓSITOS",
  companyTagline: "Servicios logísticos integrales — Zona Libre Panamá",
};

/** Prefijo del número de recibo (ej. WH-). */
export const RECEPTION_RECEIPT_PREFIX = "WH-";
