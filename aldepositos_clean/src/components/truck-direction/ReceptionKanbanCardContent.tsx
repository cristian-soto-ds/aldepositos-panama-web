"use client";

import React from "react";
import {
  isCollectionOrderReceptionTruck,
  isGroupedReceptionTruck,
} from "@/lib/receptionLogistics/syncCollectionOrderReception";
import type { ReceptionTruck } from "@/lib/receptionLogistics/types";

export type ReceptionCardDensity = "normal" | "compact" | "dense";

function displayLabel(value: string | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed && trimmed !== "—" ? trimmed : null;
}

function looksLikeOrPlate(plate: string): boolean {
  return /^OR\s*#/i.test(plate.trim()) || /^\d+\s*OR$/i.test(plate.trim());
}

function resolveOrderLines(
  truck: ReceptionTruck,
): Array<{ numero: string; bultos: number; cliente?: string }> {
  if (truck.orderLines && truck.orderLines.length > 0) {
    return truck.orderLines;
  }
  if (truck.orderNumeros && truck.orderNumeros.length > 0) {
    const n = truck.orderNumeros.length;
    const each =
      n === 1
        ? truck.expectedBultos
        : Math.round(truck.expectedBultos / n);
    return truck.orderNumeros.map((numero, i) => ({
      numero,
      bultos:
        n === 1
          ? truck.expectedBultos
          : i === n - 1
            ? truck.expectedBultos - each * (n - 1)
            : each,
    }));
  }
  const match = /^OR\s*#\s*(.+)$/i.exec(truck.plate.trim());
  if (match) {
    return [{ numero: match[1]!.trim(), bultos: truck.expectedBultos }];
  }
  return [];
}

/** Título visible: proveedor (nunca el nº de OR). */
function resolveProviderTitle(truck: ReceptionTruck): string {
  const fromProvider = displayLabel(truck.provider);
  if (fromProvider) return fromProvider;
  const fromPlate = displayLabel(truck.plate);
  if (fromPlate && !looksLikeOrPlate(fromPlate)) return fromPlate;
  return "Sin proveedor";
}

/**
 * Escala tipográfica: proveedor = base; OR = un peldaño más chico.
 * La OR nunca supera al proveedor.
 */
type TitleScale = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

const PROVIDER_SCALE_CLASS: Record<TitleScale, string> = {
  xs: "text-[11px] md:text-xs",
  sm: "text-xs md:text-sm",
  md: "text-sm md:text-[15px]",
  lg: "text-[15px] md:text-base",
  xl: "text-base md:text-lg",
  "2xl": "text-lg md:text-xl",
};

const OR_SCALE_CLASS: Record<TitleScale, string> = {
  xs: "text-[10px] md:text-[11px]",
  sm: "text-[11px] md:text-xs",
  md: "text-xs md:text-sm",
  lg: "text-sm md:text-[15px]",
  xl: "text-[15px] md:text-base",
  "2xl": "text-base md:text-lg",
};

