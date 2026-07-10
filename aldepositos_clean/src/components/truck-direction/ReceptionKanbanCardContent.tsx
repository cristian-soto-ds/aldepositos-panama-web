"use client";

import React from "react";
import { isCollectionOrderReceptionTruck } from "@/lib/receptionLogistics/syncCollectionOrderReception";
import type { ReceptionTruck } from "@/lib/receptionLogistics/types";

export type ReceptionCardDensity = "normal" | "compact" | "dense";

function collectionOrNumber(plate: string): string | null {
  const match = /^OR\s*#\s*(.+)$/i.exec(plate.trim());
  return match ? match[1].trim() : null;
}

function displayLabel(value: string | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed && trimmed !== "—" ? trimmed : null;
}

type ReceptionKanbanCardContentProps = {
  truck: ReceptionTruck;
  /** Posición en fila (1 = primero en entrar). Solo columna «En Fila». */
  queuePosition?: number;
  density?: ReceptionCardDensity;
  /** @deprecated Usar density */
  compact?: boolean;
  bultosBadgeClassName?: string;
  variant?: "operator" | "tv";
};

export function ReceptionKanbanCardContent({
  truck,
  queuePosition,
  density: densityProp,
  compact = false,
  bultosBadgeClassName = "",
  variant = "operator",
}: ReceptionKanbanCardContentProps) {
  const density: ReceptionCardDensity =
    densityProp ?? (compact ? "compact" : "normal");

  const isCollection = isCollectionOrderReceptionTruck(truck);
  const orNum = isCollection ? collectionOrNumber(truck.plate) : null;
  const client = displayLabel(truck.client);
  const provider = displayLabel(truck.provider);
  const mainCompanyLabel = isCollection ? provider : client;
  const secondaryCompanyLabel =
    !isCollection && client && provider ? provider : null;

  const isDense = density === "dense";
  const isCompact = density === "compact";

  const orTitleClass = isDense
    ? variant === "tv"
      ? "text-lg md:text-xl"
      : "text-base sm:text-lg"
    : isCompact
      ? variant === "tv"
        ? "text-xl md:text-2xl"
        : "text-lg sm:text-xl"
      : variant === "tv"
        ? "text-3xl md:text-4xl"
        : "text-xl sm:text-2xl";

  const companyClass = isDense
    ? variant === "tv"
      ? "text-sm md:text-base"
      : "text-xs sm:text-sm"
    : isCompact
      ? variant === "tv"
        ? "text-base md:text-lg"
        : "text-sm sm:text-base"
      : variant === "tv"
        ? "text-lg md:text-xl"
        : "text-sm sm:text-base";

  const queueSize = isDense
    ? "h-7 w-7 text-xs"
    : isCompact
      ? "h-8 w-8 text-sm"
      : "h-10 w-10 text-lg";

  return (
    <div className="flex min-w-0 items-start gap-2 sm:gap-2.5">
      {queuePosition != null ? (
        <div
          className={`flex shrink-0 items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800 font-black tabular-nums leading-none text-white ${queueSize}`}
          title={`Posición ${queuePosition} en fila`}
          aria-label={`Posición ${queuePosition} en fila`}
        >
          {queuePosition}
        </div>
      ) : null}

      <div className="min-w-0 flex-1">
        {/* Fila superior: OR / placa + bultos */}
        <div className="flex min-w-0 items-center justify-between gap-2">
          {orNum != null ? (
            <div
              className={`flex shrink-0 items-baseline gap-1 font-black leading-none tracking-tight text-inherit ${orTitleClass}`}
            >
              <span>OR</span>
              <span className="tabular-nums">#{orNum}</span>
            </div>
          ) : (
            <p
              className={`min-w-0 flex-1 truncate font-black leading-none tracking-tight text-inherit ${orTitleClass}`}
              title={truck.plate}
            >
              {truck.plate}
            </p>
          )}

          <BultosPill
            count={truck.expectedBultos}
            variant={variant}
            density={density}
            className={bultosBadgeClassName}
          />
        </div>

        {/* Proveedor / cliente: SIEMPRE completo (salto de línea, sin recortar) */}
        {mainCompanyLabel ? (
          <p
            className={`mt-1 break-words font-bold leading-snug text-inherit opacity-90 ${companyClass}`}
            title={mainCompanyLabel}
          >
            {mainCompanyLabel}
          </p>
        ) : null}

        {secondaryCompanyLabel ? (
          <p className="mt-0.5 break-words text-xs font-medium leading-snug text-inherit opacity-70">
            {secondaryCompanyLabel}
          </p>
        ) : null}

        {!isCollection && truck.ra?.trim() ? (
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-inherit opacity-60">
            RA {truck.ra}
          </p>
        ) : null}

        {!isDense && truck.warehouseReceiptNumber ? (
          <div className="mt-2">
            <span className="rounded-lg bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
              {truck.warehouseReceiptNumber}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BultosPill({
  count,
  variant,
  density,
  className = "",
}: {
  count: number;
  variant: "operator" | "tv";
  density: ReceptionCardDensity;
  className?: string;
}) {
  const isDense = density === "dense";
  const isCompact = density === "compact";
  const themedBadge = Boolean(className.trim());

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-lg border font-black tabular-nums leading-none ${
        themedBadge
          ? className
          : variant === "tv"
            ? "border-violet-200 bg-violet-50 text-violet-800"
            : "border-slate-200 bg-white text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      } ${
        isDense
          ? "px-2 py-1 text-sm"
          : isCompact
            ? "px-2 py-0.5 text-base"
            : "px-2.5 py-1 text-lg"
      }`}
    >
      <span>{count}</span>
      <span
        className={`font-bold uppercase tracking-wider text-inherit opacity-60 ${
          isDense ? "text-[8px]" : "text-[9px]"
        }`}
      >
        bult
      </span>
    </span>
  );
}
