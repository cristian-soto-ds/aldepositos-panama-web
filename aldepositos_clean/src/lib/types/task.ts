/**
 * Modelo principal de carga (RA) compartido por el panel.
 * Se persiste en Supabase como JSON en la tabla `tasks`.
 */
import type { ReferenceCaptureMode } from "@/lib/quickInventoryTypes";

export type Task = {
  id: string;
  ra: string;
  mainClient: string;
  provider: string;
  subClient: string;
  brand: string;
  expectedBultos: number;
  originalExpectedBultos: number;
  expectedCbm: number;
  expectedWeight: number;
  notes: string;
  currentBultos: number;
  status: string;
  measureData: unknown[];
  weightMode: string;
  manualTotalWeight: number;
  type?: "quick" | "detailed" | "airway";
  /** Modo de captura del ingreso rápido: con refs, sin refs o paletizado. */
  referenceMode?: ReferenceCaptureMode;
  dispatched?: boolean;
  containerDraft?: boolean;
  dispatchInfo?: {
    type: string;
    tare?: number;
    consignment: string;
    number: string;
    bl: string;
    seal1: string;
    seal2: string;
    responsible: string;
    date: string;
  };
  date?: string;
  /** ISO de la última vez que se guardó el inventario de este RA (para "última actualización"). */
  updatedAt?: string;
  /**
   * ISO de la primera captura con datos en este RA.
   * No se sobrescribe; base del KPI de tiempo activo.
   */
  inventoryStartedAt?: string;
  /** ISO si el inventario está pausado ahora (`status === "paused"`). */
  inventoryPausedAt?: string;
  /** Ms de pausa acumulados en pausas ya cerradas (excluye la pausa abierta). */
  inventoryPausedMs?: number;
  /** Email (minúsculas) del operador que creó/importó el RA por primera vez. */
  createdByEmail?: string;
  createdByName?: string;
  /** Última intervención por usuario (deduplicado por email). */
  contributors?: Array<{
    email: string;
    displayName?: string;
    at: string;
  }>;
  /** Operador que terminó medidas y peso en este RA. */
  inventoryCompletedBy?: {
    email: string;
    displayName?: string;
    at: string;
  };
  /**
   * Id de la orden de recolección que envió medidas a este RA.
   * Impide que otra orden de recolección envíe al mismo RA.
   */
  linkedCollectionOrderId?: string;
};
