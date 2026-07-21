import type { Task } from "@/lib/types/task";
import {
  cubicajeM3FromDims,
  formatCubicaje2,
  parseMeasureNumber,
  roundMeasureNearest,
  roundUpMeasure,
} from "@/lib/measureDecimals";
import {
  isReferenceCaptureMode,
  type ReferenceCaptureMode,
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
  /** Ingreso rápido guardado en modo sin referencias. */
  isWithoutReferences: boolean;
  referenceMode: ReferenceCaptureMode | null;
  showWeightColumn: boolean;
  showReferenceColumn: boolean;
  totals: ReportTotals;
};

/** Número de paleta normalizado de una fila (>= 1). */
export function reportRowPallet(row: Record<string, unknown>): number {
  return Math.max(1, Number(row.pallet) || 1);
}

/**
 * CBM de una línea del reporte (= columna «Total CBM»).
 * 1) L×W×H×bultos si hay medidas
 * 2) si no, `volumenM3` de la línea (OR / import)
 */
export function reportLineTotalCbm(row: Record<string, unknown>): number {
  if (row.reempaque === true) return 0;
  const fromDims = cubicajeM3FromDims(row.l, row.w, row.h, row.bultos, false);
  if (fromDims > 0) return fromDims;
  const vol = parseMeasureNumber(row.volumenM3);
  return vol > 0 ? roundMeasureNearest(vol) : 0;
}

/** Suma de los Total CBM de cada fila (misma cifra que el KPI «Volumen total»). */
export function sumReportCubicajeM3(rows: Record<string, unknown>[]): number {
  const total = rows.reduce((acc, row) => acc + reportLineTotalCbm(row), 0);
  return roundMeasureNearest(total);
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

export function resolveTaskReferenceMode(task: Task): ReferenceCaptureMode | null {
  return isReferenceCaptureMode(task.referenceMode) ? task.referenceMode : null;
}

export function computeReportData(task: Task): ReportComputed {
  // Filas tal cual en BD: el reporte no debe strip/normalize (eso podía vaciar medidas).
  const measureRows = (task.measureData || []) as Record<string, unknown>[];
  const isDetailed = task.type === "detailed";
  const isAirway = task.type === "airway";
  const storedMode = resolveTaskReferenceMode(task);
  const inferredPalletized =
    !isDetailed &&
    measureRows.some((r) => r.pallet != null && (Number(r.pallet) || 0) >= 1);
  const isPalletized =
    !isDetailed && (storedMode === "palletized" || (storedMode === null && inferredPalletized));
  const isWithoutReferences = !isDetailed && storedMode === "without";
  const showWeightColumn =
    !isPalletized && (task.weightMode === "per_bundle" || isDetailed);
  const showReferenceColumn =
    isDetailed ||
    storedMode === "with" ||
    (storedMode === null && !isPalletized && !isWithoutReferences);

  let totalWeight = 0;
  let totalUnidades = 0;

  if (isPalletized) {
    totalWeight = roundUpMeasure(sumPalletWeight(measureRows));
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
    totalWeight = roundUpMeasure(
      measureRows.reduce((acc, row) => {
        if (row.reempaque === true) return acc;
        return (
          acc +
          (parseFloat(String(row.weight ?? 0)) || 0) *
            (parseFloat(String(row.bultos ?? 0)) || 0)
        );
      }, 0),
    );
  }

  // Sin peso capturado por fila: mostrar el declarado del RA (no dejar 0.00 engañoso).
  if (totalWeight <= 0 && (task.expectedWeight || 0) > 0) {
    totalWeight = roundUpMeasure(task.expectedWeight);
  }

  const totals: ReportTotals = {
    bultos: measureRows.reduce(
      (a, b) => a + (parseFloat(String(b.bultos ?? 0)) || 0),
      0,
    ),
    cbm: formatCubicaje2(sumReportCubicajeM3(measureRows)) || "0.00",
    weight: roundUpMeasure(totalWeight),
    unidades: totalUnidades,
  };

  return {
    measureRows,
    isDetailed,
    isAirway,
    isPalletized,
    isWithoutReferences,
    referenceMode: storedMode,
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
  const mode = resolveTaskReferenceMode(task);
  if (mode === "with") return "rápido · con referencias";
  if (mode === "without") return "rápido · sin referencias";
  if (mode === "palletized") return "rápido · paletizado";
  return "rápido";
}

/** Texto L/W/H en reporte: «—» si no hay captura (no «0»). */
export function reportDimDisplay(value: unknown): string {
  const n = parseMeasureNumber(value);
  if (n <= 0) return "—";
  const raw = String(value ?? "").trim();
  return raw || String(n);
}
