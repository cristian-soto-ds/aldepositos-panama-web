"use client";

import React, { useEffect } from "react";
import { Trash2, X } from "lucide-react";

type DeleteRaConfirmModalProps = {
  open: boolean;
  raLabel: string;
  clientHint?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteRaConfirmModal({
  open,
  raLabel,
  clientHint,
  busy = false,
  onCancel,
  onConfirm,
}: DeleteRaConfirmModalProps) {
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
      className="fixed inset-0 z-[320] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-ra-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-600 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-100 bg-gradient-to-r from-rose-50 to-amber-50 px-5 py-4 dark:border-slate-700 dark:from-rose-950/40 dark:to-amber-950/30">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-500 text-white shadow-lg shadow-rose-500/30">
              <Trash2 className="h-5 w-5" strokeWidth={2.5} aria-hidden />
            </div>
            <div>
              <h2
                id="delete-ra-title"
                className="text-base font-black uppercase tracking-wide text-[#16263F] dark:text-slate-100"
              >
                Eliminar orden
              </h2>
              <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Esta acción no se puede deshacer.
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

        <div className="px-5 py-5">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            ¿Eliminar el RA{" "}
            <span className="font-black text-[#16263F] dark:text-white">
              {raLabel || "—"}
            </span>
            ?
          </p>
          {clientHint ? (
            <p className="mt-2 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
              {clientHint}
            </p>
          ) : null}
        </div>

        <div className="flex gap-2 border-t border-slate-100 bg-slate-50/80 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/50">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="flex-1 rounded-xl border-2 border-slate-200 bg-white py-3 text-xs font-black uppercase tracking-wider text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/80"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 py-3 text-xs font-black uppercase tracking-wider text-white shadow-md shadow-rose-600/25 transition hover:from-rose-700 hover:to-red-700 disabled:opacity-60"
          >
            {busy ? (
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Eliminar
          </button>
        </div>
      </div>
    </div>
  );
}
