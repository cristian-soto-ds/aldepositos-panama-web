"use client";

import { useMemo, type ReactNode } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Package,
  Save,
  Scale,
  Box,
} from "lucide-react";
import type { QuickMeasureRow, ReferenceCaptureMode } from "@/lib/quickInventoryTypes";
import {
  cubicajeM3FromRow,
  formatCubicaje2,
  formatMeasure2,
  parseMeasureNumber,
  roundMeasureNearest,
  sumCubicajeM3,
} from "@/lib/measureDecimals";

/** Tolerancias alineadas con reconcile de OR. */
const PESO_TOL_KG = 0.05;
const CBM_TOL_M3 = 0.02;

type ReekonSaveReviewSheetProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  measureRows: QuickMeasureRow[];
  referenceMode: ReferenceCaptureMode;
  raLabel: string;
  declaredBultos: number;
  physicalBultos: number;
  expectedWeight: number;
  expectedCbm: number;
  capturedWeight: number;
  capturedCbm: number;
  isSaving: boolean;
};

function palletOf(row: QuickMeasureRow): number {
  return Math.max(1, Number(row.pallet) || 1);
}

function strVal(v: string | number | undefined): string {
  return String(v ?? "").trim();
}

function rowLabel(
  row: QuickMeasureRow,
  index: number,
  referenceMode: ReferenceCaptureMode,
  measureRows: QuickMeasureRow[],
): string {
  if (referenceMode === "palletized") {
    const pnum = palletOf(row);
    const subIdx = measureRows
      .slice(0, index + 1)
      .filter((r) => palletOf(r) === pnum).length;
    return `P${pnum}-${subIdx}`;
  }
  if (referenceMode === "with" && strVal(row.referencia)) {
    return strVal(row.referencia);
  }
  return `#${index + 1}`;
}

function lineWeightKg(
  row: QuickMeasureRow,
  referenceMode: ReferenceCaptureMode,
  isFirstInPallet: boolean,
): number {
  if (row.reempaque === true) return 0;
  if (referenceMode === "palletized") {
    if (!isFirstInPallet) return 0;
    return parseMeasureNumber(row.palletWeight);
  }
  const w = parseMeasureNumber(row.weight);
  const b = parseMeasureNumber(row.bultos);
  return w > 0 && b > 0 ? w * b : 0;
}

function formatSignedDiff(delta: number, decimals: number, unit: string): string {
  const abs = Math.abs(delta).toFixed(decimals);
  if (Math.abs(delta) < 10 ** -decimals / 2) return `0.${"0".repeat(decimals)} ${unit}`;
  const sign = delta > 0 ? "+" : "−";
  return `${sign}${abs} ${unit}`;
}

function diffTone(delta: number, tol: number): "ok" | "over" | "under" {
  if (Math.abs(delta) <= tol) return "ok";
  return delta > 0 ? "over" : "under";
}

