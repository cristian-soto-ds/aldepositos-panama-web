import type { Task } from "@/lib/types/task";

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
  const measureRows = (task.measureData || []) as Record<string, unknown>[];
  const isDetailed = task.type === "detailed";
  const isAirway = task.type === "airway";
  const showWeightColumn = task.weightMode === "per_bundle" || isDetailed;
  const showReferenceColumn =
    task.weightMode === "by_reference" || isDetailed || isAirway;

  let totalWeight = task.expectedWeight || 0;
  let totalUnidades = 0;

  if (isDetailed) {
    totalWeight = measureRows.reduce(
      (acc, row) =>
        acc +
        (parseFloat(String(row.pesoPorBulto ?? 0)) || 0) *
          (parseFloat(String(row.bultos ?? 0)) || 0),
      0,
    );
    totalUnidades = measureRows.reduce(
      (acc, row) =>
        acc +
        (parseFloat(String(row.unidadesPorBulto ?? 0)) || 0) *
          (parseFloat(String(row.bultos ?? 0)) || 0),
      0,
    );
  } else if (task.weightMode === "per_bundle") {
    const calcWeight = measureRows.reduce(
      (acc, row) =>
        acc +
        (parseFloat(String(row.weight ?? 0)) || 0) *
          (parseFloat(String(row.bultos ?? 0)) || 0),
      0,
    );
    if (calcWeight > 0) totalWeight = calcWeight;
  }

  const totals: ReportTotals = {
    bultos: measureRows.reduce(
      (a, b) => a + (parseFloat(String(b.bultos ?? 0)) || 0),
      0,
    ),
    cbm: measureRows
      .reduce((acc, row) => {
        const l = parseFloat(String(row.l ?? 0)) || 0;
        const w = parseFloat(String(row.w ?? 0)) || 0;
        const h = parseFloat(String(row.h ?? 0)) || 0;
        const b = parseFloat(String(row.bultos ?? 0)) || 0;
        const isReempaque = row.reempaque === true;
        return acc + (isReempaque ? 0 : ((l * w * h) / 1_000_000) * b);
      }, 0)
      .toFixed(2),
    weight: totalWeight,
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
