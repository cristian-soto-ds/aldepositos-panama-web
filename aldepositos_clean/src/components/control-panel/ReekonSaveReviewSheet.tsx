"use client";

import { useMemo, type ReactNode, type SyntheticEvent } from "react";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Save,
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
  if (Math.abs(delta) < 10 ** -decimals / 2) return `0 ${unit}`;
  const sign = delta > 0 ? "+" : "−";
  return `${sign}${abs} ${unit}`;
}

function DiffAlert({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "warn" | "ok";
}) {
  const wrap =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50/80 dark:border-emerald-800 dark:bg-emerald-950/30"
      : "border-amber-200 bg-amber-50/90 dark:border-amber-800 dark:bg-amber-950/35";
  const iconClass =
    tone === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-amber-700 dark:text-amber-300";

  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 ${wrap}`}>
      {tone === "ok" ? (
        <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} />
      ) : (
        <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} />
      )}
      <div className="min-w-0 text-sm leading-snug text-slate-800 dark:text-slate-100">
        {children}
      </div>
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
  const computedCbm = useMemo(() => sumCubicajeM3(measureRows), [measureRows]);
  const displayCbm = capturedCbm > 0 ? capturedCbm : computedCbm;
  const cbmDelta = roundMeasureNearest(displayCbm - expectedCbm);
  const bultosDelta = physicalBultos - declaredBultos;

  const weightDiff = hasFacturaWeight && Math.abs(weightDelta) > PESO_TOL_KG;
  const cbmDiff = hasFacturaCbm && Math.abs(cbmDelta) > CBM_TOL_M3;
  const bultosDiff = declaredBultos > 0 && bultosDelta !== 0;
  const hasAnyDiff = weightDiff || cbmDiff || bultosDiff;

  const lineEntries = useMemo(() => {
    const seenPallets = new Set<number>();
    return measureRows.map((row, index) => {
      const p = palletOf(row);
      const isFirstInPallet = palletized ? !seenPallets.has(p) : true;
      if (palletized) seenPallets.add(p);
      const reemp = row.reempaque === true;
      const pesoTotal = lineWeightKg(row, referenceMode, isFirstInPallet);
      const cbm = cubicajeM3FromRow(row);
      const l = strVal(row.l);
      const w = strVal(row.w);
      const h = strVal(row.h);
      const dims =
        l || w || h
          ? `${formatMeasure2(l) || "—"}×${formatMeasure2(w) || "—"}×${formatMeasure2(h) || "—"}`
          : null;
      return {
        row,
        label: rowLabel(row, index, referenceMode, measureRows),
        reemp,
        pesoTotal,
        cbm,
        dims,
      };
    });
  }, [measureRows, referenceMode, palletized]);

  const dismissWithoutSave = (e: SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isSaving) return;
    onClose();
  };

  const confirmSave = (e: SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isSaving) return;
    onConfirm();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10003] flex flex-col justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/55 backdrop-blur-[2px]"
        aria-label="Cerrar resumen"
        onPointerDown={(e) => e.preventDefault()}
        onClick={dismissWithoutSave}
        disabled={isSaving}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reekon-save-review-title"
        className="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="shrink-0 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">
            RA {raLabel || "—"}
          </p>
          <h2
            id="reekon-save-review-title"
            className="text-base font-black text-[#16263F] dark:text-slate-100"
          >
            Revisá antes de guardar
          </h2>
        </div>

        <div className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
          {hasAnyDiff ? (
            <div className="space-y-2">
              {weightDiff ? (
                <DiffAlert tone="warn">
                  <span className="font-bold">Peso:</span> capturaste{" "}
                  <span className="font-bold tabular-nums">{formatMeasure2(capturedWeight)} kg</span>
                  , factura{" "}
                  <span className="tabular-nums">{formatMeasure2(expectedWeight)} kg</span>
                  {" · "}
                  <span className="font-bold tabular-nums text-amber-900 dark:text-amber-200">
                    {formatSignedDiff(weightDelta, 2, "kg")}
                  </span>
                </DiffAlert>
              ) : null}
              {cbmDiff ? (
                <DiffAlert tone="warn">
                  <span className="font-bold">Cubicaje:</span> capturaste{" "}
                  <span className="font-bold tabular-nums">{formatCubicaje2(displayCbm)} m³</span>
                  , factura{" "}
                  <span className="tabular-nums">{formatCubicaje2(expectedCbm)} m³</span>
                  {" · "}
                  <span className="font-bold tabular-nums text-amber-900 dark:text-amber-200">
                    {formatSignedDiff(cbmDelta, 2, "m³")}
                  </span>
                </DiffAlert>
              ) : null}
              {bultosDiff ? (
                <DiffAlert tone="warn">
                  <span className="font-bold">Bultos:</span> capturaste{" "}
                  <span className="font-bold tabular-nums">{physicalBultos}</span>, declarados{" "}
                  <span className="tabular-nums">{declaredBultos}</span>
                  {" · "}
                  <span className="font-bold tabular-nums text-amber-900 dark:text-amber-200">
                    {bultosDelta > 0 ? `+${bultosDelta}` : bultosDelta}
                  </span>
                </DiffAlert>
              ) : null}
            </div>
          ) : (
            <DiffAlert tone="ok">
              {hasFacturaWeight || hasFacturaCbm || declaredBultos > 0
                ? "Coincide con la factura."
                : "Sin datos de factura para comparar."}
            </DiffAlert>
          )}

          <div>
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {lineEntries.length} línea{lineEntries.length !== 1 ? "s" : ""}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {lineEntries.map((e) => (
                <li
                  key={e.row.id}
                  className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/40"
                >
                  {e.reemp ? (
                    <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                      {e.label}
                      <span className="ml-1.5 text-xs font-normal text-slate-400">reempaque</span>
                    </p>
                  ) : (
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="shrink-0 text-sm font-bold text-slate-900 dark:text-slate-100">
                        {e.label}
                      </p>
                      <p className="min-w-0 text-right text-sm tabular-nums text-slate-700 dark:text-slate-200">
                        {e.dims ? (
                          <span>{e.dims}</span>
                        ) : (
                          <span className="text-slate-400">sin medidas</span>
                        )}
                        {e.pesoTotal > 0 ? (
                          <span className="text-slate-500">
                            {" · "}
                            {formatMeasure2(e.pesoTotal)} kg
                          </span>
                        ) : null}
                        {e.cbm > 0 ? (
                          <span className="text-slate-400">
                            {" · "}
                            {formatCubicaje2(e.cbm)} m³
                          </span>
                        ) : null}
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={dismissWithoutSave}
            disabled={isSaving}
            className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 active:scale-[0.99] disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver a medir
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={confirmSave}
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
