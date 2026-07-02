"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import type { QuickMeasureRow } from "@/lib/quickInventoryTypes";
import { isQuickRowComplete } from "@/lib/quickInventoryTypes";
import { cubicajeM3FromDims, formatMeasure2, normalizeMeasureField } from "@/lib/measureDecimals";
import { useReekonTapeInput } from "@/hooks/useReekonTapeInput";

type ReekonField = "referencia" | "bultos" | "weight" | "l" | "w" | "h";

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

const FIELD_LABELS: Record<ReekonField, string> = {
  referencia: "Referencia",
  bultos: "Bultos",
  weight: "Peso (kg)",
  l: "Largo (cm)",
  w: "Ancho (cm)",
  h: "Alto (cm)",
};

function strVal(v: string | number | undefined): string {
  return String(v ?? "").trim();
}

function fieldPreview(row: QuickMeasureRow, field: ReekonField): string {
  switch (field) {
    case "referencia":
      return strVal(row.referencia) || "—";
    case "bultos":
      return strVal(row.bultos) || "—";
    case "weight":
      return strVal(row.weight) ? `${formatMeasure2(row.weight)} kg` : "—";
    case "l":
    case "w":
    case "h":
      return strVal(row[field]) ? `${formatMeasure2(row[field])} cm` : "—";
    default:
      return "—";
  }
}

