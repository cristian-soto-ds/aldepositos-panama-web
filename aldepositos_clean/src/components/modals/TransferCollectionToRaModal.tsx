"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Send, X } from "lucide-react";
import type { Task } from "@/lib/types/task";

export type TransferCollectionMergeMode = "append" | "replace";

type TransferCollectionToRaModalProps = {
  open: boolean;
  tasks: Task[];
  lineCount: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (taskId: string, merge: TransferCollectionMergeMode) => void;
};

export function TransferCollectionToRaModal({
  open,
  tasks,
  lineCount,
  busy = false,
  onCancel,
  onConfirm,
}: TransferCollectionToRaModalProps) {
  const [taskId, setTaskId] = useState("");
  const [merge, setMerge] = useState<TransferCollectionMergeMode>("append");

  const list = useMemo(
    () =>
      [...tasks].sort((a, b) =>
        String(a.ra ?? "").localeCompare(String(b.ra ?? ""), undefined, {
          numeric: true,
        }),
      ),
    [tasks],
  );

  useEffect(() => {
    if (open && list.length > 0) {
      setTaskId((prev) => prev || list[0]!.id);
    }
    if (!open) {
      setTaskId("");
      setMerge("append");
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

  return (
    <div
      className="fixed inset-0 z-[330] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-coll-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-600 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-sky-50 px-5 py-4 dark:border-slate-700 dark:from-indigo-950/40 dark:to-sky-950/30">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg">
              <Send className="h-5 w-5" strokeWidth={2.5} aria-hidden />
            </div>
            <div>
              <h2
                id="transfer-coll-title"
                className="text-base font-black uppercase tracking-wide text-[#16263F] dark:text-slate-100"
              >
                Pasar medidas al RA
              </h2>
              <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Se enviarán <span className="font-black">{lineCount}</span> línea(s) con datos a
                la captura del RA elegido.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-white/80 disabled:opacity-50 dark:hover:bg-slate-800"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div>
            <label
              htmlFor="transfer-coll-task"
              className="mb-2 block text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400"
            >
              RA de destino
            </label>
            {list.length === 0 ? (
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                No hay órdenes en el panel. Cree un RA desde el panel o ingreso manual.
              </p>
            ) : (
              <select
                id="transfer-coll-task"
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                disabled={busy}
                className="w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-[#16263F] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              >
                {list.map((t) => (
                  <option key={t.id} value={t.id}>
                    RA-{t.ra} · {String(t.mainClient ?? "").slice(0, 40)}
                    {t.type ? ` · ${t.type}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Cómo aplicar
            </legend>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <input
                type="radio"
                name="merge"
                checked={merge === "append"}
                onChange={() => setMerge("append")}
                disabled={busy}
              />
              Añadir al final de las filas ya capturadas
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <input
                type="radio"
                name="merge"
                checked={merge === "replace"}
                onChange={() => setMerge("replace")}
                disabled={busy}
              />
              Reemplazar toda la tabla del RA (se pierde lo que había)
            </label>
          </fieldset>
        </div>

        <div className="flex gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/60">
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
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-xs font-black uppercase tracking-widest text-white shadow-md transition hover:bg-indigo-700 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
