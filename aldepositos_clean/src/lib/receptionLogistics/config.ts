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
  RAMPA_EXTRA: "RAMPA_EXTRA",
  CARRETILLADO: "CARRETILLADO",
  /** Entrega incompleta: faltan bultos que el proveedor trae después. */
  PARCIAL: "PARCIAL",
  COMPLETADO: "COMPLETADO",
} as const;

export type ReceptionStatusId =
  (typeof RECEPTION_STATUS)[keyof typeof RECEPTION_STATUS];

/** Textos visibles de cada estado (cámbialos aquí). */
export const RECEPTION_STATUS_LABELS: Record<ReceptionStatusId, string> = {
  EN_FILA: "En Fila",
  RAMPA_1: "Rampa 1",
  RAMPA_2: "Rampa 2",
  RAMPA_EXTRA: "Rampa Extra",
  CARRETILLADO: "Carretillado",
  PARCIAL: "Parcial / Pendiente",
  COMPLETADO: "Completado",
};

/**
 * Estados especiales (poco frecuentes): solo se muestran como columna cuando
 * tienen al menos una orden asignada. Se activan por orden desde Recepcionista.
 */
export const RECEPTION_OPTIONAL_STATUS: ReceptionStatusId[] = [
  RECEPTION_STATUS.RAMPA_EXTRA,
  RECEPTION_STATUS.CARRETILLADO,
  RECEPTION_STATUS.PARCIAL,
];

/**
 * Estados que solo se asignan desde Recepcionista (requieren datos extra,
 * p. ej. bultos recibidos): no se permite arrastrarlos en el tablero.
 */
export const RECEPTION_NO_DROP_STATUS: ReceptionStatusId[] = [
  RECEPTION_STATUS.PARCIAL,
];

/**
 * Estados que disparan la generación del Recibo de Almacén al mover un camión.
 * Por defecto: al entrar a una rampa (incluida la extra) o al carretillar.
 */
export const RECEPTION_RECEIPT_ON_STATUS: ReceptionStatusId[] = [
  RECEPTION_STATUS.RAMPA_1,
  RECEPTION_STATUS.RAMPA_2,
  RECEPTION_STATUS.RAMPA_EXTRA,
  RECEPTION_STATUS.CARRETILLADO,
];

/**
 * Estados en los que el camión está siendo atendido en una rampa o carretillado.
 * Se usa para sellar la hora de atención y qué rampa se usó (para el reporte).
 */
export const RECEPTION_RAMP_STATUSES: ReceptionStatusId[] = [
  RECEPTION_STATUS.RAMPA_1,
  RECEPTION_STATUS.RAMPA_2,
  RECEPTION_STATUS.RAMPA_EXTRA,
  RECEPTION_STATUS.CARRETILLADO,
];

export function isRampReceptionStatus(status: ReceptionStatusId): boolean {
  return RECEPTION_RAMP_STATUSES.includes(status);
}

/** Columnas del tablero Kanban del módulo Operador (orden de izquierda a derecha). */
export const RECEPTION_KANBAN_COLUMNS: ReceptionStatusId[] = [
  RECEPTION_STATUS.EN_FILA,
  RECEPTION_STATUS.RAMPA_1,
  RECEPTION_STATUS.RAMPA_2,
  RECEPTION_STATUS.RAMPA_EXTRA,
  RECEPTION_STATUS.CARRETILLADO,
  RECEPTION_STATUS.PARCIAL,
  RECEPTION_STATUS.COMPLETADO,
];

/**
 * Orden de la fila: prioritarios primero (por hora de prioridad),
 * luego FIFO por sortOrder (hora real de entrada a fila).
 */
