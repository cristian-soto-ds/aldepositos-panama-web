"use client";

import React from "react";
import { Loader2, PackageX, Truck } from "lucide-react";
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

export function RampOccupancyControls({
  occupancy,
  busyRamp,
  onToggle,
  compact = false,
}: RampOccupancyControlsProps) {
  if (!occupancy) return null;

  return (
    <div
      className={`rounded-xl border border-amber-200/70 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/20 ${
        compact ? "px-2.5 py-2" : "p-4"
      }`}
    >
      <div
        className={`flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between ${
          compact ? "sm:gap-3" : "gap-3"
        }`}
      >
        <div className="min-w-0 shrink-0">
          <p
            className={`flex items-center gap-1.5 font-black uppercase tracking-wider text-amber-800 dark:text-amber-300 ${
              compact ? "text-[9px]" : "text-[10px] tracking-[0.18em]"
            }`}
          >
            <PackageX className={compact ? "h-3 w-3" : "h-4 w-4"} aria-hidden />
            {RAMP_OCCUPANCY_COPY.sectionTitle}
          </p>
          {!compact ? (
            <p className="mt-1 max-w-xl text-xs font-medium leading-relaxed text-amber-900/80 dark:text-amber-200/80">
              {RAMP_OCCUPANCY_COPY.sectionHint}
            </p>
          ) : null}
        </div>

        <div className={`grid shrink-0 gap-1.5 sm:grid-cols-2 ${compact ? "w-full sm:w-auto" : "w-full sm:w-auto"}`}>
          {RAMP_OCCUPANCY_RAMPS.map((rampId) => {
            const entry = occupancy[rampId];
            const occupied = entry.occupied;
            const busy = busyRamp === rampId;
            const rampName = RECEPTION_STATUS_LABELS[rampId] ?? rampButtonLabel(rampId);
            const statusLabel = occupied
              ? RAMP_OCCUPANCY_COPY.occupiedRetiro
              : RAMP_OCCUPANCY_COPY.free;

            return (
              <button
                key={rampId}
                type="button"
                disabled={busyRamp != null}
                onClick={() => onToggle(rampId)}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg border font-bold uppercase tracking-wide transition disabled:opacity-60 ${
                  compact ? "px-2.5 py-1.5 text-[9px]" : "px-3 py-2.5 text-[10px]"
                } ${
                  occupied
                    ? "border-orange-500 bg-orange-500 text-white shadow-sm"
                    : "border-amber-200 bg-white text-amber-900 hover:border-amber-400 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-100"
                }`}
                aria-pressed={occupied}
                title={
                  occupied
                    ? `Quitar aviso de retiro en ${rampName}`
                    : `Marcar ${rampName} ocupada por retiro de mercancía`
                }
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" aria-hidden />
                ) : (
                  <Truck className="h-3 w-3 shrink-0" aria-hidden />
                )}
                <span className="whitespace-nowrap">
                  {rampName}: {statusLabel}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
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
