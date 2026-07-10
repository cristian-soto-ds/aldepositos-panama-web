"use client";

import { useMemo, useState } from "react";
import { Check, Circle, List, Recycle, X } from "lucide-react";
import {
  getQuickRowMissingFields,
  isQuickRowComplete,
  QUICK_ROW_MISSING_LABELS,
  type QuickMeasureRow,
  type ReferenceCaptureMode,
} from "@/lib/quickInventoryTypes";

type FilterId = "all" | "pending" | "done";

type ReekonReferenceListSheetProps = {
  open: boolean;
  onClose: () => void;
  measureRows: QuickMeasureRow[];
  referenceMode: ReferenceCaptureMode;
  activeRowId: string | null;
  onSelectRow: (id: string) => void;
  completedCount: number;
  faltantes: number;
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
    const subIdx = measureRows.slice(0, index + 1).filter((r) => palletOf(r) === pnum).length;
    return `P${pnum}-${subIdx}`;
  }
  if (referenceMode === "with" && strVal(row.referencia)) {
    return strVal(row.referencia);
  }
  return `#${index + 1}`;
}

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "pending", label: "Pendientes" },
  { id: "done", label: "Completas" },
];

export function ReekonReferenceListSheet({
  open,
  onClose,
  measureRows,
  referenceMode,
  activeRowId,
  onSelectRow,
  completedCount,
  faltantes,
}: ReekonReferenceListSheetProps) {
  const [filter, setFilter] = useState<FilterId>("all");
  const palletized = referenceMode === "palletized";

  const entries = useMemo(() => {
    return measureRows.map((row, index) => {
      const done = isQuickRowComplete(row);
      const reemp = row.reempaque === true;
      const missing = getQuickRowMissingFields(row);
      return {
        row,
        index,
        done,
        reemp,
        missing,
        label: rowLabel(row, index, referenceMode, measureRows),
      };
    });
  }, [measureRows, referenceMode]);

  const filtered = useMemo(() => {
    if (filter === "pending") return entries.filter((e) => !e.done);
    if (filter === "done") return entries.filter((e) => e.done);
    return entries;
  }, [entries, filter]);

  const pendingCount = measureRows.length - completedCount;

  if (!open) return null;

  const handleSelect = (id: string) => {
    onSelectRow(id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[10002] flex flex-col justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
        aria-label="Cerrar lista"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reekon-ref-list-title"
        className="relative flex max-h-[min(88vh,720px)] flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <List className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
              <h2 id="reekon-ref-list-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
                Todas las referencias
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {completedCount} completas · {pendingCount} pendientes
              {faltantes > 0 ? ` · faltan ${faltantes} bultos en total` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100 dark:active:bg-slate-800"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex shrink-0 gap-1.5 overflow-x-auto px-4 py-2.5">
          {FILTERS.map((f) => {
            const count =
              f.id === "all"
                ? entries.length
                : f.id === "pending"
                  ? pendingCount
                  : completedCount;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                  filter === f.id
                    ? "bg-[#16263F] text-white"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {f.label} ({count})
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              No hay líneas en este filtro.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 py-1">
              {filtered.map(({ row, index, done, reemp, missing, label }) => {
                const isActive = row.id === activeRowId;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(row.id)}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition active:scale-[0.99] ${
                        isActive
                          ? "border-blue-500 bg-blue-50 shadow-sm dark:border-blue-400 dark:bg-blue-950/40"
                          : done
                            ? "border-emerald-200 bg-emerald-50/80 dark:border-emerald-800 dark:bg-emerald-950/30"
                            : reemp
                              ? "border-violet-200 bg-violet-50/80 dark:border-violet-800 dark:bg-violet-950/30"
                              : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/60"
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                            reemp
                              ? "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300"
                              : done
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                          }`}
                        >
                          {reemp ? (
                            <Recycle className="h-3.5 w-3.5" />
                          ) : done ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <Circle className="h-3.5 w-3.5" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                              {label}
                            </span>
                            <span className="text-[11px] font-medium text-slate-400">
                              Línea {index + 1}
                            </span>
                            {palletized ? (
                              <span className="text-[11px] font-semibold text-violet-600 dark:text-violet-400">
                                Paleta {palletOf(row)}
                              </span>
                            ) : null}
                          </div>
                          {referenceMode === "with" && strVal(row.referencia) && label !== strVal(row.referencia) ? (
                            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                              Ref: {strVal(row.referencia)}
                            </p>
                          ) : null}
                          {reemp ? (
                            <p className="mt-1 text-xs font-medium text-violet-600 dark:text-violet-400">
                              Reempaque — no requiere medidas
                            </p>
                          ) : done ? (
                            <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                              Captura completa
                            </p>
                          ) : missing.length > 0 ? (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                                Falta:
                              </span>
                              {missing.map((field) => (
                                <span
                                  key={field}
                                  className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                                >
                                  {QUICK_ROW_MISSING_LABELS[field]}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {!reemp && strVal(row.bultos) ? (
                            <p className="mt-1 text-[11px] text-slate-400">
                              {strVal(row.bultos)} bulto{Number(row.bultos) !== 1 ? "s" : ""}
                              {strVal(row.l) && strVal(row.w) && strVal(row.h)
                                ? ` · ${strVal(row.l)}×${strVal(row.w)}×${strVal(row.h)}`
                                : ""}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