export function compareReceptionQueue(
  a: { priority?: boolean; priorityAt?: string; sortOrder: number },
  b: { priority?: boolean; priorityAt?: string; sortOrder: number },
): number {
  const pa = a.priority === true ? 0 : 1;
  const pb = b.priority === true ? 0 : 1;
  if (pa !== pb) return pa - pb;
  if (pa === 0) {
    const ta = Date.parse(a.priorityAt ?? "") || 0;
    const tb = Date.parse(b.priorityAt ?? "") || 0;
    if (ta !== tb) return ta - tb;
  }
  return a.sortOrder - b.sortOrder;
}

/** Tema de la etiqueta / borde «Prioridad». */
export const RECEPTION_PRIORITY_THEME = {
  badge:
    "border-red-700/30 bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-sm shadow-red-600/30 ring-1 ring-inset ring-white/15",
  /** Borde + sombra suave (el `!` gana al borde del tema de la columna). */
  cardRing:
    "border-red-300! ring-1 ring-red-200/80 shadow-[0_8px_22px_-12px_rgba(220,38,38,0.55)] dark:border-red-700/70! dark:ring-red-900/50",
  cardBg:
    "bg-gradient-to-r from-red-50 via-white to-white dark:from-red-950/40 dark:via-slate-900 dark:to-slate-900",
  stripe: "from-red-500 to-rose-700",
  queueBadge: "border-red-700 bg-gradient-to-b from-red-500 to-red-700",
  actionIdle:
    "border-2 border-red-200 bg-red-50 text-red-700 hover:border-red-400 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50",
  actionActive:
    "border-2 border-red-700 bg-red-600 text-white shadow-md ring-2 ring-red-300/70 ring-offset-1 dark:ring-offset-slate-900",
};

/**
 * Estados visibles en la Pantalla TV (solo lectura).
 * Por defecto: fila + rampas (sin completados). Las especiales aparecen solas.
 */