function DiffKpiCard({
  title,
  icon,
  factura,
  capturado,
  delta,
  tol,
  decimals,
  unit,
  hasFactura,
}: {
  title: string;
  icon: ReactNode;
  factura: number;
  capturado: number;
  delta: number;
  tol: number;
  decimals: number;
  unit: string;
  hasFactura: boolean;
}) {
  const tone = hasFactura ? diffTone(delta, tol) : "ok";
  const wrap =
    !hasFactura
      ? "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50"
      : tone === "ok"
        ? "border-emerald-200 bg-emerald-50/90 dark:border-emerald-800 dark:bg-emerald-950/40"
        : tone === "over"
          ? "border-amber-200 bg-amber-50/90 dark:border-amber-800 dark:bg-amber-950/35"
          : "border-rose-200 bg-rose-50/90 dark:border-rose-800 dark:bg-rose-950/35";
  const diffClass =
    !hasFactura
      ? "text-slate-500"
      : tone === "ok"
        ? "text-emerald-800 dark:text-emerald-200"
        : tone === "over"
          ? "text-amber-900 dark:text-amber-200"
          : "text-rose-800 dark:text-rose-200";
  const label =
    !hasFactura
      ? "Sin dato de factura"
      : tone === "ok"
        ? "Coincide"
        : tone === "over"
          ? "Sobra (más que factura)"
          : "Falta (menos que factura)";

  return (
    <div className={`rounded-2xl border px-3 py-3 ${wrap}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        {icon}
        {title}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[9px] font-semibold uppercase text-slate-500">Factura</p>
          <p className="text-sm font-black tabular-nums text-slate-800 dark:text-slate-100">
            {hasFactura ? Number(factura).toFixed(decimals) : "—"}
          </p>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase text-slate-500">Capturado</p>
          <p className="text-sm font-black tabular-nums text-[#16263F] dark:text-slate-100">
            {Number(capturado).toFixed(decimals)}
          </p>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase text-slate-500">Diferencia</p>
          <p className={`text-sm font-black tabular-nums ${diffClass}`}>
            {hasFactura ? formatSignedDiff(delta, decimals, unit) : "—"}
          </p>
        </div>
      </div>
      <p className={`mt-1.5 text-center text-[10px] font-semibold ${diffClass}`}>{label}</p>
    </div>
  );
}

export function ReekonSaveReviewSheet({
  open,
  onClose,
  onConfirm,
  measureRows,
  referenceMode,
  raLabel,
  declaredBultos,
  physicalBultos,
  expectedWeight,
  expectedCbm,
  capturedWeight,
  capturedCbm,
  isSaving,
}: ReekonSaveReviewSheetProps) {
  const palletized = referenceMode === "palletized";
  const hasFacturaWeight = expectedWeight > 0;
  const hasFacturaCbm = expectedCbm > 0;
  const weightDelta = roundMeasureNearest(capturedWeight - expectedWeight);
  const cbmDelta = roundMeasureNearest(capturedCbm - expectedCbm);
  const bultosDelta = physicalBultos - declaredBultos;

  const lineEntries = useMemo(() => {
    const seenPallets = new Set<number>();
    return measureRows.map((row, index) => {
      const p = palletOf(row);
      const isFirstInPallet = palletized ? !seenPallets.has(p) : true;
      if (palletized) seenPallets.add(p);
      const reemp = row.reempaque === true;
      const bultos = parseMeasureNumber(row.bultos);
      const weightPer = parseMeasureNumber(row.weight);
      const pesoTotal = lineWeightKg(row, referenceMode, isFirstInPallet);
      const cbm = cubicajeM3FromRow(row);
      return {
        row,
        index,
        label: rowLabel(row, index, referenceMode, measureRows),
        reemp,
        bultos,
        weightPer,
        pesoTotal,
        cbm,
        isFirstInPallet,
        palletNum: p,
        l: strVal(row.l),
        w: strVal(row.w),
        h: strVal(row.h),
      };
    });
  }, [measureRows, referenceMode, palletized]);

  const computedCbm = useMemo(() => sumCubicajeM3(measureRows), [measureRows]);
  const displayCbm = capturedCbm > 0 ? capturedCbm : computedCbm;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10003] flex flex-col justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/55 backdrop-blur-[2px]"
        aria-label="Cerrar resumen"
        onClick={onClose}
        disabled={isSaving}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reekon-save-review-title"
        className="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">
              RA {raLabel || "—"}
            </p>
            <h2
              id="reekon-save-review-title"
              className="text-base font-black text-[#16263F] dark:text-slate-100 sm:text-lg"
            >
              Revisá antes de guardar
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Compará lo capturado con el peso y cubicaje de factura. Si hay
              diferencia, corregí o confirmá a conciencia.
            </p>
          </div>
        </div>

        <div className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <DiffKpiCard
              title="Peso (kg)"
              icon={<Scale className="h-3.5 w-3.5" />}
              factura={expectedWeight}
              capturado={capturedWeight}
              delta={weightDelta}
              tol={PESO_TOL_KG}
              decimals={2}
              unit="kg"
              hasFactura={hasFacturaWeight}
            />
            <DiffKpiCard
              title="Cubicaje (m³)"
              icon={<Box className="h-3.5 w-3.5" />}
              factura={expectedCbm}
              capturado={displayCbm}
              delta={hasFacturaCbm ? roundMeasureNearest(displayCbm - expectedCbm) : cbmDelta}
              tol={CBM_TOL_M3}
              decimals={2}
              unit="m³"
              hasFactura={hasFacturaCbm}
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/40">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-slate-500" />
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-500">Bultos</p>
                <p className="text-sm font-black tabular-nums text-[#16263F] dark:text-slate-100">
                  {physicalBultos}
                  <span className="font-semibold text-slate-400">
                    {" "}
                    / {declaredBultos > 0 ? declaredBultos : "—"}
                  </span>
                </p>
              </div>
            </div>
            <p
              className={`text-xs font-bold tabular-nums ${
                declaredBultos <= 0 || bultosDelta === 0
                  ? "text-emerald-700 dark:text-emerald-300"
                  : bultosDelta > 0
                    ? "text-amber-800 dark:text-amber-200"
                    : "text-rose-700 dark:text-rose-300"
              }`}
            >
              {declaredBultos <= 0
                ? "Sin declarado"
                : bultosDelta === 0
                  ? "OK"
                  : bultosDelta > 0
                    ? `+${bultosDelta} sobra`
                    : `${bultosDelta} falta`}
            </p>
          </div>

          <div>
            <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Inventario capturado ({lineEntries.length} líneas)
            </h3>
            <ul className="flex flex-col gap-1.5">
              {lineEntries.map((e) => (
                <li
                  key={e.row.id}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-bold text-slate-900 dark:text-slate-100">
                        {e.label}
                        {e.reemp ? (
                          <span className="ml-1.5 text-[10px] font-semibold text-slate-500">
                            Reempaque
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        L{e.index + 1}
                        {palletized ? ` · P${e.palletNum}` : ""}
                        {!e.reemp && e.bultos > 0
                          ? ` · ${e.bultos} bulto${e.bultos !== 1 ? "s" : ""}`
                          : ""}
                      </p>
                    </div>
                    {!e.reemp ? (
                      <div className="shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-600 dark:text-slate-300">
                        <p>{formatCubicaje2(e.cbm)} m³</p>
                        {e.pesoTotal > 0 ? (
                          <p className="text-slate-500">{formatMeasure2(e.pesoTotal)} kg</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {!e.reemp ? (
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                      {e.l || e.w || e.h ? (
                        <span>
                          Medidas:{" "}
                          <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                            {formatMeasure2(e.l) || "—"}×{formatMeasure2(e.w) || "—"}×
                            {formatMeasure2(e.h) || "—"}
                          </span>
                        </span>
                      ) : null}
                      {palletized && e.isFirstInPallet && parseMeasureNumber(e.row.palletWeight) > 0 ? (
                        <span>
                          Peso paleta:{" "}
                          <span className="font-semibold tabular-nums">
                            {formatMeasure2(e.row.palletWeight)} kg
                          </span>
                        </span>
                      ) : null}
                      {!palletized && e.weightPer > 0 ? (
                        <span>
                          Peso/bulto:{" "}
                          <span className="font-semibold tabular-nums">
                            {formatMeasure2(e.weightPer)} kg
                          </span>
                          {e.bultos > 0 ? (
                            <span className="text-slate-400">
                              {" "}
                              → total {formatMeasure2(e.pesoTotal)} kg
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-500">Sin peso ni medidas</p>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-[#16263F]/15 bg-[#16263F]/[0.04] px-3 py-2.5 dark:border-slate-600 dark:bg-slate-800/60">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-500">Totales</p>
                <p className="text-sm font-black tabular-nums text-[#16263F] dark:text-slate-100">
                  {formatMeasure2(capturedWeight)} kg · {formatCubicaje2(displayCbm)} m³
                </p>
              </div>
              {(hasFacturaWeight && Math.abs(weightDelta) > PESO_TOL_KG) ||
              (hasFacturaCbm && Math.abs(displayCbm - expectedCbm) > CBM_TOL_M3) ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                  Revisá diferencias
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                  <CheckCircle2 className="h-3 w-3" />
                  Listo
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900 sm:px-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 active:scale-[0.99] disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver a medir
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSaving}
            className="flex h-12 flex-[1.3] items-center justify-center gap-1.5 rounded-xl bg-blue-600 text-sm font-bold text-white shadow-sm active:scale-[0.99] disabled:opacity-60"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Confirmar y guardar
          </button>
        </div>
      </div>
    </div>
  );
}
