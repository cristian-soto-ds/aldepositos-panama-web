"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Loader2,
  SkipForward,
} from "lucide-react";
import { useReekonTapeInput } from "@/hooks/useReekonTapeInput";
import {
  isQuickRowComplete,
  type QuickMeasureRow,
  type ReferenceCaptureMode,
} from "@/lib/quickInventoryTypes";

export type ReekonAutosaveState = "idle" | "saving" | "saved" | "error";

export type ReekonCaptureViewProps = {
  measureRows: QuickMeasureRow[];
  referenceMode: ReferenceCaptureMode;
  activeRowId: string | null;
  onActiveRowChange: (id: string | null) => void;
  onUpdateRow: (id: string, field: keyof QuickMeasureRow, value: string) => void;
  onReferenceChange?: (id: string, value: string) => void;
  onReferenceBlur?: (id: string, value: string) => void;
  onAddRow?: () => void;
  raLabel: string;
  declaredBultos: number;
  physicalBultos: number;
  faltantes: number;
  totalCbm: string;
  totalWeight: number;
  completedCount: number;
  onBack: () => void;
  onSwitchToTable: () => void;
  onSave: () => void;
  autosaveState?: ReekonAutosaveState;
};

function valClass(val: string | number | undefined): string {
  const s = String(val ?? "").trim();
  return s ? "reekon-input-filled" : "";
}

function rowCbm(row: QuickMeasureRow): number {
  const l = parseFloat(String(row.l)) || 0;
  const w = parseFloat(String(row.w)) || 0;
  const h = parseFloat(String(row.h)) || 0;
  const b = parseFloat(String(row.bultos)) || 0;
  if (l <= 0 || w <= 0 || h <= 0 || b <= 0) return 0;
  return ((l * w * h) / 1_000_000) * b;
}

function dimsFilled(row: QuickMeasureRow): boolean {
  const l = parseFloat(String(row.l)) || 0;
  const w = parseFloat(String(row.w)) || 0;
  const h = parseFloat(String(row.h)) || 0;
  return l > 0 && w > 0 && h > 0;
}

function useImmersiveShell() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const html = document.documentElement;
    html.classList.add("reekon-immersive-active");
    document.body.classList.add("reekon-immersive-active");

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const prevTheme = themeMeta?.getAttribute("content") ?? "";
    themeMeta?.setAttribute("content", "#16263F");

    const hideBrowserChrome = () => {
      window.scrollTo(0, 1);
      requestAnimationFrame(() => window.scrollTo(0, 0));
    };
    hideBrowserChrome();
    window.addEventListener("orientationchange", hideBrowserChrome);

    return () => {
      html.classList.remove("reekon-immersive-active");
      document.body.classList.remove("reekon-immersive-active");
      if (prevTheme) themeMeta?.setAttribute("content", prevTheme);
      window.removeEventListener("orientationchange", hideBrowserChrome);
    };
  }, []);

  return mounted;
}

export function ReekonCaptureView(props: ReekonCaptureViewProps) {
  const mounted = useImmersiveShell();
  if (!mounted) return null;
  return createPortal(<ReekonCaptureContent {...props} />, document.body);
}

