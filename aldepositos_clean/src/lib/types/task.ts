/**
 * Modelo principal de carga (RA) compartido por el panel.
 * Se persiste en Supabase como JSON en la tabla `tasks`.
 */
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
};
