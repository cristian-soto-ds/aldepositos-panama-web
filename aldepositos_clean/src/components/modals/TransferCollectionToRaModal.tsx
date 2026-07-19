"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Search, Send, X } from "lucide-react";
import type { Task } from "@/lib/types/task";
import { formatRaFieldLabel } from "@/lib/collectionOrderToTask";

export type TransferCollectionMergeMode = "append" | "replace";

type TransferCollectionToRaModalProps = {
  open: boolean;
  tasks: Task[];
  lineCount: number;
  busy?: boolean;
  /** Hay RA en el panel pero ninguno admite otra orden de recolección */
  noEligibleTargets?: boolean;
  onCancel: () => void;
  onConfirm: (taskId: string, merge: TransferCollectionMergeMode) => void;
};

function raDisplayLabel(ra: string | undefined): string {
  const raw = String(ra ?? "").trim();
  if (!raw) return "—";
  // Evita basura tipo "63793 PALETA 2" en la etiqueta principal.
  const num = raw.match(/^\d+/)?.[0];
  return num ?? raw;
}

export function TransferCollectionToRaModal({
  open,
  tasks,
  lineCount,
  busy = false,
  noEligibleTargets = false,
  onCancel,
  onConfirm,
}: TransferCollectionToRaModalProps) {
  const [taskId, setTaskId] = useState("");
  const [merge, setMerge] = useState<TransferCollectionMergeMode>("append");
  const [query, setQuery] = useState("");

  const list = useMemo(
    () =>
      [...tasks].sort((a, b) =>
        String(a.ra ?? "").localeCompare(String(b.ra ?? ""), undefined, {
          numeric: true,
        }),
      ),
    [tasks],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((t) => {
      const hay = [
        String(t.ra ?? ""),
        String(t.mainClient ?? ""),
        String(t.provider ?? ""),
        String(t.brand ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [list, query]);

  useEffect(() => {
    if (open && list.length > 0) {
      setTaskId((prev) => {
        if (prev && list.some((t) => t.id === prev)) return prev;
        return list[0]!.id;
      });
    }
    if (!open) {
      setTaskId("");
      setMerge("append");
      setQuery("");
    }
  }, [open, list]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const selected = list.find((t) => t.id === taskId) ?? null;

  return (
    <div
      className="modal-overlay flex items-end justify-center bg-slate-900/55 backdrop-blur-[2px] sm:items-center"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-coll-title"
        className="modal-panel flex max-h-[min(92vh,640px)] w-full max-w-lg flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl dark:border-slate-600 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between border-b border-slate-100 bg-[#16263F] px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">
              <Send className="h-5 w-5" strokeWidth={2.5} aria-hidden />
            </div>
            <div>
              <h2
                id="transfer-coll-title"
                className="text-base font-black uppercase tracking-wide"
              >
                Pasar medidas al RA
              </h2>
              <p className="text-xs font-medium text-white/75">
                {lineCount} línea(s) · solo RA sin orden asignada y no completados
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 disabled:opacity-50"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <label
                htmlFor="transfer-coll-search"
                className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400"
              >
                RA de destino
              </label>
              {list.length > 0 ? (
                <span className="text-[10px] font-semibold text-slate-400">
                  {filtered.length} de {list.length}
                </span>
              ) : null}
            </div>

            {list.length === 0 ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-medium text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                {noEligibleTargets
                  ? "No hay RA disponibles: los del panel ya están completados o vinculados a otra orden de recolección."
                  : "No hay órdenes en el panel. Cree un RA desde ingreso rápido o manual."}
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-400/20 dark:border-slate-600 dark:bg-slate-800/60">
                  <Search
                    className="h-4 w-4 shrink-0 text-slate-400"
                    aria-hidden
                  />
                  <input
                    id="transfer-coll-search"
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    disabled={busy}
                    placeholder="Buscar RA o cliente…"
                    className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#16263F] outline-none placeholder:text-slate-400 dark:text-slate-100"
                  />
                  {query.trim() ? (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="rounded p-0.5 text-slate-400 hover:text-slate-600"
                      title="Limpiar"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  ) : null}
                </div>

                <div
                  className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-600"
                  role="listbox"
                  aria-label="Lista de RA disponibles"
                >
                  {filtered.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm font-medium text-slate-400">
                      Ningún RA coincide con la búsqueda.
                    </p>
                  ) : (
                    filtered.map((t) => {
                      const active = t.id === taskId;
                      const client = formatRaFieldLabel(t.mainClient);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          role="option"
                          aria-selected={active}
                          disabled={busy}
                          onClick={() => setTaskId(t.id)}
                          className={`flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5 text-left transition last:border-b-0 dark:border-slate-700/80 ${
                            active
                              ? "bg-[#16263F] text-white"
                              : "bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800"
                          }`}
                        >
                          <div className="min-w-0">
                            <p
                              className={`truncate text-sm font-black tabular-nums ${
                                active
                                  ? "text-white"
                                  : "text-[#16263F] dark:text-slate-100"
                              }`}
                            >
                              RA {raDisplayLabel(t.ra)}
                            </p>
                            <p
                              className={`truncate text-[11px] font-semibold ${
                                active
                                  ? "text-white/70"
                                  : "text-slate-500 dark:text-slate-400"
                              }`}
                            >
                              {client}
                            </p>
                          </div>
                          {active ? (
                            <span className="shrink-0 rounded-md bg-white/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">
                              Elegido
                            </span>
                          ) : null}
                        </button>
                      );
                    })
                  )}
                </div>

                {selected ? (
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Destino:{" "}
                    <span className="font-bold text-[#16263F] dark:text-slate-200">
                      RA {raDisplayLabel(selected.ra)}
                    </span>
                    {" · "}
                    {formatRaFieldLabel(selected.mainClient)}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Cómo aplicar
            </legend>
            <label
              className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                merge === "append"
                  ? "border-[#16263F]/30 bg-slate-50 dark:border-blue-500/40 dark:bg-slate-800/50"
                  : "border-slate-200 dark:border-slate-600"
              }`}
            >
              <input
                type="radio"
                name="merge"
                checked={merge === "append"}
                onChange={() => setMerge("append")}
                disabled={busy}
                className="mt-0.5"
              />
              <span>
                <span className="block font-bold text-[#16263F] dark:text-slate-100">
                  Añadir al final
                </span>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Conserva las filas ya capturadas en el RA
                </span>
              </span>
            </label>
            <label
              className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                merge === "replace"
                  ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30"
                  : "border-slate-200 dark:border-slate-600"
              }`}
            >
              <input
                type="radio"
                name="merge"
                checked={merge === "replace"}
                onChange={() => setMerge("replace")}
                disabled={busy}
                className="mt-0.5"
              />
              <span>
                <span className="block font-bold text-[#16263F] dark:text-slate-100">
                  Reemplazar tabla
                </span>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Se pierde lo que había en el RA
                </span>
              </span>
            </label>
          </fieldset>
        </div>

        <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/60">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="flex-1 rounded-xl border-2 border-slate-200 py-3 text-xs font-black uppercase tracking-widest text-slate-600 transition hover:bg-white disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-900"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || list.length === 0 || !taskId}
            onClick={() => onConfirm(taskId, merge)}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#16263F] py-3 text-xs font-black uppercase tracking-widest text-white shadow-md transition hover:bg-[#0f1a2c] disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
