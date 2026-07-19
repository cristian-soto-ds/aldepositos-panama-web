"use client";

import React, { useEffect } from "react";
import { CheckCircle2, FileCode, X } from "lucide-react";

export type HtmImportResultSummary = {
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  /** Cuando no hubo nada que crear/actualizar. */
  emptyReason?: "all-up-to-date" | "nothing-to-import";
};

type HtmImportResultModalProps = {
  open: boolean;
  summary: HtmImportResultSummary | null;
  onClose: () => void;
};

export function HtmImportResultModal({
  open,
  summary,
  onClose,
}: HtmImportResultModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !summary) return null;

  const hasErrors = summary.failed > 0;
  const isEmpty =
    summary.created === 0 &&
    summary.updated === 0 &&
    summary.emptyReason != null;

  const headline = isEmpty
    ? summary.emptyReason === "all-up-to-date"
      ? "Sin cambios"
      : "Sin órdenes"
    : hasErrors
      ? "Importación con avisos"
      : "Importación completada";

  const subtitle = isEmpty
    ? summary.emptyReason === "all-up-to-date"
      ? "Las órdenes del archivo ya existían y estaban al día."
      : "El archivo no trajo órdenes para importar."
    : "Resumen del documento HTM importado.";

  return (
    <div
      className="modal-overlay flex items-end justify-center bg-slate-900/55 backdrop-blur-[2px] sm:items-center"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="htm-import-result-title"
        className="modal-panel w-full max-w-md overflow-hidden border border-slate-200 bg-white shadow-2xl dark:border-slate-600 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className={`flex items-start justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-700 ${
            hasErrors
              ? "bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/30"
              : "bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/30"
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-xl text-white shadow-lg ${
                hasErrors
                  ? "bg-amber-500 shadow-amber-500/30"
                  : "bg-emerald-500 shadow-emerald-500/30"
              }`}
            >
              {hasErrors ? (
                <FileCode className="h-5 w-5" strokeWidth={2.5} aria-hidden />
              ) : (
                <CheckCircle2 className="h-5 w-5" strokeWidth={2.5} aria-hidden />
              )}
            </div>
            <div>
              <h2
                id="htm-import-result-title"
                className="text-base font-black uppercase tracking-wide text-[#16263F] dark:text-slate-100"
              >
                Importación HTM
              </h2>
              <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                {subtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-white/80 dark:hover:bg-slate-800"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-5">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {headline}
          </p>

          {!isEmpty ? (
            <ul className="mt-3 space-y-2">
              {summary.created > 0 ? (
                <li className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900/40 dark:bg-emerald-950/30">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-200">
                    Creadas
                  </span>
                  <span className="text-sm font-black tabular-nums text-emerald-900 dark:text-emerald-100">
                    {summary.created}
                  </span>
                </li>
              ) : null}
              {summary.updated > 0 ? (
                <li className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900/40 dark:bg-blue-950/30">
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-800 dark:text-blue-200">
                    Actualizadas
                  </span>
                  <span className="text-sm font-black tabular-nums text-blue-900 dark:text-blue-100">
                    {summary.updated}
                  </span>
                </li>
              ) : null}
              {summary.unchanged > 0 ? (
                <li className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-600 dark:bg-slate-800/60">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    Sin cambios
                  </span>
                  <span className="text-sm font-black tabular-nums text-slate-800 dark:text-slate-100">
                    {summary.unchanged}
                  </span>
                </li>
              ) : null}
              {summary.failed > 0 ? (
                <li className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-900/40 dark:bg-rose-950/30">
                  <span className="text-xs font-bold uppercase tracking-wider text-rose-800 dark:text-rose-200">
                    Con error
                  </span>
                  <span className="text-sm font-black tabular-nums text-rose-900 dark:text-rose-100">
                    {summary.failed}
                  </span>
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>

        <div className="flex gap-2 border-t border-slate-100 bg-slate-50/80 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/50">
          <button
            type="button"
            onClick={onClose}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#16263F] to-indigo-700 py-3 text-xs font-black uppercase tracking-wider text-white shadow-md shadow-indigo-900/20 transition hover:from-[#0f1a2e] hover:to-indigo-800"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
