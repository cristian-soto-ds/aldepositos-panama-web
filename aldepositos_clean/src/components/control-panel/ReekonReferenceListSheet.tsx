"use client";

import { useMemo, useState } from "react";
import { Check, Circle, List, Recycle, X } from "lucide-react";
import {
  isQuickRowComplete,
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

function rowSummary(row: QuickMeasureRow, reemp: boolean): string {
  if (reemp) {
    const refCont = strVal(row.referenciaContenedora);
    return refCont ? `Reempaque · cont: ${refCont}` : "Reempaque";
  }

  const parts: string[] = [];
  const bultos = strVal(row.bultos);
  if (bultos) {
    parts.push(`${bultos} bulto${Number(row.bultos) !== 1 ? "s" : ""}`);
  }

  const l = strVal(row.l);
  const w = strVal(row.w);
  const h = strVal(row.h);
  if (l || w || h) {
    parts.push(`${l || "—"}×${w || "—"}×${h || "—"}`);
  }

  const weight = strVal(row.weight) || strVal(row.pesoPorBulto);
  if (weight) parts.push(`${weight} kg`);

  const desc = strVal(row.descripcion);
  if (desc) {
    parts.push(desc.length > 28 ? `${desc.slice(0, 28)}…` : desc);
  }

  return parts.join(" · ") || "Pendiente de captura";
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
      return {
        row,
        index,
        done,
        reemp,
        label: rowLabel(row, index, referenceMode, measureRows),
        summary: rowSummary(row, reemp),
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
        className="relative flex max-h-[min(92vh,820px)] flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800 sm:px-4 sm:py-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <List className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
              <h2
                id="reekon-ref-list-title"
                className="text-sm font-bold text-slate-900 dark:text-slate-100 sm:text-base"
              >
                Todas las referencias
              </h2>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {completedCount} completas · {pendingCount} pendientes
              {faltantes > 0 ? ` · faltan ${faltantes} bultos` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100 dark:active:bg-slate-800"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex shrink-0 gap-1 overflow-x-auto px-3 py-1.5 sm:px-4 sm:py-2">
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
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold transition sm:px-3 sm:py-1.5 sm:text-xs ${
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

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-3">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No hay líneas en este filtro.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 py-0.5">
              {filtered.map(({ row, index, done, reemp, label, summary }) => {
                const isActive = row.id === activeRowId;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(row.id)}
                      className={`w-full rounded-lg border px-2.5 py-2 text-left transition active:scale-[0.99] sm:px-3 ${
                        isActive
                          ? "border-blue-500 bg-blue-50 shadow-sm dark:border-blue-400 dark:bg-blue-950/40"
                          : done
                            ? "border-emerald-200/80 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/25"
                            : reemp
                              ? "border-violet-200/80 bg-violet-50/60 dark:border-violet-800 dark:bg-violet-950/25"
                              : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/60"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                            reemp
                              ? "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300"
                              : done
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                          }`}
                        >
                          {reemp ? (
                            <Recycle className="h-3 w-3" />
                          ) : done ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Circle className="h-3 w-3" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[13px] font-bold leading-tight text-slate-900 dark:text-slate-100">
                              {label}
                            </span>
                            <span className="shrink-0 text-[10px] font-semibold tabular-nums text-slate-400">
                              L{index + 1}
                              {palletized ? ` · P${palletOf(row)}` : ""}
                            </span>
                          </div>
                          <p className="truncate text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                            {summary}
                          </p>
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