export const RECEPTION_TV_STATUS_IDS: ReceptionStatusId[] = [
  RECEPTION_STATUS.EN_FILA,
  RECEPTION_STATUS.RAMPA_1,
  RECEPTION_STATUS.RAMPA_2,
  RECEPTION_STATUS.RAMPA_EXTRA,
  RECEPTION_STATUS.CARRETILLADO,
  RECEPTION_STATUS.PARCIAL,
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
    card: "bg-white border-slate-200 text-slate-900 dark:bg-slate-800/90 dark:border-slate-600 dark:text-slate-100",
    badge: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600",
    stripe: "from-slate-500 to-slate-700",
    actionIdle:
      "border-2 border-slate-300 bg-slate-100 text-slate-800 hover:border-slate-400 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
    actionActive:
      "border-2 border-slate-800 bg-slate-700 text-white shadow-md ring-2 ring-slate-400/60 ring-offset-1 dark:ring-offset-slate-900",
  },
  RAMPA_1: {
    header: "bg-amber-600 text-white border-amber-500",
    card: "bg-amber-50 border-amber-200 text-amber-950 dark:bg-amber-950/45 dark:border-amber-700/55 dark:text-amber-50",
    badge: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/75 dark:text-amber-100 dark:border-amber-700/50",
    stripe: "from-amber-400 to-amber-600",
    actionIdle:
      "border-2 border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-400 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/50",
    actionActive:
      "border-2 border-amber-600 bg-amber-500 text-white shadow-md ring-2 ring-amber-300/70 ring-offset-1 dark:ring-offset-slate-900",
  },
  RAMPA_2: {
    header: "bg-orange-600 text-white border-orange-500",
    card: "bg-orange-50 border-orange-200 text-orange-950 dark:bg-orange-950/45 dark:border-orange-700/55 dark:text-orange-50",
    badge: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/75 dark:text-orange-100 dark:border-orange-700/50",
    stripe: "from-orange-400 to-orange-600",
    actionIdle:
      "border-2 border-orange-300 bg-orange-50 text-orange-900 hover:border-orange-400 hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-100 dark:hover:bg-orange-900/50",
    actionActive:
      "border-2 border-orange-600 bg-orange-500 text-white shadow-md ring-2 ring-orange-300/70 ring-offset-1 dark:ring-offset-slate-900",
  },
  RAMPA_EXTRA: {
    header: "bg-sky-600 text-white border-sky-500",
    card: "bg-sky-50 border-sky-200 text-sky-950 dark:bg-sky-950/45 dark:border-sky-700/55 dark:text-sky-50",
    badge: "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/75 dark:text-sky-100 dark:border-sky-700/50",
    stripe: "from-sky-400 to-sky-600",
    actionIdle:
      "border-2 border-sky-300 bg-sky-50 text-sky-900 hover:border-sky-400 hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-100 dark:hover:bg-sky-900/50",
    actionActive:
      "border-2 border-sky-600 bg-sky-500 text-white shadow-md ring-2 ring-sky-300/70 ring-offset-1 dark:ring-offset-slate-900",
  },
  CARRETILLADO: {
    header: "bg-violet-600 text-white border-violet-500",
    card: "bg-violet-50 border-violet-200 text-violet-950 dark:bg-violet-950/45 dark:border-violet-700/55 dark:text-violet-50",
    badge: "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/75 dark:text-violet-100 dark:border-violet-700/50",
    stripe: "from-violet-400 to-violet-600",
    actionIdle:
      "border-2 border-violet-300 bg-violet-50 text-violet-900 hover:border-violet-400 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-100 dark:hover:bg-violet-900/50",
    actionActive:
      "border-2 border-violet-600 bg-violet-500 text-white shadow-md ring-2 ring-violet-300/70 ring-offset-1 dark:ring-offset-slate-900",
  },
  PARCIAL: {
    header: "bg-pink-600 text-white border-pink-500",
    card: "bg-pink-50 border-pink-200 text-pink-950 dark:bg-pink-950/45 dark:border-pink-700/55 dark:text-pink-50",
    badge: "bg-pink-100 text-pink-800 border-pink-200 dark:bg-pink-900/75 dark:text-pink-100 dark:border-pink-700/50",
    stripe: "from-pink-400 to-pink-600",
    actionIdle:
      "border-2 border-pink-300 bg-pink-50 text-pink-900 hover:border-pink-400 hover:bg-pink-100 dark:border-pink-700 dark:bg-pink-950/40 dark:text-pink-100 dark:hover:bg-pink-900/50",
    actionActive:
      "border-2 border-pink-600 bg-pink-500 text-white shadow-md ring-2 ring-pink-300/70 ring-offset-1 dark:ring-offset-slate-900",
  },
  COMPLETADO: {
    header: "bg-emerald-700 text-white border-emerald-600",
    card: "bg-emerald-50 border-emerald-200 text-emerald-950 dark:bg-emerald-950/50 dark:border-emerald-700/55 dark:text-emerald-50",
    badge: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/75 dark:text-emerald-100 dark:border-emerald-700/50",
    stripe: "from-emerald-400 to-emerald-600",
    actionIdle:
      "border-2 border-emerald-300 bg-emerald-50 text-emerald-900 hover:border-emerald-400 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-900/50",
    actionActive:
      "border-2 border-emerald-700 bg-emerald-600 text-white shadow-md ring-2 ring-emerald-300/70 ring-offset-1 dark:ring-offset-slate-900",
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
    "Tablero Kanban y pantalla TV para bodega.",
  tvTitle: "Recepción de camiones — Pantalla",
  tvSubtitle: "Actualización en vivo para proveedores y supervisión",
  searchPlaceholder: "Buscar por placa, RA, proveedor o cliente…",
  emptyColumn: "Sin camiones",
  receiptTitle: "Recibo de Almacén",
  companyName: "ALDEPÓSITOS",
  companyTagline: "Servicios logísticos integrales — Zona Libre Panamá",
};

/** Prefijo del número de recibo (ej. WH-). */
export const RECEPTION_RECEIPT_PREFIX = "WH-";
