import type { Task } from "@/lib/types/task";
import {
  cubicajeM3FromDims,
  formatMeasure2,
  roundUpMeasure,
} from "@/lib/measureDecimals";
import {
  stripQuickRowsForPersist,
  type QuickMeasureRow,
} from "@/lib/quickInventoryTypes";

export type ReportTotals = {
  bultos: number;
  cbm: string;
  weight: number;
  unidades: number;
};

export type ReportComputed = {
  measureRows: Record<string, unknown>[];
  isDetailed: boolean;
  isAirway: boolean;
  /** Ingreso rápido guardado en modo paletizado (agrupa por paleta; peso por paleta). */
  isPalletized: boolean;
  showWeightColumn: boolean;
  showReferenceColumn: boolean;
  totals: ReportTotals;
};

/** Número de paleta normalizado de una fila (>= 1). */
export function reportRowPallet(row: Record<string, unknown>): number {
  return Math.max(1, Number(row.pallet) || 1);
}

/** Suma el peso declarado por paleta (una sola vez por paleta). */
function sumPalletWeight(rows: Record<string, unknown>[]): number {
  const seen = new Set<number>();
  let acc = 0;
  for (const row of rows) {
    const p = reportRowPallet(row);
    if (seen.has(p)) continue;
    seen.add(p);
    acc += parseFloat(String(row.palletWeight ?? 0)) || 0;
  }
  return acc;
}

export function computeReportData(task: Task): ReportComputed {
  const rawRows = (task.measureData || []) as Record<string, unknown>[];
  const isDetailed = task.type === "detailed";
  const isAirway = task.type === "airway";
  const measureRows = isDetailed
    ? rawRows
    : (stripQuickRowsForPersist(rawRows as QuickMeasureRow[]) as Record<
        string,
        unknown
      >[]);
  // Paletizado: el ingreso rápido se guardó con filas agrupadas por paleta
  // (cada fila lleva su número de paleta; el peso se captura una vez por paleta).
  const isPalletized =
    !isDetailed &&
    measureRows.some((r) => r.pallet != null && (Number(r.pallet) || 0) >= 1);
  // En paletizado el peso no va por fila (se muestra por paleta), así que no
  // se usa la columna de peso por fila.
  const showWeightColumn =
    !isPalletized && (task.weightMode === "per_bundle" || isDetailed);
  /** Misma regla que ingreso rápido / guía aérea: siempre mostrar Referencia en el reporte. */
  const showReferenceColumn = true;

  let totalWeight = task.expectedWeight || 0;
  let totalUnidades = 0;

  if (isPalletized) {
    const calcWeight = roundUpMeasure(sumPalletWeight(measureRows));
    if (calcWeight > 0) totalWeight = calcWeight;
  } else if (isDetailed) {
    totalWeight = roundUpMeasure(
      measureRows.reduce(
        (acc, row) =>
          acc +
          (parseFloat(String(row.pesoPorBulto ?? 0)) || 0) *
            (parseFloat(String(row.bultos ?? 0)) || 0),
        0,
      ),
    );
    totalUnidades = measureRows.reduce(
      (acc, row) =>
        acc +
        (parseFloat(String(row.unidadesPorBulto ?? 0)) || 0) *
          (parseFloat(String(row.bultos ?? 0)) || 0),
      0,
    );
  } else if (task.weightMode === "per_bundle") {
    const calcWeight = roundUpMeasure(
      measureRows.reduce(
        (acc, row) =>
          acc +
          (parseFloat(String(row.weight ?? 0)) || 0) *
            (parseFloat(String(row.bultos ?? 0)) || 0),
        0,
      ),
    );
    if (calcWeight > 0) totalWeight = calcWeight;
  }

  const totals: ReportTotals = {
    bultos: measureRows.reduce(
      (a, b) => a + (parseFloat(String(b.bultos ?? 0)) || 0),
      0,
    ),
    cbm: formatMeasure2(
      measureRows.reduce(
        (acc, row) =>
          acc +
          cubicajeM3FromDims(
            row.l,
            row.w,
            row.h,
            row.bultos,
            row.reempaque === true,
          ),
        0,
      ),
    ) || "0.00",
    weight: roundUpMeasure(totalWeight),
    unidades: totalUnidades,
  };

  return {
    measureRows,
    isDetailed,
    isAirway,
    isPalletized,
    showWeightColumn,
    showReferenceColumn,
    totals,
  };
}

/** Peso total declarado de una paleta concreta (kg). */
export function reportPalletWeight(
  rows: Record<string, unknown>[],
  palletNum: number,
): number {
  const found = rows.find(
    (r) =>
      reportRowPallet(r) === palletNum &&
      String(r.palletWeight ?? "").trim() !== "",
  );
  return found ? parseFloat(String(found.palletWeight)) || 0 : 0;
}

export function reportModuleLabel(task: Task): string {
  if (task.type === "detailed") return "detallado";
  if (task.type === "airway") return "guía aérea";
  return "rápido";
}
