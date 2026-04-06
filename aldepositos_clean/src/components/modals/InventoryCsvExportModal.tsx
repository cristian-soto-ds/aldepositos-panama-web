"use client";

import React, { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

type InventoryCsvExportModalProps = {
  open: boolean;
  raLabel: string;
  defaultNumero?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (numeroDocumento: string) => void;
};

export function InventoryCsvExportModal({
  open,
  raLabel,
  defaultNumero = "",
  busy = false,
  onCancel,
  onConfirm,
}: InventoryCsvExportModalProps) {
  const [numero, setNumero] = useState(defaultNumero);

  useEffect(() => {
    if (open) setNumero(defaultNumero);
  }, [open, defaultNumero]);

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
        aria-labelledby="inv-csv-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-600 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-100 bg-gradient-to-r from-sky-50 to-emerald-50 px-5 py-4 dark:border-slate-700 dark:from-sky-950/40 dark:to-emerald-950/30">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#16263F] text-white shadow-lg shadow-slate-900/25">
              <Download className="h-5 w-5" strokeWidth={2.5} aria-hidden />
            </div>
            <div>
              <h2
                id="inv-csv-title"
                className="text-base font-black uppercase tracking-wide text-[#16263F] dark:text-slate-100"
              >
                Descargar inventario CSV
              </h2>
              <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                RA <span className="font-black text-[#16263F] dark:text-white">{raLabel}</span>
                {" · "}
                CSV (delimitado por comas), como en Excel
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
          <label
            htmlFor="inv-csv-numero"
            className="mb-2 block text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400"
          >
            Número (columna del CSV)
          </label>
          <input
            id="inv-csv-numero"
            type="text"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            disabled={busy}
            placeholder="Ej. 424"
            className="w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-sm font-bold text-[#16263F] outline-none transition focus:border-[#16263F] disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            autoComplete="off"
          />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Este valor se repetirá en cada fila. Los campos numéricos vacíos se exportan como{" "}
            <span className="font-black">0</span>.             Mismo formato que al guardar en Excel como «CSV (delimitado por comas)»
            (Windows, codificación ANSI / Windows-1252).
          </p>
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
            disabled={busy}
            onClick={() => onConfirm(numero.trim())}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#16263F] py-3 text-xs font-black uppercase tracking-widest text-white shadow-md transition hover:bg-black disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Descargar
          </button>
        </div>
      </div>
    </div>
  );
}
