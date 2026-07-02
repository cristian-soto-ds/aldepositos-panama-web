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
  showWeightColumn: boolean;
  showReferenceColumn: boolean;
  totals: ReportTotals;
};

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
  const showWeightColumn = task.weightMode === "per_bundle" || isDetailed;
  /** Misma regla que ingreso rápido / guía aérea: siempre mostrar Referencia en el reporte. */
  const showReferenceColumn = true;

  let totalWeight = task.expectedWeight || 0;
  let totalUnidades = 0;

  if (isDetailed) {
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
    showWeightColumn,
    showReferenceColumn,
    totals,
  };
}

export function reportModuleLabel(task: Task): string {
  if (task.type === "detailed") return "detallado";
  if (task.type === "airway") return "guía aérea";
  return "rápido";
}