function resolveTitleScale(
  name: string,
  density: ReceptionCardDensity,
  isTv: boolean,
): TitleScale {
  const len = name.length;

  if (density === "dense") {
    if (len > 36) return "xs";
    if (len > 24) return "sm";
    return "md";
  }

  if (density === "compact" || isTv) {
    if (len > 42) return "xs";
    if (len > 32) return "sm";
    if (len > 22) return "md";
    if (len > 14) return "lg";
    return isTv ? "xl" : "lg";
  }

  if (len > 40) return "sm";
  if (len > 28) return "md";
  if (len > 18) return "lg";
  return isTv ? "2xl" : "xl";
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
  const isGroup = isGroupedReceptionTruck(truck);
  const lines = isCollection ? resolveOrderLines(truck) : [];
  const providerTitle = isCollection
    ? resolveProviderTitle(truck)
    : truck.plate;
  const client = displayLabel(truck.client);
  const secondaryCompanyLabel =
    !isCollection && client && client !== truck.plate ? client : null;

  const isDense = density === "dense";
  const isCompact = density === "compact";
  const isTv = variant === "tv";

  const titleScale = resolveTitleScale(providerTitle, density, isTv);
  const titleClass = `break-words font-extrabold leading-snug tracking-tight text-inherit ${PROVIDER_SCALE_CLASS[titleScale]}`;
  const orClass = `break-words font-bold leading-snug tabular-nums text-inherit ${OR_SCALE_CLASS[titleScale]}`;

  const queueSize = isDense
    ? "h-6 w-6 text-[10px] rounded"
    : isCompact
      ? "h-7 w-7 text-[11px] rounded-md"
      : "h-8 w-8 text-xs rounded-md";

  /** Unificado = varias OR en el mismo camión. */
  const isUnified = isCollection && (isGroup || lines.length > 1);
  const consigneeLabel =
    isCollection && !isUnified && client && client !== providerTitle
      ? client
      : null;
  const singleOr = isCollection && !isUnified && lines.length === 1 ? lines[0]! : null;

  return (
    <div className="flex min-w-0 items-start gap-2">
      {queuePosition != null ? (
        <div
          className={`mt-0.5 flex shrink-0 items-center justify-center border border-slate-700 bg-slate-800 font-black tabular-nums leading-none text-white ${queueSize}`}
          title={`Posición ${queuePosition} en fila`}
          aria-label={`Posición ${queuePosition} en fila`}
        >
          {queuePosition}
        </div>
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className={titleClass} title={providerTitle}>
              {providerTitle}
            </p>

            {consigneeLabel ? (
              <p
                className={`mt-0.5 break-words font-semibold leading-snug tracking-tight text-inherit opacity-70 ${OR_SCALE_CLASS[titleScale]}`}
                title={consigneeLabel}
              >
                {consigneeLabel}
              </p>
            ) : null}

            {/* Imagen 1: un solo pedido → «Camión» + OR */}
            {singleOr ? (
              <p className={`mt-1 ${orClass}`}>
                <span className="font-extrabold opacity-55">Camión</span>
                <span className="mx-1.5 font-semibold opacity-30">·</span>
                <span className="font-bold opacity-55">OR</span>{" "}
                <span className="font-extrabold">#{singleOr.numero}</span>
              </p>
            ) : null}

            {/* Imagen 2/3: unificado → listado vertical OR + bultos; total a la derecha */}
            {isUnified && lines.length > 0 ? (
              <div className="mt-1.5 min-w-0">
                <p
                  className={`mb-1 font-extrabold uppercase tracking-wide text-inherit opacity-50 ${
                    isDense ? "text-[9px]" : "text-[10px]"
                  }`}
                >
                  {lines.length} OR · un camión
                </p>
                <ul
                  className={`overflow-hidden rounded-lg border border-black/[0.07] bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.05] ${
                    isDense && lines.length > 5
                      ? "max-h-[7.5rem] overflow-y-auto"
                      : ""
                  }`}
                >
                  {lines.map((line, i) => {
                    const lineClient = displayLabel(line.cliente);
                    return (
                    <li
                      key={`${line.numero}-${line.bultos}-${i}`}
                      className={`flex items-center gap-2 px-2.5 ${orClass} ${
                        i > 0
                          ? "border-t border-black/[0.06] dark:border-white/10"
                          : ""
                      } ${isDense ? "py-1" : "py-1.5"}`}
                    >
                      <span className="w-[5.75rem] shrink-0 truncate sm:w-[6.5rem]">
                        <span className="font-bold opacity-55">OR</span>{" "}
                        <span className="font-extrabold">#{line.numero}</span>
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-left font-semibold tracking-tight opacity-80"
                        title={lineClient ?? undefined}
                      >
                        {lineClient ?? ""}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        <span className="font-extrabold">{line.bultos}</span>{" "}
                        <span className="text-[9px] font-bold uppercase tracking-wide opacity-45">
                          bult
                        </span>
                      </span>
                    </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {secondaryCompanyLabel ? (
              <p
                className={`mt-0.5 break-words font-medium text-inherit opacity-65 ${OR_SCALE_CLASS[titleScale]}`}
              >
                {secondaryCompanyLabel}
              </p>
            ) : null}

            {!isCollection && truck.ra?.trim() ? (
              <p
                className={`mt-0.5 font-medium uppercase tracking-wide text-inherit opacity-55 ${OR_SCALE_CLASS[titleScale]}`}
              >
                RA {truck.ra}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1">
            <BultosPill
              count={truck.expectedBultos}
              variant={variant}
              density={density}
              className={bultosBadgeClassName}
            />
          </div>
        </div>
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
      className={`inline-flex shrink-0 flex-col items-center justify-center rounded-md border font-bold tabular-nums leading-none ${
        themedBadge
          ? className
          : variant === "tv"
            ? "border-slate-200 bg-slate-50 text-slate-800"
            : "border-slate-200 bg-white text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      } ${
        isDense
          ? "min-w-[2.5rem] px-1.5 py-0.5"
          : isCompact
            ? "min-w-[2.75rem] px-1.5 py-1"
            : "min-w-[3rem] px-2 py-1"
      }`}
      title={`${count} bultos en total a entregar`}
    >
      <span className={isDense ? "text-xs" : isCompact ? "text-sm" : "text-base"}>
        {count}
      </span>
      <span className="mt-0.5 text-[7px] font-semibold uppercase tracking-wider opacity-50">
        bult
      </span>
    </span>
  );
}