function ReekonCaptureContent({
  measureRows,
  referenceMode,
  activeRowId,
  onActiveRowChange,
  onUpdateRow,
  onReferenceChange,
  onReferenceBlur,
  onAddRow,
  raLabel,
  declaredBultos,
  physicalBultos,
  faltantes,
  totalCbm,
  totalWeight,
  completedCount,
  onBack,
  onSwitchToTable,
  onSave,
  autosaveState = "idle",
}: ReekonCaptureViewProps) {
  const [refFilter, setRefFilter] = useState<"all" | "pending">("all");
  const formRef = useRef<HTMLDivElement | null>(null);
  const refStripRef = useRef<HTMLDivElement | null>(null);
  const { handleDimensionKeyDown, focusFirstDimension } = useReekonTapeInput();

  const activeIndex = measureRows.findIndex((r) => r.id === activeRowId);
  const activeRow = activeIndex >= 0 ? measureRows[activeIndex] : measureRows[0] ?? null;
  const firstPendingId = measureRows.find((r) => !isQuickRowComplete(r))?.id ?? null;

  const progressPct =
    declaredBultos > 0
      ? Math.min(100, Math.round((physicalBultos / declaredBultos) * 100))
      : completedCount > 0
        ? 100
        : 0;

  const liveCbm = activeRow ? rowCbm(activeRow) : 0;

  useEffect(() => {
    if (!activeRowId && firstPendingId) {
      onActiveRowChange(firstPendingId);
    } else if (activeRowId && !measureRows.some((r) => r.id === activeRowId)) {
      onActiveRowChange(firstPendingId ?? measureRows[0]?.id ?? null);
    }
  }, [activeRowId, firstPendingId, measureRows, onActiveRowChange]);

  useEffect(() => {
    if (!activeRowId) return;
    const t = setTimeout(() => focusFirstDimension(formRef.current), 200);
    return () => clearTimeout(t);
  }, [activeRowId, focusFirstDimension]);

  useEffect(() => {
    if (!activeRowId || !refStripRef.current) return;
    const chip = refStripRef.current.querySelector<HTMLElement>(
      `[data-ref-id="${activeRowId}"]`,
    );
    chip?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeRowId]);

  const advanceToNext = useCallback(
    (fromId: string) => {
      const idx = measureRows.findIndex((r) => r.id === fromId);
      for (let i = idx + 1; i < measureRows.length; i++) {
        if (!isQuickRowComplete(measureRows[i])) {
          onActiveRowChange(measureRows[i].id);
          return;
        }
      }
      if (faltantes > 0 && onAddRow) {
        onAddRow();
        return;
      }
      const anyPending = measureRows.find((r) => !isQuickRowComplete(r));
      if (anyPending) onActiveRowChange(anyPending.id);
    },
    [faltantes, measureRows, onActiveRowChange, onAddRow],
  );

  const goPrev = () => {
    if (activeIndex <= 0) return;
    onActiveRowChange(measureRows[activeIndex - 1].id);
  };

  const goNext = () => {
    if (activeIndex < 0 || activeIndex >= measureRows.length - 1) return;
    onActiveRowChange(measureRows[activeIndex + 1].id);
  };

  const jumpToNextPending = () => {
    const start = activeIndex >= 0 ? activeIndex + 1 : 0;
    for (let i = start; i < measureRows.length; i++) {
      if (!isQuickRowComplete(measureRows[i])) {
        onActiveRowChange(measureRows[i].id);
        return;
      }
    }
    for (let i = 0; i < start; i++) {
      if (!isQuickRowComplete(measureRows[i])) {
        onActiveRowChange(measureRows[i].id);
        return;
      }
    }
  };

  const chipLabel = (row: QuickMeasureRow, i: number) => {
    if (referenceMode === "without") return String(i + 1);
    const ref = String(row.referencia ?? "").trim();
    return ref || `#${i + 1}`;
  };

  const visibleRows =
    refFilter === "pending"
      ? measureRows
          .map((row, i) => ({ row, i }))
          .filter(({ row }) => !isQuickRowComplete(row))
      : measureRows.map((row, i) => ({ row, i }));

  const pendingCount = measureRows.filter((r) => !isQuickRowComplete(r)).length;

  const allDone =
    measureRows.length > 0 && measureRows.every((r) => isQuickRowComplete(r));

  const saveLabel = autosaveState === "saving" ? "Guardando…" : "Guardar recepción";

  if (!activeRow) {
    return (
      <div className="reekon-immersive flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-center text-sm text-slate-500">No hay líneas para capturar.</p>
        <button
          type="button"
          onClick={onAddRow}
          className="rounded-xl bg-[#16263F] px-6 py-3 text-sm font-bold text-white"
        >
          Agregar bulto
        </button>
      </div>
    );
  }

  const rowDone = isQuickRowComplete(activeRow);
  const refLabel = String(activeRow.referencia ?? "").trim();
  const title =
    referenceMode === "with"
      ? refLabel || `Línea ${activeIndex + 1}`
      : `Bulto ${activeIndex + 1}`;
  const refNeedsInput = referenceMode === "with" && !refLabel;

  return (
    <div className="reekon-immersive flex min-h-0 flex-col">
      {/* Header mínimo */}
      <header className="reekon-safe-top shrink-0 bg-[#16263F] text-white">
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 active:bg-white/20"
            aria-label="Salir"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight">RA-{raLabel}</p>
            <p className="text-[11px] font-medium text-white/75">
              {physicalBultos}/{declaredBultos} bultos · {totalCbm} m³
            </p>
          </div>
          <button
            type="button"
            onClick={onSwitchToTable}
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-white/10 px-2.5 text-[11px] font-bold active:bg-white/20"
          >
            <LayoutGrid className="h-4 w-4" />
            Tabla
          </button>
        </div>
        <div className="px-3 pb-2">
          <div className="h-1 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-emerald-400 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        <div className="reekon-header-stats grid grid-cols-3 gap-px border-t border-white/10 bg-white/5 text-center text-[11px]">
          <div className="py-1.5">
            <span className="text-white/60">Faltan </span>
            <span className={`font-black ${faltantes <= 0 ? "text-emerald-300" : "text-amber-300"}`}>
              {Math.max(0, faltantes)}
            </span>
          </div>
          <div className="py-1.5">
            <span className="text-white/60">Vol. </span>
            <span className="font-black">{totalCbm}</span>
            <span className="text-white/50"> m³</span>
          </div>
          <div className="py-1.5">
            <span className="text-white/60">Peso </span>
            <span className="font-black">{totalWeight.toFixed(0)}</span>
            <span className="text-white/50"> kg</span>
          </div>
        </div>
      </header>

      {/* Cuerpo — sin espacio vacío, todo junto */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-2 px-3 py-2">
            <button
              type="button"
              onClick={goPrev}
              disabled={activeIndex <= 0}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 disabled:opacity-25 dark:bg-slate-800 dark:text-slate-200"
              aria-label="Anterior"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {referenceMode === "with" ? "Referencia" : "Bulto"} {activeIndex + 1} de{" "}
                {measureRows.length}
              </p>
              <h1 className="truncate text-xl font-black text-[#16263F] dark:text-white">
                {title}
              </h1>
            </div>
            <button
              type="button"
              onClick={goNext}
              disabled={activeIndex >= measureRows.length - 1}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 disabled:opacity-25 dark:bg-slate-800 dark:text-slate-200"
              aria-label="Siguiente"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-1.5 dark:border-slate-800">
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setRefFilter("all")}
                className={`rounded-md px-2.5 py-1 text-[10px] font-bold ${
                  refFilter === "all"
                    ? "bg-white text-[#16263F] shadow-sm dark:bg-slate-900 dark:text-white"
                    : "text-slate-500"
                }`}
              >
                Todas ({measureRows.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setRefFilter("pending");
                  const first = measureRows.find((r) => !isQuickRowComplete(r));
                  if (first) onActiveRowChange(first.id);
                }}
                className={`rounded-md px-2.5 py-1 text-[10px] font-bold ${
                  refFilter === "pending"
                    ? "bg-white text-[#16263F] shadow-sm dark:bg-slate-900 dark:text-white"
                    : "text-slate-500"
                }`}
              >
                Pendientes ({pendingCount})
              </button>
            </div>
            {pendingCount > 0 && (
              <button
                type="button"
                onClick={jumpToNextPending}
                className="ml-auto inline-flex items-center gap-1 rounded-lg bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-900 active:bg-amber-200 dark:bg-amber-950/50 dark:text-amber-200"
              >
                <SkipForward className="h-3.5 w-3.5" />
                Sig. pendiente
              </button>
            )}
          </div>

          <div ref={refStripRef} className="reekon-ref-strip border-t border-slate-100 dark:border-slate-800">
            {visibleRows.map(({ row, i }) => {
              const done = isQuickRowComplete(row);
              const current = row.id === activeRow.id;
              const label = chipLabel(row, i);
              return (
                <button
                  key={row.id}
                  type="button"
                  data-ref-id={row.id}
                  onClick={() => onActiveRowChange(row.id)}
                  className={`reekon-ref-chip border ${
                    current
                      ? "border-[#16263F] bg-[#16263F] text-white shadow-md ring-2 ring-[#16263F]/20"
                      : done
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                  }`}
                >
                  {done ? <Check className="h-3 w-3 shrink-0" /> : null}
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {refNeedsInput && (
          <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
            <input
              type="text"
              value={activeRow.referencia ?? ""}
              onChange={(e) => onReferenceChange?.(activeRow.id, e.target.value)}
              onBlur={(e) => onReferenceBlur?.(activeRow.id, e.target.value)}
              className="w-full rounded-xl border-2 border-[#16263F]/30 bg-white px-3 py-3 text-center text-lg font-bold text-[#16263F] outline-none focus:border-[#16263F] dark:bg-slate-950 dark:text-white"
              placeholder="Escribe la referencia"
            />
          </div>
        )}

        {/* Strip: bultos · peso · cubicaje línea */}
        <div className="grid shrink-0 grid-cols-3 gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/80">
          <label className="flex flex-col">
            <span className="mb-0.5 text-center text-[10px] font-bold text-slate-500">Bultos</span>
            <input
              type="number"
              inputMode="numeric"
              value={activeRow.bultos ?? ""}
              onChange={(e) => onUpdateRow(activeRow.id, "bultos", e.target.value)}
              className="no-spinners rounded-lg border-2 border-blue-300 bg-blue-50 py-2 text-center text-xl font-black text-blue-900 dark:border-blue-700 dark:bg-blue-950/50 dark:text-blue-100"
              placeholder="1"
            />
          </label>
          <label className="flex flex-col">
            <span className="mb-0.5 text-center text-[10px] font-bold text-slate-500">Kg/bulto</span>
            <input
              type="number"
              inputMode="decimal"
              value={activeRow.weight ?? ""}
              onChange={(e) => onUpdateRow(activeRow.id, "weight", e.target.value)}
              className="no-spinners rounded-lg border border-slate-300 bg-white py-2 text-center text-xl font-bold text-[#16263F] dark:border-slate-600 dark:bg-slate-950 dark:text-white"
              placeholder="—"
            />
          </label>
          <div className="flex flex-col rounded-lg border border-slate-200 bg-white py-1 dark:border-slate-600 dark:bg-slate-800">
            <span className="text-center text-[10px] font-bold text-slate-500">m³ línea</span>
            <p className="flex flex-1 items-center justify-center text-xl font-black tabular-nums text-[#16263F] dark:text-white">
              {liveCbm > 0 ? liveCbm.toFixed(2) : "—"}
            </p>
          </div>
        </div>

        {/* Medidas — altura fija, no estirar */}
        <section ref={formRef} className="shrink-0 px-3 py-2">
          <p className="mb-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Medición (cm)
          </p>
          <div className="reekon-measure-grid">
            {(
              [
                { field: "l" as const, label: "Largo", short: "L" },
                { field: "w" as const, label: "Ancho", short: "A" },
                { field: "h" as const, label: "Alto", short: "H" },
              ] as const
            ).map(({ field, label, short }, dimIdx) => (
              <div key={field} className="reekon-measure-cell">
                <span className="mb-0.5 block text-center text-[10px] font-bold text-slate-600 dark:text-slate-300">
                  {label}
                </span>
                <div className="relative">
                  <span className="pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2 text-xs font-black text-slate-300">
                    {short}
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    enterKeyHint={dimIdx < 2 ? "next" : "done"}
                    data-reekon-field={field}
                    value={activeRow[field] ?? ""}
                    onChange={(e) =>
                      onUpdateRow(activeRow.id, field, e.target.value)
                    }
                    onKeyDown={(e) =>
                      handleDimensionKeyDown(e, field, formRef.current)
                    }
                    className={`no-spinners reekon-input reekon-input-immersive ${valClass(activeRow[field])}`}
                    placeholder="—"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {dimsFilled(activeRow) && (
          <div className="flex shrink-0 items-center justify-center gap-1.5 bg-emerald-50 py-1.5 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-xs font-bold">Medidas listas — completa peso y toca Siguiente</span>
          </div>
        )}
      </main>

      <footer className="reekon-safe-bottom shrink-0 border-t border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
        {allDone ? (
          <button
            type="button"
            onClick={onSave}
            disabled={autosaveState === "saving"}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-base font-bold text-white active:scale-[0.99] disabled:opacity-70"
          >
            {autosaveState === "saving" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-5 w-5" />
            )}
            {saveLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (dimsFilled(activeRow) || rowDone) advanceToNext(activeRow.id);
              else focusFirstDimension(formRef.current);
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#16263F] py-3.5 text-base font-bold text-white active:scale-[0.99]"
          >
            {dimsFilled(activeRow) || rowDone ? "Siguiente →" : "Medir Largo"}
          </button>
        )}
      </footer>
    </div>
  );
}
