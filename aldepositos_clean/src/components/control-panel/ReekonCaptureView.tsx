"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Loader2,
  Zap,
} from "lucide-react";
import { useReekonTapeInput } from "@/hooks/useReekonTapeInput";
import {
  formatRowLabel,
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

export function ReekonCaptureView({
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
  const [justCompleted, setJustCompleted] = useState(false);
  const formRef = useRef<HTMLDivElement | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { handleDimensionKeyDown, focusFirstDimension, vibrate, flashInput } =
    useReekonTapeInput();

  const activeIndex = measureRows.findIndex((r) => r.id === activeRowId);
  const activeRow = activeIndex >= 0 ? measureRows[activeIndex] : measureRows[0] ?? null;

  const firstPendingId =
    measureRows.find((r) => !isQuickRowComplete(r))?.id ?? null;

  const progressPct =
    declaredBultos > 0
      ? Math.min(100, Math.round((physicalBultos / declaredBultos) * 100))
      : completedCount > 0
        ? 100
        : 0;

  const liveCbm = activeRow ? rowCbm(activeRow) : 0;

  useEffect(() => {
    document.body.classList.add("reekon-immersive-active");
    return () => document.body.classList.remove("reekon-immersive-active");
  }, []);

  useEffect(() => {
    if (!activeRowId && firstPendingId) {
      onActiveRowChange(firstPendingId);
    } else if (activeRowId && !measureRows.some((r) => r.id === activeRowId)) {
      onActiveRowChange(firstPendingId ?? measureRows[0]?.id ?? null);
    }
  }, [activeRowId, firstPendingId, measureRows, onActiveRowChange]);

  useEffect(() => {
    if (!activeRowId) return;
    const t = setTimeout(() => focusFirstDimension(formRef.current), 150);
    return () => clearTimeout(t);
  }, [activeRowId, focusFirstDimension]);

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    };
  }, []);

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
      if (anyPending) {
        onActiveRowChange(anyPending.id);
      }
    },
    [faltantes, measureRows, onActiveRowChange, onAddRow],
  );

  const completeAndAdvance = useCallback(
    (rowId: string) => {
      vibrate();
      setJustCompleted(true);
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = setTimeout(() => {
        setJustCompleted(false);
        advanceToNext(rowId);
      }, 450);
    },
    [advanceToNext, vibrate],
  );

  const tryAutoAdvance = useCallback(
    (row: QuickMeasureRow, el: HTMLInputElement) => {
      let b = parseFloat(String(row.bultos)) || 0;
      if (b <= 0) {
        onUpdateRow(row.id, "bultos", "1");
        b = 1;
      }
      const checkRow = { ...row, bultos: String(b) };
      if (!dimsFilled(checkRow) || !isQuickRowComplete(checkRow)) return;
      flashInput(el);
      completeAndAdvance(row.id);
    },
    [completeAndAdvance, flashInput, onUpdateRow],
  );

  const goPrev = () => {
    if (activeIndex <= 0) return;
    onActiveRowChange(measureRows[activeIndex - 1].id);
  };

  const goNext = () => {
    if (activeIndex < 0 || activeIndex >= measureRows.length - 1) return;
    onActiveRowChange(measureRows[activeIndex + 1].id);
  };

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
  const title =
    referenceMode === "with"
      ? String(activeRow.referencia ?? "").trim() || `Línea ${activeIndex + 1}`
      : `Bulto ${activeIndex + 1}`;

  return (
    <div className="reekon-immersive flex min-h-0 flex-col">
      {/* Header compacto */}
      <header className="reekon-safe-top shrink-0 border-b border-slate-200/80 bg-[#16263F] text-white dark:border-slate-700">
        <div className="flex items-center justify-between gap-2 px-3 py-2 sm:px-4">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-white/90 hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden xs:inline">Salir</span>
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-sm font-bold tracking-tight">RA-{raLabel}</p>
            <p className="text-[10px] font-medium text-white/70">
              {completedCount}/{measureRows.length} líneas · {physicalBultos}/{declaredBultos} bultos
            </p>
          </div>
          <button
            type="button"
            onClick={onSwitchToTable}
            className="flex items-center gap-1 rounded-lg border border-white/20 px-2 py-1.5 text-[10px] font-bold text-white/90 hover:bg-white/10"
            title="Vista tabla"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Tabla</span>
          </button>
        </div>
        <div className="px-3 pb-2 sm:px-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-emerald-400 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1 border-t border-white/10 px-3 py-2 text-center sm:px-4">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-wide text-white/60">
              Faltan
            </p>
            <p
              className={`text-base font-black tabular-nums leading-tight ${faltantes <= 0 ? "text-emerald-300" : "text-amber-300"}`}
            >
              {Math.max(0, faltantes)}
            </p>
          </div>
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-wide text-white/60">
              Vol. total
            </p>
            <p className="text-base font-black tabular-nums leading-tight">{totalCbm}</p>
            <p className="text-[9px] text-white/50">m³</p>
          </div>
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-wide text-white/60">
              Peso
            </p>
            <p className="text-base font-black tabular-nums leading-tight">
              {totalWeight.toFixed(1)}
            </p>
            <p className="text-[9px] text-white/50">kg</p>
          </div>
        </div>
      </header>

      {/* Contenido principal — adaptable portrait / landscape */}
      <main
        className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${
          justCompleted ? "reekon-complete-pulse" : ""
        }`}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto landscape:flex-row landscape:overflow-hidden">
          {/* Panel izquierdo / superior: contexto */}
          <section className="shrink-0 border-b border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80 landscape:w-[38%] landscape:min-w-[200px] landscape:max-w-[320px] landscape:border-b-0 landscape:border-r landscape:overflow-y-auto">
            <div className="mb-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={goPrev}
                disabled={activeIndex <= 0}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 disabled:opacity-30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                aria-label="Anterior"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1 text-center">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {referenceMode === "with" ? "Referencia" : "Bulto"} {activeIndex + 1} de{" "}
                  {measureRows.length}
                </p>
                <h1 className="truncate text-xl font-black text-[#16263F] dark:text-slate-100 sm:text-2xl">
                  {title}
                </h1>
              </div>
              <button
                type="button"
                onClick={goNext}
                disabled={activeIndex >= measureRows.length - 1}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 disabled:opacity-30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                aria-label="Siguiente"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            {referenceMode === "with" && (
              <input
                type="text"
                value={activeRow.referencia ?? ""}
                onChange={(e) => onReferenceChange?.(activeRow.id, e.target.value)}
                onBlur={(e) => onReferenceBlur?.(activeRow.id, e.target.value)}
                className="mb-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-center text-sm font-bold text-[#16263F] outline-none focus:border-[#16263F] focus:ring-2 focus:ring-[#16263F]/15 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                placeholder="Código de referencia"
              />
            )}

            <div className="mb-3 grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-center text-[10px] font-bold text-slate-500">
                  Bultos
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={activeRow.bultos ?? ""}
                  onChange={(e) => onUpdateRow(activeRow.id, "bultos", e.target.value)}
                  className="no-spinners w-full rounded-xl border-2 border-blue-200 bg-blue-50 py-2.5 text-center text-lg font-black text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200"
                  placeholder="1"
                />
              </div>
              <div>
                <label className="mb-1 block text-center text-[10px] font-bold text-slate-500">
                  Peso/bulto
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={activeRow.weight ?? ""}
                  onChange={(e) => onUpdateRow(activeRow.id, "weight", e.target.value)}
                  className="no-spinners w-full rounded-xl border border-slate-300 bg-white py-2.5 text-center text-lg font-bold text-[#16263F] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                  placeholder="kg"
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3 text-center dark:border-slate-600 dark:bg-slate-800">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                Cubicaje esta línea
              </p>
              <p className="mt-0.5 text-2xl font-black tabular-nums text-[#16263F] dark:text-slate-100">
                {liveCbm > 0 ? liveCbm.toFixed(3) : "—"}
              </p>
              <p className="text-[10px] text-slate-400">m³</p>
            </div>

            {rowDone && (
              <div className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-emerald-100 py-2 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-xs font-bold">Línea completa</span>
              </div>
            )}

            {/* Mini mapa de progreso */}
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {measureRows.map((row, i) => {
                const done = isQuickRowComplete(row);
                const current = row.id === activeRow.id;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => onActiveRowChange(row.id)}
                    className={`h-2.5 w-2.5 rounded-full transition-all ${
                      current
                        ? "scale-125 ring-2 ring-[#16263F] ring-offset-1 dark:ring-blue-400"
                        : ""
                    } ${done ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`}
                    title={formatRowLabel(i, row, referenceMode)}
                    aria-label={`Línea ${i + 1}${done ? ", completa" : ", pendiente"}`}
                  />
                );
              })}
            </div>
          </section>

          {/* Panel medición */}
          <section
            ref={formRef}
            className="flex min-h-0 flex-1 flex-col justify-center p-4 landscape:overflow-y-auto sm:p-6"
          >
            <p className="mb-3 flex items-center justify-center gap-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-[#16263F] dark:text-blue-300">
              <Zap className="h-3.5 w-3.5" />
              Medición cm — L × A × H
            </p>

            <div className="grid grid-cols-3 gap-2 sm:gap-3 landscape:gap-4">
              {(
                [
                  { field: "l" as const, label: "Largo", short: "L" },
                  { field: "w" as const, label: "Ancho", short: "W" },
                  { field: "h" as const, label: "Alto", short: "H" },
                ] as const
              ).map(({ field, label, short }, dimIdx) => (
                <div key={field} className="flex flex-col">
                  <span className="mb-1 text-center text-[10px] font-bold text-slate-500 sm:text-xs">
                    {label}
                  </span>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2 top-2 text-xs font-black text-slate-300">
                      {short}
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      data-reekon-field={field}
                      value={activeRow[field] ?? ""}
                      onChange={(e) => {
                        onUpdateRow(activeRow.id, field, e.target.value);
                        const nextRow = { ...activeRow, [field]: e.target.value };
                        if (field === "h" && e.target.value.trim()) {
                          setTimeout(() => {
                            tryAutoAdvance(nextRow, e.target);
                          }, 120);
                        }
                      }}
                      onKeyDown={(e) =>
                        handleDimensionKeyDown(
                          e,
                          field,
                          formRef.current,
                          dimIdx === 2
                            ? () => {
                                const current =
                                  measureRows.find((r) => r.id === activeRow.id) ??
                                  activeRow;
                                let b = parseFloat(String(current.bultos)) || 0;
                                if (b <= 0) {
                                  onUpdateRow(current.id, "bultos", "1");
                                  b = 1;
                                }
                                const check = { ...current, bultos: String(b) };
                                if (isQuickRowComplete(check)) {
                                  completeAndAdvance(current.id);
                                }
                              }
                            : undefined,
                        )
                      }
                      className={`no-spinners reekon-input reekon-input-immersive w-full ${valClass(activeRow[field])}`}
                      placeholder="—"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      {/* Footer fijo */}
      <footer className="reekon-safe-bottom shrink-0 border-t border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 sm:p-4">
        {allDone ? (
          <button
            type="button"
            onClick={onSave}
            disabled={autosaveState === "saving"}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-4 text-sm font-bold text-white shadow-lg active:scale-[0.99] disabled:opacity-70"
          >
            {autosaveState === "saving" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-5 w-5" />
            )}
            {saveLabel} — recepción completa
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (rowDone) advanceToNext(activeRow.id);
              else focusFirstDimension(formRef.current);
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#16263F] py-4 text-sm font-bold text-white shadow-lg active:scale-[0.99]"
          >
            {rowDone ? "Siguiente bulto →" : "Enfocar medición"}
          </button>
        )}
      </footer>
    </div>
  );
}
