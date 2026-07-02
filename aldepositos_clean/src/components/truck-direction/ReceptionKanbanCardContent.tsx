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

  if (density === "dense") {
    return (
      <DenseQueueRow
        truck={truck}
        orNum={orNum}
        isCollection={isCollection}
        mainCompanyLabel={mainCompanyLabel}
        queuePosition={queuePosition}
        variant={variant}
      />
    );
  }

  const isCompact = density === "compact";

  const orTitleClass = isCompact
    ? variant === "tv"
      ? "text-lg md:text-xl"
      : "text-base sm:text-lg"
    : variant === "tv"
      ? "text-3xl md:text-4xl"
      : "text-xl sm:text-2xl";
  const companyClass = isCompact
    ? variant === "tv"
      ? "text-sm"
      : "text-xs sm:text-sm"
    : variant === "tv"
      ? "text-lg md:text-xl"
      : "text-sm sm:text-base";
  const bultosNumClass = isCompact
    ? "text-base sm:text-lg"
    : variant === "tv"
      ? "text-3xl md:text-4xl"
      : "text-xl sm:text-2xl";

  return (
    <div className="flex min-w-0 items-start gap-2 sm:gap-2.5">
      {queuePosition != null ? (
        <div
          className={`flex shrink-0 items-center justify-center rounded-lg border-2 font-black tabular-nums leading-none text-white ${
            isCompact ? "h-8 w-8 border-slate-700 bg-slate-800 text-sm" : "h-10 w-10 border-slate-700 bg-slate-800 text-lg"
          }`}
          title={`Posición ${queuePosition} en fila`}
          aria-label={`Posición ${queuePosition} en fila`}
        >
          {queuePosition}
        </div>
      ) : null}

      <div className="min-w-0 flex-1">
        <div
          className={`flex min-w-0 items-center gap-2 ${
            isCompact && mainCompanyLabel ? "flex-wrap sm:flex-nowrap" : "flex-wrap"
          }`}
        >
          <div className="flex shrink-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {orNum != null ? (
              <div
                className={`flex items-baseline gap-1 font-black leading-none tracking-tight text-slate-900 dark:text-slate-50 ${orTitleClass}`}
              >
                <span>OR</span>
                <span className="tabular-nums">#{orNum}</span>
              </div>
            ) : (
              <p
                className={`font-black leading-none tracking-tight text-slate-900 dark:text-slate-50 ${orTitleClass}`}
              >
                {truck.plate}
              </p>
            )}
            {isCollection ? (
              <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-white">
                Rec
              </span>
            ) : null}
          </div>

          {mainCompanyLabel ? (
            <p
              className={`min-w-0 flex-1 truncate font-semibold text-slate-700 dark:text-slate-200 ${companyClass}`}
              title={mainCompanyLabel}
            >
              {mainCompanyLabel}
            </p>
          ) : null}

          <BultosPill
            count={truck.expectedBultos}
            variant={variant}
            density={density}
            className={bultosBadgeClassName}
          />
        </div>

        {secondaryCompanyLabel ? (
          <p className="mt-0.5 truncate text-xs font-medium text-slate-500 dark:text-slate-400">
            {secondaryCompanyLabel}
          </p>
        ) : null}

        {!isCollection && truck.ra?.trim() ? (
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            RA {truck.ra}
          </p>
        ) : null}

        {!isCompact && truck.warehouseReceiptNumber ? (
          <div className="mt-2">
            <span className="rounded-lg bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-800">
              {truck.warehouseReceiptNumber}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DenseQueueRow({
  truck,
  orNum,
  isCollection,
  mainCompanyLabel,
  queuePosition,
  variant,
}: {
  truck: ReceptionTruck;
  orNum: string | null;
  isCollection: boolean;
  mainCompanyLabel: string | null;
  queuePosition?: number;
  variant: "operator" | "tv";
}) {
  const orClass =
    variant === "tv" ? "text-base md:text-lg" : "text-sm sm:text-base";

  return (
    <div className="flex min-w-0 items-center gap-2">
      {queuePosition != null ? (
        <div
          className={`flex shrink-0 items-center justify-center rounded-md bg-slate-800 font-black tabular-nums leading-none text-white ${
            variant === "tv" ? "h-8 w-8 text-sm" : "h-7 w-7 text-xs"
          }`}
          title={`Posición ${queuePosition}`}
          aria-label={`Posición ${queuePosition}`}
        >
          {queuePosition}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="flex shrink-0 items-baseline gap-1">
          {orNum != null ? (
            <span
              className={`whitespace-nowrap font-black leading-none text-slate-900 ${orClass}`}
            >
              OR <span className="tabular-nums">#{orNum}</span>
            </span>
          ) : (
            <span className={`whitespace-nowrap font-black text-slate-900 ${orClass}`}>
              {truck.plate}
            </span>
          )}
          {isCollection ? (
            <span className="ml-1 rounded bg-indigo-600 px-1 py-px text-[7px] font-black uppercase text-white">
              Rec
            </span>
          ) : null}
        </div>

        <p
          className={`min-w-0 flex-1 truncate font-semibold uppercase tracking-wide text-slate-600 ${
            variant === "tv" ? "text-sm md:text-base" : "text-[11px] sm:text-xs"
          }`}
          title={mainCompanyLabel ?? undefined}
        >
          {mainCompanyLabel ?? "—"}
        </p>
      </div>

      <BultosPill count={truck.expectedBultos} variant={variant} density="dense" />
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

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-lg border font-black tabular-nums leading-none ${
        variant === "tv"
          ? "border-violet-200 bg-violet-50 text-violet-800"
          : "border-slate-200 bg-white text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
      } ${
        isDense
          ? "px-2 py-1 text-sm"
          : isCompact
            ? "px-2 py-0.5 text-base"
            : "px-2.5 py-1 text-lg"
      } ${className}`}
    >
      <span>{count}</span>
      <span
        className={`font-bold uppercase tracking-wider text-slate-400 ${
          isDense ? "text-[8px]" : "text-[9px]"
        }`}
      >
        bult
      </span>
    </span>
  );
}
