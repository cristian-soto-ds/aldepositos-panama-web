"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Circle, List, Recycle, Search, X } from "lucide-react";
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
  /** Filtro inicial al abrir (por defecto pendientes). */
  initialFilter?: FilterId;
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
    parts.push(desc.length > 40 ? `${desc.slice(0, 40)}…` : desc);
  }

  return parts.join(" · ") || "Pendiente de captura";
}

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "pending", label: "Pendientes" },
  { id: "done", label: "Completas" },
  { id: "all", label: "Todas" },
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
  initialFilter = "pending",
}: ReekonReferenceListSheetProps) {
  const [filter, setFilter] = useState<FilterId>(initialFilter);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const palletized = referenceMode === "palletized";

  useEffect(() => {
    if (!open) return;
    setFilter(initialFilter);
    setQuery("");
    const t = window.setTimeout(() => searchRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open, initialFilter]);

  const entries = useMemo(() => {
    return measureRows.map((row, index) => {
      const done = isQuickRowComplete(row);
      const reemp = row.reempaque === true;
      const label = rowLabel(row, index, referenceMode, measureRows);
      const desc = strVal(row.descripcion);
      return {
        row,
        index,
        done,
        reemp,
        label,
        summary: rowSummary(row, reemp),
        searchBlob: `${label} ${desc} L${index + 1} #${index + 1}`.toLowerCase(),
      };
    });
  }, [measureRows, referenceMode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = entries;
    if (filter === "pending") list = list.filter((e) => !e.done);
    else if (filter === "done") list = list.filter((e) => e.done);
    else {
      // Todas: pendientes primero, luego completas (orden relativo).
      list = [...list].sort((a, b) => Number(a.done) - Number(b.done));
    }
    if (q) {
      list = list.filter((e) => e.searchBlob.includes(q));
    }
    return list;
  }, [entries, filter, query]);

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
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 dark:border-slate-800 sm:px-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <List className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
              <h2
                id="reekon-ref-list-title"
                className="text-sm font-bold text-slate-900 dark:text-slate-100 sm:text-base"
              >
                Elegir referencia
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
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100 dark:active:bg-slate-800"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="shrink-0 space-y-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800 sm:px-4">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por código, descripción o línea…"
              enterKeyHint="search"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-9 text-sm font-medium text-slate-900 outline-none ring-blue-500/30 placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200/80 dark:hover:bg-slate-700"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </label>

          <div className="flex gap-1 overflow-x-auto">
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
                  className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition sm:text-xs ${
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
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-3">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              {query.trim()
                ? "No hay coincidencias. Probá otro código."
                : "No hay líneas en este filtro."}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5 py-2">
              {filtered.map(({ row, index, done, reemp, label, summary }) => {
                const isActive = row.id === activeRowId;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(row.id)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99] ${
                        isActive
                          ? "border-blue-500 bg-blue-50 shadow-sm dark:border-blue-400 dark:bg-blue-950/40"
                          : done
                            ? "border-emerald-200/80 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/25"
                            : reemp
                              ? "border-violet-200/80 bg-violet-50/60 dark:border-violet-800 dark:bg-violet-950/25"
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
                          <div className="flex items-start justify-between gap-2">
                            <span className="break-words text-[15px] font-bold leading-snug text-slate-900 dark:text-slate-100">
                              {label}
                            </span>
                            <span className="shrink-0 text-[10px] font-semibold tabular-nums text-slate-400">
                              L{index + 1}
                              {palletized ? ` · P${palletOf(row)}` : ""}
                            </span>
                          </div>
                          <p className="mt-0.5 break-words text-[12px] leading-snug text-slate-500 dark:text-slate-400">
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
