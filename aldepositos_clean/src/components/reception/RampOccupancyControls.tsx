"use client";

import React from "react";
import {
  CheckCircle2,
  Loader2,
  Monitor,
  PackageX,
  Truck,
} from "lucide-react";
import {
  RAMP_OCCUPANCY_COPY,
  RAMP_OCCUPANCY_RAMPS,
  type RampOccupancyRampId,
  type RampOccupancyState,
} from "@/lib/receptionLogistics/rampOccupancy";
import { RECEPTION_STATUS_LABELS } from "@/lib/receptionLogistics/config";

type RampOccupancyControlsProps = {
  occupancy: RampOccupancyState | null;
  busyRamp: RampOccupancyRampId | null;
  onToggle: (rampId: RampOccupancyRampId) => void;
  compact?: boolean;
};

function rampButtonLabel(rampId: RampOccupancyRampId): string {
  return rampId === "RAMPA_1"
    ? RAMP_OCCUPANCY_COPY.ramp1Label
    : RAMP_OCCUPANCY_COPY.ramp2Label;
}

function formatOccupiedSince(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("es-PA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function RampStatusCard({
  rampId,
  occupied,
  busy,
  disabled,
  updatedAt,
  onToggle,
}: {
  rampId: RampOccupancyRampId;
  occupied: boolean;
  busy: boolean;
  disabled: boolean;
  updatedAt: string | null;
  onToggle: () => void;
}) {
  const rampName = RECEPTION_STATUS_LABELS[rampId] ?? rampButtonLabel(rampId);
  const since = occupied ? formatOccupiedSince(updatedAt) : null;
  const statusLabel = occupied
    ? RAMP_OCCUPANCY_COPY.occupiedRetiro
    : RAMP_OCCUPANCY_COPY.free;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      aria-pressed={occupied}
      title={
        occupied
          ? since
            ? `Retiro desde ${since}. Tocá para liberar ${rampName}.`
            : `Retiro en curso. Tocá para liberar ${rampName}.`
          : `${rampName} disponible. Tocá si hay retiro de mercancía.`
      }
      className={`group inline-flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-left transition active:scale-[0.98] disabled:cursor-wait disabled:opacity-70 sm:min-w-[9.5rem] ${
        occupied
          ? "border-orange-400 bg-orange-500 text-white shadow-sm hover:bg-orange-600"
          : "border-emerald-200 bg-emerald-50 text-emerald-950 hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-50 dark:hover:bg-emerald-900/50"
      }`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
          occupied
            ? "bg-white/20 text-white"
            : "bg-white text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300"
        }`}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Truck className="h-3.5 w-3.5" aria-hidden />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={`block text-[9px] font-bold uppercase tracking-wide ${
            occupied ? "text-orange-100" : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {rampName}
        </span>
        <span
          className={`block truncate text-sm font-black leading-tight ${
            occupied ? "text-white" : "text-emerald-900 dark:text-emerald-100"
          }`}
        >
          {statusLabel}
        </span>
      </span>

      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          occupied
            ? "bg-white/20 text-white"
            : "bg-emerald-500 text-white dark:bg-emerald-600"
        }`}
        aria-hidden
      >
        {occupied ? (
          <PackageX className="h-3 w-3" />
        ) : (
          <CheckCircle2 className="h-3 w-3" />
        )}
      </span>
    </button>
  );
}

export function RampOccupancyControls({
  occupancy,
  busyRamp,
  onToggle,
  compact = false,
}: RampOccupancyControlsProps) {
  if (!occupancy) return null;

  if (compact) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {RAMP_OCCUPANCY_RAMPS.map((rampId) => {
          const entry = occupancy[rampId];
          return (
            <RampStatusCard
              key={rampId}
              rampId={rampId}
              occupied={entry.occupied}
              busy={busyRamp === rampId}
              disabled={busyRamp != null}
              updatedAt={entry.updatedAt}
              onToggle={() => onToggle(rampId)}
            />
          );
        })}
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 shadow-sm dark:border-slate-700 dark:bg-slate-900/70">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 shrink-0">
          <h3 className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
              <PackageX className="h-3.5 w-3.5" aria-hidden />
            </span>
            {RAMP_OCCUPANCY_COPY.sectionTitle}
            <span className="hidden items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 sm:inline-flex">
              <Monitor className="h-3 w-3" aria-hidden />
              TV
            </span>
          </h3>
          <p className="mt-0.5 pl-9 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
            {RAMP_OCCUPANCY_COPY.sectionHint}
          </p>
        </div>

        <div className="flex w-full gap-2 sm:w-auto sm:max-w-sm">
          {RAMP_OCCUPANCY_RAMPS.map((rampId) => {
            const entry = occupancy[rampId];
            return (
              <RampStatusCard
                key={rampId}
                rampId={rampId}
                occupied={entry.occupied}
                busy={busyRamp === rampId}
                disabled={busyRamp != null}
                updatedAt={entry.updatedAt}
                onToggle={() => onToggle(rampId)}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Tarjeta visible en TV / tablero cuando la rampa está marcada ocupada por retiro. */
export function RampOccupancyTvCard({
  rampId,
  stripeClass,
}: {
  rampId: RampOccupancyRampId;
  stripeClass: string;
}) {
  const rampName = RECEPTION_STATUS_LABELS[rampId] ?? rampId;

  return (
    <li className="relative overflow-hidden rounded-2xl border-2 border-dashed border-orange-400 bg-gradient-to-br from-orange-50 to-amber-100 px-4 py-5 shadow-md">
      <span
        className={`pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b ${stripeClass}`}
        aria-hidden
      />
      <div className="flex items-start gap-3 pl-1">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white shadow">
          <PackageX className="h-6 w-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-700">
            {rampName}
          </p>
          <p className="mt-1 text-lg font-black leading-tight text-orange-950 md:text-xl">
            {RAMP_OCCUPANCY_COPY.tvBannerTitle}
          </p>
          <p className="mt-1 text-sm font-bold leading-snug text-orange-900/90 md:text-base">
            {RAMP_OCCUPANCY_COPY.tvBannerBody}
          </p>
        </div>
      </div>
    </li>
  );
}
