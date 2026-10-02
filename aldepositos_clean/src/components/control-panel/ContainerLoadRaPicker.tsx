"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Check, Lock, Search, X } from "lucide-react";
import { normalizeContainerLoadRa } from "@/lib/containerLoads";
import {
  CONTAINER_LOAD_STATE_CHIP,
  CONTAINER_LOAD_STATE_LABELS,
  containerLoadItemState,
  findRaConflicts,
  inventoryTabForTask,
  type InventoryTab,
} from "@/lib/containerLoadStatus";
import type { ContainerLoad } from "@/lib/types/containerLoad";
import type { Task } from "@/lib/types/task";

type OriginFilter = "all" | Exclude<InventoryTab, "containerLoad">;

const ORIGIN_LABELS: Record<OriginFilter, string> = {
  all: "Todos",
  pending: "Pendientes",
  priority: "Prioridad",
  completed: "Completados",
  rectification: "Rectificación",
};

const ORIGIN_ORDER: Record<string, number> = {
  priority: 0,
  pending: 1,
  rectification: 2,
  completed: 3,
};

const PAGE = 150;
const NO_LOAD_KEYS = new Set<string>();

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: (ras: string[]) => void;
  tasks: Task[];
  loads: ContainerLoad[];
  /** Cargue que se está editando (sus RA no cuentan como conflicto). */
  currentLoadId?: string;
  /** RA que ya están en este cargue / vista previa: no se listan. */
  excludeRas: string[];
};

type PickerRow = {
  key: string;
  task: Task;
  origin: OriginFilter;
  blockedBy: string | null;
};

export function ContainerLoadRaPicker({
  open,
  onClose,
  onConfirm,
  tasks,
  loads,
  currentLoadId,
  excludeRas,
}: Props) {
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<OriginFilter>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setOrigin("all");
    setSelected([]);
    setLimit(PAGE);
  }, [open]);

  useEffect(() => {
    setLimit(PAGE);
  }, [query, origin]);

  const rows = useMemo<PickerRow[]>(() => {
    if (!open) return [];
    const excluded = new Set(excludeRas.map(normalizeContainerLoadRa));
    const seen = new Set<string>();
    const candidates: { key: string; task: Task; origin: OriginFilter }[] = [];
    for (const task of tasks) {
      const key = normalizeContainerLoadRa(task.ra);
      if (!key || excluded.has(key) || seen.has(key)) continue;
      const tab = inventoryTabForTask(task, NO_LOAD_KEYS);
      if (!tab || tab === "containerLoad") continue;
      seen.add(key);
      candidates.push({ key, task, origin: tab });
    }
    const conflicts = findRaConflicts(
      loads,
      candidates.map((c) => c.key),
      currentLoadId,
    );
    return candidates
      .map((c) => ({ ...c, blockedBy: conflicts.get(c.key) ?? null }))
      .sort(
        (a, b) =>
          (ORIGIN_ORDER[a.origin] ?? 9) - (ORIGIN_ORDER[b.origin] ?? 9) ||
          b.key.localeCompare(a.key, undefined, { numeric: true }),
      );
  }, [open, tasks, loads, currentLoadId, excludeRas]);

  const counts = useMemo(() => {
    const c: Record<OriginFilter, number> = {
      all: rows.length,
      pending: 0,
      priority: 0,
      completed: 0,
      rectification: 0,
    };
    for (const r of rows) c[r.origin] += 1;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (origin !== "all" && r.origin !== origin) return false;
      if (!q) return true;
      return [r.key, r.task.mainClient, r.task.provider, r.task.brand, r.task.subClient]
        .map((v) => String(v ?? "").toLowerCase())
        .join(" ")
        .includes(q);
    });
  }, [rows, origin, query]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggle = (key: string) => {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const selectVisible = () => {
    setSelected((prev) => {
      const set = new Set(prev);
      const add = visible
        .slice(0, limit)
        .filter((r) => !r.blockedBy && !set.has(r.key))
        .map((r) => r.key);
      return [...prev, ...add];
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-3xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
              Cargue de contenedor
            </p>
            <h2 className="text-lg font-black text-[#16263F] dark:text-slate-50">
              Seleccionar RA
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="shrink-0 space-y-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-400/20 dark:border-slate-600 dark:bg-slate-800">
            <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar RA, cliente, proveedor o marca"
              className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#16263F] outline-none placeholder:text-slate-400 dark:text-slate-100"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(ORIGIN_LABELS) as OriginFilter[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setOrigin(key)}
                className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${
                  origin === key
                    ? "bg-[#16263F] text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {ORIGIN_LABELS[key]} ({counts[key]})
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {visible.length === 0 ? (
            <p className="py-12 text-center text-sm font-bold text-slate-400">
              Ningún RA coincide con la búsqueda.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {visible.slice(0, limit).map((r) => {
                const checked = selectedSet.has(r.key);
                const state = containerLoadItemState(r.task);
                const blocked = r.blockedBy !== null;
                return (
                  <li key={r.key}>
                    <button
                      type="button"
                      disabled={blocked}
                      onClick={() => toggle(r.key)}
                      className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition ${
                        blocked
                          ? "cursor-not-allowed opacity-50"
                          : checked
                            ? "bg-blue-50 dark:bg-blue-950/30"
                            : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${
                          blocked
                            ? "border-slate-200 dark:border-slate-700"
                            : checked
                              ? "border-blue-600 bg-blue-600 text-white"
                              : "border-slate-300 dark:border-slate-600"
                        }`}
                      >
                        {blocked ? (
                          <Lock className="h-3 w-3 text-slate-400" />
                        ) : checked ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : null}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-black text-[#16263F] dark:text-slate-100">
                            RA {r.key}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-black ${CONTAINER_LOAD_STATE_CHIP[state]}`}
                          >
                            {CONTAINER_LOAD_STATE_LABELS[state]}
                          </span>
                          <span className="text-[10px] font-bold uppercase text-slate-400">
                            {ORIGIN_LABELS[r.origin]}
                          </span>
                        </div>
                        <p className="truncate text-[11px] text-slate-500">
                          {r.task.mainClient || "—"}
                          {r.task.provider ? ` · ${r.task.provider}` : ""}
                          {r.task.brand ? ` · ${r.task.brand}` : ""}
                        </p>
                        {blocked ? (
                          <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300">
                            En cargue «{r.blockedBy}»
                          </p>
                        ) : null}
                      </div>
                      {checked ? (
                        <span className="shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black tabular-nums text-white">
                          {selected.indexOf(r.key) + 1}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {visible.length > limit ? (
            <button
              type="button"
              onClick={() => setLimit((n) => n + PAGE)}
              className="my-2 w-full rounded-xl border border-slate-200 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Mostrar más ({visible.length - limit} restantes)
            </button>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700">
          <button
            type="button"
            onClick={selectVisible}
            className="rounded-xl px-3 py-2 text-[11px] font-bold uppercase text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/30"
          >
            Seleccionar visibles
          </button>
          {selected.length > 0 ? (
            <button
              type="button"
              onClick={() => setSelected([])}
              className="rounded-xl px-3 py-2 text-[11px] font-bold uppercase text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Limpiar
            </button>
          ) : null}
          <button
            type="button"
            disabled={selected.length === 0}
            onClick={() => onConfirm(selected)}
            className="ml-auto rounded-xl bg-[#16263F] px-5 py-2.5 text-xs font-black uppercase tracking-wide text-white disabled:opacity-50"
          >
            Agregar {selected.length} RA
          </button>
        </div>
      </div>
    </div>
  );
}
