/**
 * Parte un RA inventariado en: completo / cargado (contenedor) / EN ALMACÉN.
 * El inventariador indica bultos que quedan en bodega; lo cargado = total − almacén.
 */

import type { Task } from "@/lib/types/task";
import {
  computeReportData,
  sumReportCubicajeM3,
  type ReportTotals,
} from "@/lib/reportTotals";
import { formatCubicaje2, roundUpMeasure } from "@/lib/measureDecimals";

export type PartialMeasureRow = Record<string, unknown> & {
  id?: string;
  bultos?: unknown;
};

export type InventoryPartialSplitResult = {
  fullRows: PartialMeasureRow[];
  loadedRows: PartialMeasureRow[];
  warehouseRows: PartialMeasureRow[];
  fullTotals: ReportTotals;
  loadedTotals: ReportTotals;
  warehouseTotals: ReportTotals;
  /** Task clones listos para Excel (measureData filtrado). */
  fullTask: Task;
  loadedTask: Task;
  warehouseTask: Task;
};

export function measureRowKey(
  row: PartialMeasureRow,
  index: number,
): string {
  const id = String(row.id ?? "").trim();
  if (id) return id;
  return `idx:${index}`;
}

function rowBultos(row: PartialMeasureRow): number {
  const n = parseFloat(String(row.bultos ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Escala campos proporcionales al ratio de bultos (peso total de fila, volumenM3).
 * Dimensiones L/W/H y peso/bulto se mantienen.
 */
function scaleRowByBultos(
  row: PartialMeasureRow,
  newBultos: number,
): PartialMeasureRow | null {
  const original = rowBultos(row);
  if (newBultos <= 0 || original <= 0) return null;
  const capped = Math.min(newBultos, original);
  if (capped <= 0) return null;

  const ratio = capped / original;
  const next: PartialMeasureRow = { ...row, bultos: capped };

  if (row.volumenM3 != null && String(row.volumenM3).trim() !== "") {
    const vol = parseFloat(String(row.volumenM3));
    if (Number.isFinite(vol) && vol > 0) {
      next.volumenM3 = Math.round(vol * ratio * 10000) / 10000;
    }
  }

  return next;
}

function totalsFromRows(task: Task, rows: PartialMeasureRow[]): ReportTotals {
  const clone: Task = { ...task, measureData: rows };
  return computeReportData(clone).totals;
}

/**
 * @param warehouseBultosByRowId bultos que el inventariador marca como EN ALMACÉN (0…original)
 */
export function splitInventoryPartial(
  task: Task,
  warehouseBultosByRowId: Record<string, number>,
): InventoryPartialSplitResult {
  const fullRows = (task.measureData || []) as PartialMeasureRow[];
  const loadedRows: PartialMeasureRow[] = [];
  const warehouseRows: PartialMeasureRow[] = [];

  fullRows.forEach((row, index) => {
    const key = measureRowKey(row, index);
    const original = rowBultos(row);
    if (original <= 0) return;

    const rawWh = warehouseBultosByRowId[key];
    let warehouseQty =
      rawWh == null || !Number.isFinite(Number(rawWh))
        ? 0
        : Math.max(0, Math.min(original, Math.round(Number(rawWh))));
    const loadedQty = Math.max(0, original - warehouseQty);

    const whRow = scaleRowByBultos(row, warehouseQty);
    const ldRow = scaleRowByBultos(row, loadedQty);
    if (whRow) warehouseRows.push(whRow);
    if (ldRow) loadedRows.push(ldRow);
  });

  const fullTask: Task = { ...task, measureData: fullRows };
  const loadedTask: Task = { ...task, measureData: loadedRows };
  const warehouseTask: Task = { ...task, measureData: warehouseRows };

  return {
    fullRows,
    loadedRows,
    warehouseRows,
    fullTotals: totalsFromRows(task, fullRows),
    loadedTotals: totalsFromRows(task, loadedRows),
    warehouseTotals: totalsFromRows(task, warehouseRows),
    fullTask,
    loadedTask,
    warehouseTask,
  };
}

/** Resumen compacto para UI (kg / CBM / bultos). */
export function formatPartialKpis(totals: ReportTotals): {
  bultos: number;
  weight: string;
  cbm: string;
} {
  return {
    bultos: totals.bultos,
    weight: roundUpMeasure(totals.weight).toFixed(2),
    cbm: totals.cbm || formatCubicaje2(0) || "0.00",
  };
}

/** Valida que ninguna cantidad en almacén exceda los bultos de la fila. */
export function sanitizeWarehouseBultosMap(
  task: Task,
  warehouseBultosByRowId: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const rows = (task.measureData || []) as PartialMeasureRow[];
  rows.forEach((row, index) => {
    const key = measureRowKey(row, index);
    const original = rowBultos(row);
    const raw = warehouseBultosByRowId[key];
    if (raw == null || !Number.isFinite(Number(raw))) {
      out[key] = 0;
      return;
    }
    out[key] = Math.max(0, Math.min(original, Math.round(Number(raw))));
  });
  return out;
}

export function sumWarehouseBultos(
  warehouseBultosByRowId: Record<string, number>,
): number {
  return Object.values(warehouseBultosByRowId).reduce(
    (a, n) => a + (Number.isFinite(n) ? n : 0),
    0,
  );
}

/** CBM de filas filtradas (atajo UI). */
export function cbmOfRows(rows: PartialMeasureRow[]): string {
  return formatCubicaje2(sumReportCubicajeM3(rows)) || "0.00";
}
