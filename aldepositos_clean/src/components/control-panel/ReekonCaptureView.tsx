"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import type { QuickMeasureRow } from "@/lib/quickInventoryTypes";
import { isQuickRowComplete } from "@/lib/quickInventoryTypes";
import { cubicajeM3FromDims, formatMeasure2, normalizeMeasureField } from "@/lib/measureDecimals";
import { useReekonTapeInput } from "@/hooks/useReekonTapeInput";

type DimField = "l" | "w" | "h";

type ReekonCaptureViewProps = {
  measureRows: QuickMeasureRow[];
  referenceMode: "with" | "without";
  activeRowId: string | null;
  onActiveRowChange: (id: string) => void;
  onUpdateRow: (id: string, field: keyof QuickMeasureRow, value: string | boolean | string[]) => void;
  onReferenceChange: (id: string, value: string) => void;
  onReferenceBlur: (id: string, value: string) => void;
  onAddRow: () => void;
  onDeleteRow: (id: string) => void;
  raLabel: string;
  declaredBultos: number;
  physicalBultos: number;
  faltantes: number;
  totalCbm: number;
  totalWeight: number;
  completedCount: number;
  onBack: () => void;
  onSwitchToTable: () => void;
  onSave: () => void;
  autosaveState: "idle" | "saving" | "saved" | "error";
  isSaving: boolean;
};

const DIM_ORDER: DimField[] = ["l", "w", "h"];
const DIM_LABELS: Record<DimField, string> = { l: "Largo", w: "Ancho", h: "Alto" };

