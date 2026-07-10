"use client";

import React, { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, X } from "lucide-react";
import {
  formatDateInputPanama,
  parseDateInputPanama,
  presetDateRange,
  previewReceptionReport,
  type ReceptionReportFilter,
} from "@/lib/receptionLogistics/buildDailyReceptionReport";
import { RECEPTION_COPY } from "@/lib/receptionLogistics/config";
import type { ReceptionReportPreset } from "@/lib/receptionLogistics/receptionReportFilter";
import type { ReceptionTruck } from "@/lib/receptionLogistics/types";

type ReceptionReportExportModalProps = {
  open: boolean;
  trucks: ReceptionTruck[];
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (filter: ReceptionReportFilter) => void;
};

const PRESETS: { id: ReceptionReportPreset; label: string }[] = [
  { id: "today", label: "Hoy" },
  { id: "yesterday", label: "Ayer" },
  { id: "this_week", label: "Esta semana" },
  { id: "custom", label: "Personalizado" },
];

function buildFilterFromState(
  preset: ReceptionReportPreset,
  fromInput: string,
  toInput: string,
  dateField: ReceptionReportFilter["dateField"],
  statusScope: ReceptionReportFilter["statusScope"],
): ReceptionReportFilter {
  if (preset === "custom") {
    return {
      from: parseDateInputPanama(fromInput),
      to: parseDateInputPanama(toInput),
      dateField,
      statusScope,
    };
  }
  const { from, to } = presetDateRange(preset);
  return { from, to, dateField, statusScope };
}

export function ReceptionReportExportModal({
  open,
  trucks,
  busy = false,
  onCancel,
  onConfirm,
}: ReceptionReportExportModalProps) {
  const [preset, setPreset] = useState<ReceptionReportPreset>("today");
  const [fromInput, setFromInput] = useState(() =>
    formatDateInputPanama(new Date()),
  );
  const [toInput, setToInput] = useState(() =>
    formatDateInputPanama(new Date()),
  );
  const [dateField, setDateField] =
    useState<ReceptionReportFilter["dateField"]>("arrival");
  const [statusScope, setStatusScope] =
    useState<ReceptionReportFilter["statusScope"]>("all");

  useEffect(() => {
    if (!open) return;
    const today = formatDateInputPanama(new Date());
    setPreset("today");
    setFromInput(today);
    setToInput(today);
    setDateField("arrival");
    setStatusScope("all");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  const filter = useMemo(
    () => buildFilterFromState(preset, fromInput, toInput, dateField, statusScope),
    [preset, fromInput, toInput, dateField, statusScope],
  );

  const preview = useMemo(
    () => previewReceptionReport(trucks, filter),
    [trucks, filter],
  );

  const applyPreset = (next: ReceptionReportPreset) => {
    setPreset(next);
    if (next !== "custom") {
      const { from, to } = presetDateRange(next);
      setFromInput(formatDateInputPanama(from));
      setToInput(formatDateInputPanama(to));
    }
  };

  if (!open) return null;

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
        aria-labelledby="reception-report-title"
        className="modal-panel w-full max-w-lg overflow-hidden border border-slate-200 bg-white shadow-2xl dark:border-slate-600 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-100 bg-gradient-to-r from-amber-50 to-slate-50 px-5 py-4 dark:border-slate-700 dark:from-amber-950/30 dark:to-slate-900">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#16263F] text-white shadow-lg shadow-slate-900/25">
              <FileSpreadsheet className="h-5 w-5" strokeWidth={2.5} aria-hidden />
            </div>
            <div>
              <h2
                id="reception-report-title"
                className="text-base font-black uppercase tracking-wide text-[#16263F] dark:text-slate-100"
              >
                {RECEPTION_COPY.reportModalTitle}
              </h2>
              <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                {RECEPTION_COPY.reportModalSubtitle}
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

        <div className="space-y-5 px-5 py-5">
          <div>
            <p className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Período
            </p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy}
                  onClick={() => applyPreset(p.id)}
                  className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wide transition ${
                    preset === p.id
                      ? "bg-[#16263F] text-white"
                      : "border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="report-from"
                className="mb-1 block text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400"
              >
                Desde
              </label>
              <input
                id="report-from"
                type="date"
                value={fromInput}
                disabled={busy}
                onChange={(e) => {
                  setPreset("custom");
                  setFromInput(e.target.value);
                }}
                className="w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-[#16263F] outline-none focus:border-[#16263F] disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label
                htmlFor="report-to"
                className="mb-1 block text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400"
              >
                Hasta
              </label>
              <input
                id="report-to"
                type="date"
                value={toInput}
                disabled={busy}
                onChange={(e) => {
                  setPreset("custom");
                  setToInput(e.target.value);
                }}
                className="w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-[#16263F] outline-none focus:border-[#16263F] disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Criterio de fecha
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm dark:border-slate-600">
                <input
                  type="radio"
                  name="dateField"
                  checked={dateField === "arrival"}
                  disabled={busy}
                  onChange={() => setDateField("arrival")}
                />
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Llegada a bodega
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm dark:border-slate-600">
                <input
                  type="radio"
                  name="dateField"
                  checked={dateField === "completed"}
                  disabled={busy}
                  onChange={() => setDateField("completed")}
                />
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Completado en rampa
                </span>
              </label>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Incluir
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm dark:border-slate-600">
                <input
                  type="radio"
                  name="statusScope"
                  checked={statusScope === "all"}
                  disabled={busy}
                  onChange={() => setStatusScope("all")}
                />
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Todas del período
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm dark:border-slate-600">
                <input
                  type="radio"
                  name="statusScope"
                  checked={statusScope === "completed_only"}
                  disabled={busy}
                  onChange={() => setStatusScope("completed_only")}
                />
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Solo completadas
                </span>
              </label>
            </div>
          </div>

          <p className="rounded-xl border border-blue-100 bg-blue-50/80 px-4 py-3 text-sm text-slate-700 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-slate-300">
            Se exportarán{" "}
            <strong>{preview.orCount}</strong> OR (
            <strong>{preview.bultos}</strong> bultos) con los filtros seleccionados.
          </p>
        </div>

        <div className="flex gap-3 border-t border-slate-100 px-5 py-4 dark:border-slate-700">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="flex-1 rounded-xl border border-slate-200 py-3 text-xs font-bold uppercase tracking-widest text-slate-500 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || preview.orCount === 0}
            onClick={() => onConfirm(filter)}
            className="flex-1 rounded-xl bg-[#16263F] py-3 text-xs font-bold uppercase tracking-widest text-white shadow-lg transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Generando…" : "Descargar Excel"}
          </button>
        </div>
      </div>
    </div>
  );
}
