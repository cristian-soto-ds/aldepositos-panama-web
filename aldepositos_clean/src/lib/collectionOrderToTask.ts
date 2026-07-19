import type { Task } from "@/lib/types/task";
import type { CollectionOrder, CollectionOrderLine } from "@/lib/types/collectionOrder";
import { totalsFromCapturedLines } from "@/lib/collectionOrderReconcile";

const EMPTY_CLIENT_LABELS = new Set(["", "Sin Cliente"]);
const EMPTY_TEXT_LABELS = new Set(["", "N/A"]);

function hasMeaningfulText(value: unknown, empty: Set<string>): boolean {
  const v = String(value ?? "").trim();
  return v.length > 0 && !empty.has(v);
}

function pickText(
  current: unknown,
  incoming: unknown,
  empty: Set<string>,
  overwrite: boolean,
): string | undefined {
  const next = String(incoming ?? "").trim();
  if (!next) return undefined;
  const cur = String(current ?? "").trim();
  if (overwrite || !hasMeaningfulText(cur, empty)) return next;
  return undefined;
}

function pickPositiveNumber(
  current: number | undefined,
  incoming: number,
  overwrite: boolean,
): number | undefined {
  if (!Number.isFinite(incoming) || incoming <= 0) return undefined;
  if (overwrite || !current || current <= 0) return incoming;
  return undefined;
}

/** Copia datos de encabezado y totales de una OR al RA al vincularlas. */
export function mergeCollectionOrderIntoTask(
  task: Task,
  order: CollectionOrder,
  lines: CollectionOrderLine[],
  options?: { overwrite?: boolean },
): Task {
  const overwrite = options?.overwrite ?? true;
  const totals = totalsFromCapturedLines(lines);
  const next: Task = { ...task };

  const mainClient = pickText(
    task.mainClient,
    order.cliente,
    EMPTY_CLIENT_LABELS,
    overwrite,
  );
  if (mainClient !== undefined) next.mainClient = mainClient;

  const provider = pickText(task.provider, order.proveedor, EMPTY_TEXT_LABELS, overwrite);
  if (provider !== undefined) next.provider = provider;

  const brand = pickText(task.brand, order.marca, EMPTY_TEXT_LABELS, overwrite);
  if (brand !== undefined) next.brand = brand;

  const subClient = pickText(task.subClient, order.expedidor, EMPTY_TEXT_LABELS, overwrite);
  if (subClient !== undefined) next.subClient = subClient;

  const orderNotes = String(order.notes ?? "").trim();
  if (orderNotes && (overwrite || !String(task.notes ?? "").trim())) {
    next.notes = orderNotes;
  }

  const bultos =
    totals.bultos > 0
      ? totals.bultos
      : Math.max(0, Math.round(Number(order.expectedBultos) || 0));
  const expectedBultos = pickPositiveNumber(task.expectedBultos, bultos, overwrite);
  if (expectedBultos !== undefined) {
    next.expectedBultos = expectedBultos;
    if (!task.originalExpectedBultos || task.originalExpectedBultos <= 0) {
      next.originalExpectedBultos = expectedBultos;
    }
  }

  const peso =
    totals.pesoKg > 0
      ? totals.pesoKg
      : Math.max(0, Number(order.expectedPesoKg) || 0);
  const expectedWeight = pickPositiveNumber(task.expectedWeight, peso, overwrite);
  if (expectedWeight !== undefined) next.expectedWeight = expectedWeight;

  const cbm =
    totals.cbm > 0 ? totals.cbm : Math.max(0, Number(order.expectedCbm) || 0);
  const expectedCbm = pickPositiveNumber(task.expectedCbm, cbm, overwrite);
  if (expectedCbm !== undefined) next.expectedCbm = expectedCbm;

  return next;
}

export function emptyManualRaTaskFields(): Pick<
  Task,
  "mainClient" | "provider" | "subClient" | "brand" | "expectedBultos" | "originalExpectedBultos" | "expectedCbm" | "expectedWeight" | "notes"
> {
  return {
    mainClient: "",
    provider: "",
    subClient: "",
    brand: "",
    expectedBultos: 0,
    originalExpectedBultos: 0,
    expectedCbm: 0,
    expectedWeight: 0,
    notes: "",
  };
}

export function raClientGroupLabel(mainClient: string | undefined): string {
  const v = String(mainClient ?? "").trim();
  return v || "Sin asignar";
}

export function formatRaFieldLabel(value: string | undefined): string {
  const v = String(value ?? "").trim();
  return v && !EMPTY_TEXT_LABELS.has(v) ? v : "—";
}
