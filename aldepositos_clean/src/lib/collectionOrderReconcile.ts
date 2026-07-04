import type { CollectionOrder, CollectionOrderLine } from "@/lib/types/collectionOrder";
import { pesoTotalFromLine } from "@/lib/collectionLineUtils";
import { cubicajeM3FromRow, roundMeasureNearest } from "@/lib/measureDecimals";

function parseN(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * CUBICAJE de una línea de recolección. Usa la fórmula canónica del sistema
 * (dimensiones primero; `volumenM3` como total de línea solo si no hay medidas).
 */
function cbmFromLine(line: CollectionOrderLine): number {
  return cubicajeM3FromRow(line);
}

export type CapturedLinesTotals = {
  bultos: number;
  pesoKg: number;
  cbm: number;
  /** Líneas con al menos 1 bulto capturado. */
  linesWithBultos: number;
  referenciaCount: number;
};

/** Suma bultos de todas las filas; peso/CBM de filas con bultos o referencia. */
export function totalsFromCapturedLines(lines: CollectionOrderLine[]): CapturedLinesTotals {
  let bultos = 0;
  let pesoKg = 0;
  let cbm = 0;
  let linesWithBultos = 0;
  let referenciaCount = 0;

  for (const line of lines) {
    const b = Math.max(0, Math.round(parseN(line.bultos)));
    const hasRef = String(line.referencia ?? "").trim().length > 0;
    if (hasRef) referenciaCount += 1;
    if (b > 0) {
      linesWithBultos += 1;
      bultos += b;
      pesoKg += pesoTotalFromLine(line);
      cbm += cbmFromLine(line);
    }
  }

  return { bultos, pesoKg, cbm: roundMeasureNearest(cbm), linesWithBultos, referenciaCount };
}

/** @deprecated Usar totalsFromCapturedLines */
export function totalsFromReferenceLines(lines: CollectionOrderLine[]): CapturedLinesTotals {
  return totalsFromCapturedLines(lines);
}

export type ReconcileCheck = {
  label: string;
  expected: number;
  actual: number;
  ok: boolean;
  delta: number;
};

export type OrderReconcileResult = {
  checks: ReconcileCheck[];
  allOk: boolean;
  hasExpected: boolean;
  /** Hay al menos un bulto capturado en la tabla. */
  hasCaptured: boolean;
  bultosProgress: { actual: number; expected: number; pct: number } | null;
};

const BULTOS_TOL = 0;
const PESO_TOL = 0.05;
const CBM_TOL = 0.02;

export function reconcileCollectionOrder(
  order: Pick<CollectionOrder, "expectedBultos" | "expectedPesoKg" | "expectedCbm">,
  captured: CapturedLinesTotals,
): OrderReconcileResult {
  const hasExpected =
    (order.expectedBultos ?? 0) > 0 ||
    (order.expectedPesoKg ?? 0) > 0 ||
    (order.expectedCbm ?? 0) > 0;
  const hasCaptured = captured.bultos > 0 || captured.linesWithBultos > 0;

  const checks: ReconcileCheck[] = [];

  let bultosProgress: OrderReconcileResult["bultosProgress"] = null;

  if ((order.expectedBultos ?? 0) > 0) {
    const expected = Math.round(order.expectedBultos ?? 0);
    const actual = captured.bultos;
    const delta = actual - expected;
    checks.push({
      label: "Bultos",
      expected,
      actual,
      delta,
      ok: Math.abs(delta) <= BULTOS_TOL,
    });
    bultosProgress = {
      actual,
      expected,
      pct: expected > 0 ? Math.min(100, Math.round((actual / expected) * 100)) : 0,
    };
  }

  if ((order.expectedPesoKg ?? 0) > 0) {
    const expected = order.expectedPesoKg ?? 0;
    const actual = captured.pesoKg;
    const delta = actual - expected;
    checks.push({
      label: "Peso (kg)",
      expected,
      actual,
      delta,
      ok: Math.abs(delta) <= PESO_TOL,
    });
  }

  if ((order.expectedCbm ?? 0) > 0) {
    const expected = order.expectedCbm ?? 0;
    const actual = captured.cbm;
    const delta = actual - expected;
    checks.push({
      label: "Cubicaje (m³)",
      expected,
      actual,
      delta,
      ok: Math.abs(delta) <= CBM_TOL,
    });
  }

  const applicableChecks = checks.filter((c) => c.expected > 0);

  return {
    checks: applicableChecks,
    allOk: applicableChecks.length > 0 && applicableChecks.every((c) => c.ok),
    hasExpected,
    hasCaptured,
    bultosProgress,
  };
}

/** Migra notas antiguas y filas resumen HTM al encabezado de la orden. */
export function normalizeCollectionOrderFields(order: CollectionOrder): CollectionOrder {
  let expedidor = String(order.expedidor ?? "").trim();
  let fechaEntrega = String(order.fechaEntrega ?? "").trim();
  const notes = String(order.notes ?? "");
  let expectedBultos = order.expectedBultos;
  let expectedPesoKg = order.expectedPesoKg;
  let expectedCbm = order.expectedCbm;
  let lines = order.lines;

  if (!expedidor && notes) {
    const expMatch = notes.match(/Expedidor:\s*([^\n]+)/i);
    if (expMatch) expedidor = expMatch[1]!.trim();
  }
  if (!fechaEntrega && notes) {
    const fechaMatch = notes.match(/Fecha entrega:\s*([^\n]+)/i);
    if (fechaMatch) fechaEntrega = fechaMatch[1]!.trim();
  }

  if (expectedBultos == null || expectedBultos === 0) {
    const summaryRows = lines.filter(
      (l) => !String(l.referencia ?? "").trim() && parseN(l.bultos) > 0,
    );
    if (summaryRows.length === 1) {
      const row = summaryRows[0]!;
      expectedBultos = Math.round(parseN(row.bultos));
      const peso = pesoTotalFromLine(row);
      if (!expectedPesoKg && peso > 0) expectedPesoKg = peso;
      const cbm = cbmFromLine(row);
      if (!expectedCbm && cbm > 0) expectedCbm = cbm;
      lines = lines.map((l) =>
        l.id === row.id
          ? {
              ...l,
              bultos: "",
              pesoPorBulto: "",
              volumenM3: "",
              descripcion: "",
            }
          : l,
      );
    }
  }

  return {
    ...order,
    expedidor,
    fechaEntrega: fechaEntrega || undefined,
    expectedBultos,
    expectedPesoKg,
    expectedCbm,
    lines,
  };
}