function strVal(v: string | number | undefined): string {
  return String(v ?? "").trim();
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
  onDeleteRow,
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
  autosaveState,
  isSaving,
}: ReekonCaptureViewProps) {
  const formRef = useRef<HTMLDivElement>(null);
  const { handleDimensionKeyDown } = useReekonTapeInput();

  const [isFullscreen, setIsFullscreen] = useState(false);

  // Cuando saltamos de línea con la cinta, enfocamos el Largo de la nueva línea.
  const focusLargoOnNext = useRef(false);

  const activeIndex = useMemo(
    () => measureRows.findIndex((r) => r.id === activeRowId),
    [measureRows, activeRowId],
  );
  const activeRow = activeIndex >= 0 ? measureRows[activeIndex] : measureRows[0] ?? null;
  const activeId = activeRow?.id ?? null;

  const rowCbm = activeRow
    ? cubicajeM3FromDims(activeRow.l, activeRow.w, activeRow.h, activeRow.bultos, activeRow.reempaque)
    : 0;
  const rowComplete = activeRow ? isQuickRowComplete(activeRow) : false;

  useEffect(() => {
    document.documentElement.classList.add("reekon-immersive-active");
    document.body.classList.add("reekon-immersive-active");
    return () => {
      document.documentElement.classList.remove("reekon-immersive-active");
      document.body.classList.remove("reekon-immersive-active");
    };
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    onFs();
    // Al salir de la vista, abandonar pantalla completa si sigue activa.
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      /* Algunos navegadores móviles no lo permiten; se ignora. */
    }
  }, []);

  useEffect(() => {
    if (!activeRowId && measureRows.length > 0) {
      onActiveRowChange(measureRows[0].id);
    }
  }, [activeRowId, measureRows, onActiveRowChange]);

  const focusDim = useCallback((field: DimField) => {
    const el = formRef.current?.querySelector<HTMLInputElement>(
      `input[data-reekon-field="${field}"]`,
    );
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  // Tras cambiar de línea con la cinta, enfocar Largo automáticamente.
  useEffect(() => {
    if (!focusLargoOnNext.current) return;
    focusLargoOnNext.current = false;
    const t = setTimeout(() => focusDim("l"), 80);
    return () => clearTimeout(t);
  }, [activeId, focusDim]);

  const selectRow = useCallback((id: string) => onActiveRowChange(id), [onActiveRowChange]);

  const goPrev = () => {
    if (activeIndex > 0) selectRow(measureRows[activeIndex - 1].id);
  };
  const goNext = () => {
    if (activeIndex < measureRows.length - 1) selectRow(measureRows[activeIndex + 1].id);
  };

  const handleDeleteCurrent = () => {
    if (!activeId || measureRows.length <= 1) return;
    const idx = activeIndex;
    const nextId = measureRows[idx + 1]?.id ?? measureRows[idx - 1]?.id;
    onDeleteRow(activeId);
    if (nextId) onActiveRowChange(nextId);
  };

  const handleMeasureBlur = (field: DimField) => {
    if (!activeId || !activeRow) return;
    const normalized = normalizeMeasureField(activeRow[field]);
    if (normalized !== activeRow[field]) onUpdateRow(activeId, field, normalized);
  };

  const handleWeightBlur = () => {
    if (!activeId || !activeRow) return;
    const normalized = normalizeMeasureField(activeRow.weight);
    if (normalized !== activeRow.weight) onUpdateRow(activeId, "weight", normalized);
  };

  // Al terminar el Alto con la cinta: salta a la siguiente línea y enfoca su Largo.
  const finishMeasuresAndAdvance = () => {
    if (activeIndex < measureRows.length - 1) {
      focusLargoOnNext.current = true;
      onActiveRowChange(measureRows[activeIndex + 1].id);
    }
  };

  const progressPct = measureRows.length ? Math.round((completedCount / measureRows.length) * 100) : 0;

  return (
    <div className="reekon-immersive text-slate-900 dark:text-slate-100">
      {/* Header compacto */}
      <header className="reekon-safe-top shrink-0 border-b border-slate-200/80 bg-white/95 px-3 py-2 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="mx-auto flex w-full max-w-md items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 active:bg-slate-100 dark:text-slate-300 dark:active:bg-slate-800"
            aria-label="Volver"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{raLabel || "Inventario"}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {completedCount}/{measureRows.length} líneas · {physicalBultos}/{declaredBultos} bultos
              {faltantes > 0 ? ` · faltan ${faltantes}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100 dark:active:bg-slate-800"
            aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onSwitchToTable}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100 dark:active:bg-slate-800"
            aria-label="Vista tabla"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
        <div className="mx-auto mt-2 h-1 w-full max-w-md overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </header>

      {/* Selector de líneas */}
      <div className="reekon-ref-strip mx-auto w-full max-w-md shrink-0 border-b border-slate-100 dark:border-slate-800">
        {measureRows.map((row, i) => {
          const done = isQuickRowComplete(row);
          const isActive = row.id === activeId;
          const label =
            referenceMode === "with" && strVal(row.referencia) ? strVal(row.referencia) : `#${i + 1}`;
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => selectRow(row.id)}
              className={`reekon-ref-chip border ${
                isActive
                  ? "border-blue-500 bg-blue-50 text-blue-800 shadow-sm dark:border-blue-400 dark:bg-blue-950/50 dark:text-blue-200"
                  : done
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
                    : "border-slate-200 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {done ? <Check className="h-3 w-3 shrink-0" /> : null}
              <span className="max-w-[7rem] truncate">{label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onAddRow}
          className="reekon-ref-chip border border-dashed border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-300"
          aria-label="Nueva línea"
        >
          <Plus className="h-3.5 w-3.5" />
          Nueva
        </button>
      </div>

      {/* Navegación entre líneas */}
      <div className="mx-auto flex w-full max-w-md shrink-0 items-center justify-between border-b border-slate-100 px-3 py-1.5 dark:border-slate-800">
        <button
          type="button"
          onClick={goPrev}
          disabled={activeIndex <= 0}
          className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 disabled:opacity-30 dark:text-slate-400"
        >
          <ChevronLeft className="h-4 w-4" />
          Ant.
        </button>
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
          Línea {activeIndex + 1} de {measureRows.length}
        </span>
        <button
          type="button"
          onClick={goNext}
          disabled={activeIndex >= measureRows.length - 1}
          className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 disabled:opacity-30 dark:text-slate-400"
        >
          Sig.
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Panel principal: todos los campos editables directamente */}
      <main ref={formRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4">
        <div className="mx-auto w-full max-w-md">
          {!activeRow || !activeId ? (
            <p className="py-8 text-center text-sm text-slate-500">Agrega una línea para comenzar.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {referenceMode === "with" ? (
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Referencia
                  </label>
                  <input
                    type="text"
                    autoComplete="off"
                    className="reekon-input reekon-input-immersive w-full"
                    value={String(activeRow.referencia ?? "")}
                    placeholder="Referencia"
                    onChange={(e) => onReferenceChange(activeId, e.target.value)}
                    onBlur={(e) => onReferenceBlur(activeId, e.target.value)}
                  />
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Bultos
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    className="reekon-input reekon-input-immersive w-full text-center"
                    value={String(activeRow.bultos ?? "")}
                    placeholder="0"
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => onUpdateRow(activeId, "bultos", e.target.value.replace(/\D/g, ""))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Peso (kg)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="reekon-input reekon-input-immersive w-full text-center"
                    value={String(activeRow.weight ?? "")}
                    placeholder="0.00"
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => onUpdateRow(activeId, "weight", e.target.value)}
                    onBlur={handleWeightBlur}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Medidas con la cinta (Largo → Ancho → Alto)
                </label>
                <div className="reekon-measure-grid">
                  {DIM_ORDER.map((dim) => {
                    const filled = Boolean(strVal(activeRow[dim]));
                    return (
                      <div key={dim} className="reekon-measure-cell">
                        <span className="mb-1 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {DIM_LABELS[dim]}
                        </span>
                        <input
                          type="text"
                          inputMode="none"
                          data-reekon-field={dim}
                          className={`reekon-input reekon-input-immersive w-full text-center ${filled ? "reekon-input-filled" : ""}`}
                          value={String(activeRow[dim] ?? "")}
                          placeholder="0.00"
                          onFocus={(e) => e.currentTarget.select()}
                          onChange={(e) => onUpdateRow(activeId, dim, e.target.value)}
                          onBlur={() => handleMeasureBlur(dim)}
                          onKeyDown={(e) =>
                            handleDimensionKeyDown(e, dim, formRef.current, finishMeasuresAndAdvance)
                          }
                        />
                      </div>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-center text-[11px] text-slate-400">
                  Cada clic de la cinta escribe la medida y salta al siguiente lado. Tras el Alto pasa a la siguiente línea.
                </p>
              </div>

              <div className="flex items-center justify-center gap-3 text-xs">
                {rowCbm > 0 ? (
                  <span className="text-slate-500">
                    Cubicaje: <span className="font-bold">{formatMeasure2(rowCbm)} m³</span>
                  </span>
                ) : null}
                {rowComplete ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3.5 w-3.5" />
                    Línea completa
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="reekon-safe-bottom shrink-0 border-t border-slate-200 bg-white px-3 pt-2 pb-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Total {formatMeasure2(totalCbm)} m³</span>
            <span>{formatMeasure2(totalWeight)} kg</span>
            <span>
              {autosaveState === "saving" ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Guardando…
                </span>
              ) : autosaveState === "saved" ? (
                "Guardado"
              ) : autosaveState === "error" ? (
                "Error al guardar"
              ) : (
                "Borrador"
              )}
            </span>
          </div>
          <div className="flex items-stretch gap-2.5">
            <button
              type="button"
              onClick={handleDeleteCurrent}
              disabled={measureRows.length <= 1}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-red-200 bg-red-50 text-red-600 active:scale-95 disabled:opacity-30 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400"
              aria-label="Eliminar línea"
            >
              <Trash2 className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={onAddRow}
              className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-slate-50 text-base font-bold text-slate-700 active:scale-[0.98] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            >
              <Plus className="h-5 w-5" />
              Línea
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              className="flex h-14 flex-[1.5] items-center justify-center gap-2 rounded-2xl bg-blue-600 text-base font-bold text-white shadow-sm active:scale-[0.98] disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
              Guardar
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