function fieldFilled(row: QuickMeasureRow, field: ReekonField): boolean {
  switch (field) {
    case "referencia":
      return Boolean(strVal(row.referencia));
    case "bultos":
      return Boolean(strVal(row.bultos));
    case "weight":
      return Boolean(strVal(row.weight));
    case "l":
    case "w":
    case "h":
      return Boolean(strVal(row[field]));
    default:
      return false;
  }
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
  const inputRef = useRef<HTMLInputElement>(null);
  const { handleDimensionKeyDown } = useReekonTapeInput();

  const [editingField, setEditingField] = useState<ReekonField | null>(null);

  const activeIndex = useMemo(
    () => measureRows.findIndex((r) => r.id === activeRowId),
    [measureRows, activeRowId],
  );
  const activeRow = activeIndex >= 0 ? measureRows[activeIndex] : measureRows[0] ?? null;
  const activeId = activeRow?.id ?? null;

  const availableFields = useMemo((): ReekonField[] => {
    const base: ReekonField[] = referenceMode === "with" ? ["referencia", "bultos", "weight", "l", "w", "h"] : ["bultos", "weight", "l", "w", "h"];
    return base;
  }, [referenceMode]);

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
    if (!activeRowId && measureRows.length > 0) {
      onActiveRowChange(measureRows[0].id);
    }
  }, [activeRowId, measureRows, onActiveRowChange]);

  const selectRow = useCallback(
    (id: string) => {
      onActiveRowChange(id);
      setEditingField(null);
    },
    [onActiveRowChange],
  );

  const openField = useCallback((field: ReekonField) => {
    setEditingField(field);
  }, []);

  useEffect(() => {
    if (!editingField) return;
    const t = setTimeout(() => {
      inputRef.current?.focus();
      if (editingField !== "referencia") {
        inputRef.current?.select();
      }
    }, 80);
    return () => clearTimeout(t);
  }, [editingField, activeId]);

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
    setEditingField(null);
    if (nextId) onActiveRowChange(nextId);
  };

  const handleAddLine = () => {
    onAddRow();
    setEditingField(null);
  };

  const handleMeasureBlur = (field: "l" | "w" | "h") => {
    if (!activeId || !activeRow) return;
    const normalized = normalizeMeasureField(activeRow[field]);
    if (normalized !== activeRow[field]) {
      onUpdateRow(activeId, field, normalized);
    }
  };

  const handleWeightBlur = () => {
    if (!activeId || !activeRow) return;
    const normalized = normalizeMeasureField(activeRow.weight);
    if (normalized !== activeRow.weight) {
      onUpdateRow(activeId, "weight", normalized);
    }
  };

  const renderEditor = () => {
    if (!activeRow || !activeId || !editingField) return null;

    if (editingField === "referencia") {
      return (
        <input
          ref={inputRef}
          type="text"
          inputMode="text"
          autoComplete="off"
          className="reekon-input reekon-input-immersive w-full"
          value={activeRow.referencia}
          placeholder="Referencia"
          onChange={(e) => onReferenceChange(activeId, e.target.value)}
          onBlur={(e) => onReferenceBlur(activeId, e.target.value)}
        />
      );
    }

    if (editingField === "bultos") {
      return (
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          className="reekon-input reekon-input-immersive w-full text-center"
          value={String(activeRow.bultos ?? "")}
          placeholder="0"
          onChange={(e) => onUpdateRow(activeId, "bultos", e.target.value.replace(/\D/g, ""))}
        />
      );
    }

    if (editingField === "weight") {
      return (
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          className="reekon-input reekon-input-immersive w-full text-center"
          value={activeRow.weight}
          placeholder="0.00"
          onChange={(e) => onUpdateRow(activeId, "weight", e.target.value)}
          onBlur={handleWeightBlur}
        />
      );
    }

    const dim = editingField;
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        data-reekon-field={dim}
        className={`reekon-input reekon-input-immersive w-full text-center ${fieldFilled(activeRow, dim) ? "reekon-input-filled" : ""}`}
        value={activeRow[dim]}
        placeholder="0.00"
        onChange={(e) => onUpdateRow(activeId, dim, e.target.value)}
        onBlur={() => handleMeasureBlur(dim)}
        onKeyDown={(e) =>
          handleDimensionKeyDown(e, dim, formRef.current, () => {
            const order: ReekonField[] = ["l", "w", "h"];
            const i = order.indexOf(dim);
            if (i < 2) {
              openField(order[i + 1]);
            } else {
              setEditingField(null);
            }
          })
        }
      />
    );
  };

  const progressPct = measureRows.length ? Math.round((completedCount / measureRows.length) * 100) : 0;

  return (
    <div className="reekon-immersive text-slate-900 dark:text-slate-100">
      {/* Header compacto */}
      <header className="reekon-safe-top shrink-0 border-b border-slate-200/80 bg-white/95 px-3 py-2 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="flex items-center gap-2">
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
            onClick={onSwitchToTable}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100 dark:active:bg-slate-800"
            aria-label="Vista tabla"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </header>

      {/* Selector de líneas */}
      <div className="reekon-ref-strip shrink-0 border-b border-slate-100 dark:border-slate-800">
        {measureRows.map((row, i) => {
          const done = isQuickRowComplete(row);
          const isActive = row.id === activeId;
          const label =
            referenceMode === "with" && row.referencia?.trim()
              ? row.referencia.trim()
              : `#${i + 1}`;
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
          onClick={handleAddLine}
          className="reekon-ref-chip border border-dashed border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-300"
          aria-label="Nueva línea"
        >
          <Plus className="h-3.5 w-3.5" />
          Nueva
        </button>
      </div>

      {/* Navegación entre líneas */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-1.5 dark:border-slate-800">
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

      {/* Panel principal */}
      <main ref={formRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
        {activeRow ? (
          <>
            {editingField ? (
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setEditingField(null)}
                  className="self-start text-sm font-semibold text-blue-600 dark:text-blue-400"
                >
                  ← Elegir otro campo
                </button>
                <p className="text-center text-sm font-bold text-slate-600 dark:text-slate-300">
                  {FIELD_LABELS[editingField]}
                </p>
                {renderEditor()}
                {editingField === "l" || editingField === "w" || editingField === "h" ? (
                  <p className="text-center text-[11px] text-slate-400">Enter confirma y pasa al siguiente lado</p>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="mb-1 text-center text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Toca el campo que quieres llenar
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {availableFields.map((field) => {
                    const filled = fieldFilled(activeRow, field);
                    return (
                      <button
                        key={field}
                        type="button"
                        onClick={() => openField(field)}
                        className={`flex min-h-[4.25rem] flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition active:scale-[0.98] ${
                          filled
                            ? "border-emerald-300 bg-emerald-50/80 dark:border-emerald-700 dark:bg-emerald-950/30"
                            : "border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800/60"
                        }`}
                      >
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          {FIELD_LABELS[field].replace(/ \(.*\)/, "")}
                        </span>
                        <span
                          className={`mt-0.5 truncate text-sm font-bold ${filled ? "text-emerald-800 dark:text-emerald-200" : "text-slate-400"}`}
                        >
                          {fieldPreview(activeRow, field)}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {rowCbm > 0 ? (
                  <p className="mt-2 text-center text-xs text-slate-500">
                    Cubicaje línea: <span className="font-bold">{formatMeasure2(rowCbm)} m³</span>
                  </p>
                ) : null}
                {rowComplete ? (
                  <p className="text-center text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    Línea completa
                  </p>
                ) : null}
              </div>
            )}
          </>
        ) : (
          <p className="py-8 text-center text-sm text-slate-500">Agrega una línea para comenzar.</p>
        )}
      </main>

      {/* Footer */}
      <footer className="reekon-safe-bottom shrink-0 border-t border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleDeleteCurrent}
            disabled={measureRows.length <= 1}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-600 disabled:opacity-30 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400"
            aria-label="Eliminar línea"
          >
            <Trash2 className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={handleAddLine}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            <Plus className="h-4 w-4" />
            Línea
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="flex h-11 flex-[1.4] items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-bold text-white disabled:opacity-60"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar
          </button>
        </div>
      </footer>
    </div>
  );
}
