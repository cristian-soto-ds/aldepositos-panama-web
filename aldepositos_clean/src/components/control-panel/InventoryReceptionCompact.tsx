"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Boxes, CheckCircle2, Package, Scale } from "lucide-react";
import { M3Unit } from "@/components/control-panel/inventorySummaryUnits";

function diffTone(faltantes: number): "ok" | "pending" | "error" {
  if (faltantes === 0) return "ok";
  if (faltantes > 0) return "pending";
  return "error";
}

function diffMessage(faltantes: number): string {
  if (faltantes === 0) return "Captura completa — coincide con lo declarado";
  if (faltantes > 0) return `Faltan ${faltantes} bulto${faltantes === 1 ? "" : "s"} por registrar`;
  return `${Math.abs(faltantes)} bulto${Math.abs(faltantes) === 1 ? "" : "s"} de más en la captura`;
}

export type InventoryReceptionCompactProps = {
  leadingIcon: ReactNode;
  badge: string;
  provider: string;
  brand: string;
  expectedCbm: string | number;
  expectedWeight: string | number;
  subClient: string;
  notes?: string | null;
  captureEyebrow?: string;
  declared: number;
  physical: number;
  faltantes: number;
  totalCbm: string | number;
  totalWeight: number;
  totalWeightDecimals?: number;
  showTotalUnidades?: boolean;
  totalUnidades?: number;
  totalsSectionTitle?: string;
  /** Textos más legibles, barra de progreso y mensaje de estado (ingreso rápido). */
  friendly?: boolean;
};

export function InventoryReceptionCompact({
  leadingIcon,
  badge,
  provider,
  brand,
  expectedCbm,
  expectedWeight,
  subClient,
  notes,
  captureEyebrow = "Resumen de recepción",
  declared,
  physical,
  faltantes,
  totalCbm,
  totalWeight,
  totalWeightDecimals = 1,
  showTotalUnidades = false,
  totalUnidades = 0,
  totalsSectionTitle = "Totales tabla",
  friendly = false,
}: InventoryReceptionCompactProps) {
  const state = diffTone(faltantes);
  const progressPct =
    declared > 0 ? Math.min(100, Math.round((physical / declared) * 100)) : physical > 0 ? 100 : 0;

  const diffWrap =
    state === "ok"
      ? "border-emerald-200/90 bg-emerald-50/80 dark:border-emerald-900/50 dark:bg-emerald-950/30"
      : state === "pending"
        ? "border-amber-200/90 bg-amber-50/90 dark:border-amber-900/45 dark:bg-amber-950/25"
        : "border-red-200/90 bg-red-50/90 dark:border-red-900/45 dark:bg-red-950/25";

  const diffNum =
    state === "ok"
      ? "text-emerald-800 dark:text-emerald-300"
      : state === "pending"
        ? "text-amber-900 dark:text-amber-200"
        : "text-red-700 dark:text-red-300";

  const notesFull = [subClient, notes].filter(Boolean).join(" · ");
  const labelClass = friendly
    ? "text-[10px] font-semibold text-slate-500 dark:text-slate-400 sm:text-[11px]"
    : "text-[8px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400 sm:text-[9px]";

  if (friendly) {
    return (
      <FriendlyReceptionBar
        leadingIcon={leadingIcon}
        badge={badge}
        provider={provider}
        brand={brand}
        expectedCbm={expectedCbm}
        expectedWeight={expectedWeight}
        notesFull={notesFull}
        declared={declared}
        physical={physical}
        faltantes={faltantes}
        progressPct={progressPct}
        state={state}
        totalCbm={totalCbm}
        totalWeight={totalWeight}
        totalWeightDecimals={totalWeightDecimals}
        showTotalUnidades={showTotalUnidades}
        totalUnidades={totalUnidades}
      />
    );
  }

  return (
    <section
      className={`shrink-0 overflow-hidden border border-slate-200/90 bg-gradient-to-b from-slate-50/90 to-white shadow-sm ring-1 ring-slate-900/[0.03] dark:border-slate-600 dark:from-slate-900 dark:to-slate-950 dark:ring-white/[0.04] ${
        friendly ? "rounded-xl sm:rounded-2xl" : "rounded-lg sm:rounded-xl"
      }`}
      role="region"
      aria-label="Resumen de documento y captura"
    >
      <div className={`flex flex-col ${friendly ? "gap-3 p-3 sm:p-4" : "gap-1.5 p-1.5 sm:gap-2 sm:p-2"}`}>
        <div
          className={`flex min-w-0 flex-col gap-1 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between ${
            friendly ? "border-b border-slate-200/80 pb-3 dark:border-slate-700/90" : "border-b border-slate-200/80 pb-1.5 dark:border-slate-700/90"
          }`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`flex shrink-0 items-center justify-center rounded-lg bg-[#16263F] text-white shadow-sm ring-1 ring-[#16263F]/30 ${
                friendly ? "h-9 w-9 [&_svg]:h-4 [&_svg]:w-4" : "h-7 w-7 [&_svg]:h-3 [&_svg]:w-3"
              }`}
            >
              {leadingIcon}
            </span>
            <div className="min-w-0">
              <p
                className={`min-w-0 text-balance text-[#16263F] dark:text-slate-100 ${
                  friendly
                    ? "text-sm font-bold sm:text-base"
                    : "text-[9px] font-black uppercase tracking-wide sm:text-[10px]"
                }`}
              >
                {friendly ? "Información del documento" : "Datos originales"}
              </p>
              {friendly ? (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">
                  Datos declarados en la orden de recolección
                </p>
              ) : null}
            </div>
          </div>
          <span
            className={`inline-flex w-full min-w-0 items-center justify-center rounded-full border border-blue-200/80 bg-blue-50/95 text-center text-blue-900 dark:border-blue-800/60 dark:bg-blue-950/50 dark:text-blue-100 min-[420px]:w-auto ${
              friendly
                ? "px-3 py-1 text-[10px] font-semibold sm:text-xs"
                : "px-2 py-0.5 text-[8px] font-black uppercase leading-snug tracking-wide sm:text-[9px]"
            }`}
          >
            {badge}
          </span>
        </div>

        <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <dl className="grid min-w-0 grid-cols-1 gap-2 min-[440px]:grid-cols-2 xl:grid-cols-4 xl:gap-x-2">
              <div
                className={`min-w-0 rounded-lg border border-slate-200/90 bg-white/80 dark:border-slate-600 dark:bg-slate-900/60 ${
                  friendly ? "px-2.5 py-2" : "px-1.5 py-1 min-[440px]:min-h-[3.25rem] xl:min-h-0"
                }`}
              >
                <dt className={labelClass}>Proveedor / naviera</dt>
                <dd
                  className={`mt-0.5 break-words font-bold leading-snug text-[#16263F] dark:text-slate-100 ${
                    friendly
                      ? "line-clamp-2 text-xs sm:text-sm"
                      : "line-clamp-4 text-[11px] min-[440px]:line-clamp-3 min-[440px]:min-h-[2.35rem] xl:line-clamp-2 xl:min-h-0 sm:text-xs"
                  }`}
                >
                  {provider}
                </dd>
              </div>
              <div
                className={`min-w-0 rounded-lg border border-slate-200/90 bg-white/80 dark:border-slate-600 dark:bg-slate-900/60 ${
                  friendly ? "px-2.5 py-2" : "px-1.5 py-1 min-[440px]:min-h-[3.25rem] xl:min-h-0"
                }`}
              >
                <dt className={labelClass}>Marca · tracking</dt>
                <dd
                  className={`mt-0.5 break-words font-bold leading-snug text-[#16263F] dark:text-slate-100 ${
                    friendly
                      ? "line-clamp-2 text-xs sm:text-sm"
                      : "line-clamp-4 text-[11px] min-[440px]:line-clamp-3 min-[440px]:min-h-[2.35rem] xl:line-clamp-2 xl:min-h-0 sm:text-xs"
                  }`}
                >
                  {brand}
                </dd>
              </div>
              <div
                className={`min-w-0 rounded-lg border border-sky-200/80 bg-sky-50/90 dark:border-sky-800/50 dark:bg-sky-950/35 ${
                  friendly ? "px-2.5 py-2" : "px-1.5 py-1"
                }`}
              >
                <dt
                  className={
                    friendly
                      ? "text-[10px] font-semibold text-sky-800 dark:text-sky-200/90 sm:text-[11px]"
                      : "text-[8px] font-black uppercase tracking-wide text-sky-800 dark:text-sky-200/90 sm:text-[9px]"
                  }
                >
                  Volumen documentado
                </dt>
                <dd className="mt-0.5 flex flex-wrap items-baseline gap-0.5 text-[11px] font-black tabular-nums text-sky-950 dark:text-sky-100 sm:text-xs">
                  {expectedCbm}
                  <M3Unit
                    size="sm"
                    className="text-[9px] font-black text-sky-800 dark:text-sky-300 sm:text-[10px]"
                  />
                </dd>
              </div>
              <div
                className={`min-w-0 rounded-lg border border-slate-200/90 bg-white/80 dark:border-slate-600 dark:bg-slate-900/60 ${
                  friendly ? "px-2.5 py-2" : "px-1.5 py-1"
                }`}
              >
                <dt className={labelClass}>Peso documentado</dt>
                <dd className="mt-0.5 text-[11px] font-black tabular-nums text-slate-900 dark:text-slate-100 sm:text-xs">
                  {expectedWeight}
                  <span className="ml-0.5 text-[9px] font-bold text-slate-500 dark:text-slate-400">
                    kg
                  </span>
                </dd>
              </div>
            </dl>

            {notesFull ? (
              <div
                className={`rounded-lg border border-dashed border-amber-300/80 bg-amber-50/55 dark:border-amber-800/50 dark:bg-amber-950/25 ${
                  friendly ? "px-2.5 py-2" : "px-1.5 py-1"
                }`}
                title={notesFull}
              >
                <p
                  className={
                    friendly
                      ? "text-[10px] font-semibold text-amber-900 dark:text-amber-200/95 sm:text-[11px]"
                      : "text-[8px] font-black uppercase tracking-wide text-amber-900 dark:text-amber-200/95 sm:text-[9px]"
                  }
                >
                  Expedidor · notas
                </p>
                <div
                  className={`mt-0.5 overflow-x-hidden overflow-y-auto overscroll-contain text-left font-semibold leading-snug text-amber-950/95 dark:text-amber-50/95 ${
                    friendly
                      ? "max-h-[4rem] text-xs sm:max-h-[4.5rem] sm:text-sm"
                      : "max-h-[3.25rem] text-[11px] sm:max-h-[3.5rem] sm:text-xs"
                  }`}
                >
                  {subClient}
                  {notes ? (
                    <>
                      <span className="mx-1 inline font-light text-amber-700/55 dark:text-amber-500/45">
                        |
                      </span>
                      {notes}
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div
            className={`flex min-w-0 w-full shrink-0 flex-col items-center gap-2 border-t border-slate-200/80 pt-2 text-center dark:border-slate-700 lg:w-[min(100%,22rem)] lg:border-l lg:border-t-0 lg:pl-3 lg:pt-0 ${
              friendly ? "gap-2.5" : "gap-1.5 pt-1.5"
            }`}
          >
            <div
              className={`w-full rounded-lg bg-[#16263F] shadow-sm ${friendly ? "px-3 py-1.5" : "rounded-md px-2 py-1"}`}
            >
              <p
                className={
                  friendly
                    ? "text-xs font-semibold text-white/95 sm:text-sm"
                    : "text-[9px] font-bold uppercase tracking-[0.12em] text-white/90 sm:text-[10px]"
                }
              >
                {captureEyebrow}
              </p>
            </div>

            {friendly && declared > 0 ? (
              <div className="w-full space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-medium text-slate-600 dark:text-slate-300 sm:text-xs">
                  <span>
                    {physical} de {declared} bultos capturados
                  </span>
                  <span className="font-bold tabular-nums text-[#16263F] dark:text-slate-100">
                    {progressPct}%
                  </span>
                </div>
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-slate-200/90 dark:bg-slate-700"
                  role="progressbar"
                  aria-valuenow={progressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Progreso de captura de bultos"
                >
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      state === "ok"
                        ? "bg-emerald-500"
                        : state === "pending"
                          ? "bg-amber-500"
                          : "bg-red-500"
                    }`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p
                  className={`flex items-center justify-center gap-1.5 text-[11px] font-medium sm:text-xs ${
                    state === "ok"
                      ? "text-emerald-700 dark:text-emerald-300"
                      : state === "pending"
                        ? "text-amber-800 dark:text-amber-200"
                        : "text-red-700 dark:text-red-300"
                  }`}
                >
                  {state === "ok" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  ) : null}
                  {diffMessage(faltantes)}
                </p>
              </div>
            ) : null}

            <div className="grid w-full min-w-0 grid-cols-3 gap-1.5 sm:gap-2">
              <div
                className={`flex min-h-0 min-w-0 flex-col items-center gap-1 rounded-lg border border-slate-200/95 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-900 ${
                  friendly ? "px-2 py-2" : "rounded-md px-1.5 py-1.5"
                }`}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200/90 bg-slate-50/80 text-slate-600 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-300"
                  aria-hidden
                >
                  <Package className="h-3 w-3" strokeWidth={1.5} />
                </span>
                <span
                  className={`w-full text-center leading-tight text-slate-600 dark:text-slate-300 ${
                    friendly
                      ? "text-[10px] font-semibold sm:text-[11px]"
                      : "text-[7px] font-black uppercase tracking-wide sm:text-[8px]"
                  }`}
                >
                  {friendly ? "Declarados" : (
                    <>
                      <span className="md:hidden">Decl.</span>
                      <span className="hidden md:inline">Declarados</span>
                    </>
                  )}
                </span>
                <p className="w-full border-t border-slate-200/80 pt-1 text-center text-sm font-black tabular-nums leading-none text-[#16263F] dark:border-slate-600/80 dark:text-slate-100 sm:text-base">
                  {declared}
                </p>
              </div>
              <div
                className={`flex min-h-0 min-w-0 flex-col items-center gap-1 rounded-lg border border-violet-200/90 bg-violet-50/50 shadow-sm dark:border-violet-800/50 dark:bg-violet-950/35 ${
                  friendly ? "px-2 py-2" : "rounded-md px-1.5 py-1.5"
                }`}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-violet-200/90 bg-white/70 text-violet-700 dark:border-violet-700/60 dark:bg-violet-950/40 dark:text-violet-300"
                  aria-hidden
                >
                  <Boxes className="h-3 w-3" strokeWidth={1.5} />
                </span>
                <span
                  className={`w-full text-center leading-tight text-violet-900 dark:text-violet-200 ${
                    friendly
                      ? "text-[10px] font-semibold sm:text-[11px]"
                      : "text-[7px] font-black uppercase sm:text-[8px]"
                  }`}
                >
                  {friendly ? "Capturados" : (
                    <>
                      <span className="md:hidden">Fís.</span>
                      <span className="hidden md:inline">Físicos</span>
                    </>
                  )}
                </span>
                <p className="w-full border-t border-violet-200/70 pt-1 text-center text-sm font-black tabular-nums leading-none text-violet-950 dark:border-violet-800/50 dark:text-violet-100 sm:text-base">
                  {physical}
                </p>
              </div>
              <div
                className={`flex min-h-0 min-w-0 flex-col items-center gap-1 rounded-lg border shadow-sm ${diffWrap} ${
                  friendly ? "px-2 py-2" : "rounded-md px-1.5 py-1.5"
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border bg-white/60 dark:bg-slate-900/50 ${
                    state === "ok"
                      ? "border-emerald-300/90 text-emerald-700 dark:border-emerald-700/50 dark:text-emerald-400"
                      : state === "pending"
                        ? "border-amber-300/90 text-amber-700 dark:border-amber-700/50 dark:text-amber-300"
                        : "border-red-300/90 text-red-600 dark:border-red-700/50 dark:text-red-400"
                  }`}
                  aria-hidden
                >
                  <Scale className="h-3 w-3" strokeWidth={1.5} />
                </span>
                <span
                  className={`w-full text-center leading-tight text-slate-800 dark:text-slate-100 ${
                    friendly
                      ? "text-[10px] font-semibold sm:text-[11px]"
                      : "text-[7px] font-black uppercase sm:text-[8px]"
                  }`}
                >
                  Diferencia
                </span>
                <p
                  className={`w-full border-t pt-1 text-center text-base font-black tabular-nums leading-none sm:text-lg ${diffNum} ${
                    state === "ok"
                      ? "border-emerald-200/60 dark:border-emerald-800/40"
                      : state === "pending"
                        ? "border-amber-200/60 dark:border-amber-800/40"
                        : "border-red-200/60 dark:border-red-800/40"
                  }`}
                >
                  {faltantes}
                </p>
              </div>
            </div>

            <div
              className={`w-full rounded-lg border border-slate-200 bg-slate-50/90 dark:border-slate-600 dark:bg-slate-800/80 ${
                friendly ? "px-2.5 py-2" : "rounded-md px-1.5 py-1 sm:px-2"
              }`}
            >
              <p
                className={
                  friendly
                    ? "text-[10px] font-semibold text-slate-500 dark:text-slate-400 sm:text-[11px]"
                    : "text-[8px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 sm:text-[9px]"
                }
              >
                {friendly ? "Totales de la tabla" : totalsSectionTitle}
              </p>
              <div className="mt-1 flex flex-col items-center gap-1 text-[11px] font-black tabular-nums text-[#16263F] dark:text-slate-100 min-[400px]:flex-row min-[400px]:flex-wrap min-[400px]:justify-center min-[400px]:gap-x-3 min-[400px]:gap-y-0.5 sm:text-xs">
                {showTotalUnidades ? (
                  <span className="inline-flex flex-wrap items-baseline justify-center gap-1 border-b border-slate-200/80 pb-1 min-[400px]:border-0 min-[400px]:pb-0 dark:border-slate-600">
                    <span className="text-[9px] font-bold uppercase text-slate-500 dark:text-slate-400">
                      Unidades
                    </span>
                    {totalUnidades}
                  </span>
                ) : null}
                <span className="inline-flex flex-wrap items-baseline justify-center gap-0.5 border-b border-slate-200/80 pb-1 min-[400px]:border-0 min-[400px]:pb-0 dark:border-slate-600">
                  <span
                    className={
                      friendly
                        ? "text-[10px] font-semibold text-slate-500 dark:text-slate-400"
                        : "text-[9px] font-bold uppercase text-slate-500 dark:text-slate-400"
                    }
                  >
                    Volumen
                  </span>
                  {Number(totalCbm).toFixed(2)}
                  <M3Unit
                    size="sm"
                    className="text-[9px] font-black text-slate-600 dark:text-slate-300 sm:text-[10px]"
                  />
                </span>
                <span className="inline-flex items-baseline justify-center gap-1">
                  <span
                    className={
                      friendly
                        ? "text-[10px] font-semibold text-slate-500 dark:text-slate-400"
                        : "text-[9px] font-bold uppercase text-slate-500 dark:text-slate-400"
                    }
                  >
                    Peso
                  </span>
                  {Number(totalWeight).toFixed(totalWeightDecimals)}
                  <span className="ml-0.5 text-[9px] font-bold text-slate-500 dark:text-slate-400 sm:text-[10px]">
                    kg
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

type FriendlyReceptionBarProps = {
  leadingIcon: ReactNode;
  badge: string;
  provider: string;
  brand: string;
  expectedCbm: string | number;
  expectedWeight: string | number;
  notesFull: string;
  declared: number;
  physical: number;
  faltantes: number;
  progressPct: number;
  state: "ok" | "pending" | "error";
  totalCbm: string | number;
  totalWeight: number;
  totalWeightDecimals: number;
  showTotalUnidades: boolean;
  totalUnidades: number;
};

function FriendlyReceptionBar({
  leadingIcon,
  badge,
  provider,
  brand,
  expectedCbm,
  expectedWeight,
  notesFull,
  declared,
  physical,
  faltantes,
  progressPct,
  state,
  totalCbm,
  totalWeight,
  totalWeightDecimals,
  showTotalUnidades,
  totalUnidades,
}: FriendlyReceptionBarProps) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const progressColor =
    state === "ok"
      ? "bg-emerald-500"
      : state === "pending"
        ? "bg-amber-500"
        : "bg-red-500";

  const diffNumClass =
    state === "ok"
      ? "text-emerald-700 dark:text-emerald-300"
      : state === "pending"
        ? "text-amber-800 dark:text-amber-200"
        : "text-red-700 dark:text-red-300";

  return (
    <section
      className="shrink-0 overflow-hidden rounded-lg border border-slate-200/90 bg-slate-50/50 shadow-sm dark:border-slate-600 dark:bg-slate-900/80"
      role="region"
      aria-label="Resumen de documento y captura"
    >
      {/* Móvil: barra compacta colapsable */}
      <div className="sm:hidden">
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
          aria-expanded={detailsOpen}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#16263F] text-white [&_svg]:h-3 [&_svg]:w-3">
            {leadingIcon}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[#16263F] dark:text-slate-100">
            {provider}
          </span>
          <span className="shrink-0 text-[10px] font-bold tabular-nums text-violet-700 dark:text-violet-300">
            {physical}/{declared}
          </span>
          <span className="shrink-0 text-[10px] font-bold tabular-nums text-slate-600 dark:text-slate-300">
            {progressPct}%
          </span>
          {detailsOpen ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          )}
        </button>
        <div className="px-2.5 pb-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        {detailsOpen ? (
          <div className="space-y-2 border-t border-slate-200/80 px-2.5 py-2 dark:border-slate-700">
            <p className="text-[11px] leading-snug text-[#16263F] dark:text-slate-100">
              <span className="font-semibold">{brand}</span>
            </p>
            <p className="flex flex-wrap gap-x-2 text-[10px] text-slate-600 dark:text-slate-400">
              <span className="font-semibold tabular-nums text-sky-800 dark:text-sky-200">
                {expectedCbm}
                <M3Unit size="sm" className="mx-0.5 text-[8px] font-bold" />
              </span>
              <span className="font-semibold tabular-nums">
                {expectedWeight} kg doc.
              </span>
            </p>
            {notesFull ? (
              <button
                type="button"
                onClick={() => setNotesOpen((v) => !v)}
                className="flex w-full items-start gap-1 text-left text-[10px] leading-snug text-amber-800 dark:text-amber-200/90"
              >
                {notesOpen ? (
                  <ChevronUp className="mt-0.5 h-2.5 w-2.5 shrink-0" aria-hidden />
                ) : (
                  <ChevronDown className="mt-0.5 h-2.5 w-2.5 shrink-0" aria-hidden />
                )}
                <span className={notesOpen ? "whitespace-normal break-words" : "line-clamp-2"}>
                  {notesFull}
                </span>
              </button>
            ) : null}
            <div className="grid grid-cols-3 gap-1 text-center text-[9px] font-semibold uppercase text-slate-500 dark:text-slate-400">
              <span>Decl.</span>
              <span>Cap.</span>
              <span>Dif.</span>
            </div>
            <div className="grid grid-cols-3 gap-1 text-center text-sm font-bold tabular-nums leading-none">
              <span className="text-[#16263F] dark:text-slate-100">{declared}</span>
              <span className="text-violet-700 dark:text-violet-300">{physical}</span>
              <span className={diffNumClass}>{faltantes}</span>
            </div>
            <p className="text-center text-[9px] tabular-nums text-slate-500 dark:text-slate-400">
              {Number(totalCbm).toFixed(2)}
              <M3Unit size="sm" className="mx-0.5 text-[8px]" />
              · {Number(totalWeight).toFixed(totalWeightDecimals)} kg
            </p>
          </div>
        ) : null}
      </div>

      {/* Tablet / desktop */}
      <div className="hidden grid-cols-1 gap-2 px-2.5 py-2 sm:grid sm:grid-cols-[minmax(0,1fr)_11.5rem] sm:items-center sm:gap-3 md:grid-cols-[minmax(0,1fr)_13rem] lg:grid-cols-[minmax(0,1fr)_14rem]">
        {/* Documento */}
        <div className="flex min-w-0 items-start gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#16263F] text-white [&_svg]:h-3 [&_svg]:w-3">
            {leadingIcon}
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p
              className="truncate text-xs font-semibold leading-snug text-[#16263F] dark:text-slate-100"
              title={`${provider} · ${brand}`}
            >
              {provider}
              <span className="font-normal text-slate-400 dark:text-slate-500"> · </span>
              {brand}
            </p>
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0 text-[10px] text-slate-600 dark:text-slate-400 sm:text-[11px]">
              <span className="inline-flex items-baseline gap-0.5 font-semibold tabular-nums text-sky-800 dark:text-sky-200">
                {expectedCbm}
                <M3Unit size="sm" className="text-[8px] font-bold" />
              </span>
              <span className="text-slate-300 dark:text-slate-600" aria-hidden>
                ·
              </span>
              <span className="font-semibold tabular-nums">
                {expectedWeight}
                <span className="ml-0.5 font-medium text-slate-400">kg</span>
              </span>
              <span className="hidden text-slate-300 dark:text-slate-600 sm:inline" aria-hidden>
                ·
              </span>
              <span
                className="hidden max-w-[8rem] truncate rounded-full border border-blue-200/70 bg-blue-50/80 px-1.5 py-px text-[9px] font-medium text-blue-800 dark:border-blue-800/50 dark:bg-blue-950/40 dark:text-blue-100 sm:inline"
                title={badge}
              >
                {badge}
              </span>
            </p>
            {notesFull ? (
              <button
                type="button"
                onClick={() => setNotesOpen((v) => !v)}
                className="flex max-w-full items-center gap-0.5 text-left text-[10px] leading-snug text-amber-800 hover:text-amber-900 dark:text-amber-200/90 dark:hover:text-amber-100"
                title={notesFull}
              >
                {notesOpen ? (
                  <ChevronUp className="h-2.5 w-2.5 shrink-0" aria-hidden />
                ) : (
                  <ChevronDown className="h-2.5 w-2.5 shrink-0" aria-hidden />
                )}
                <span className={notesOpen ? "whitespace-normal break-words" : "truncate"}>
                  {notesFull}
                </span>
              </button>
            ) : null}
          </div>
        </div>

        {/* Progreso y totales — panel fijo a la derecha */}
        <div className="rounded-md border border-slate-200/90 bg-white px-2 py-1.5 dark:border-slate-600 dark:bg-slate-950/50">
          <div className="mb-1 grid grid-cols-3 gap-0.5 text-center text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <span>Decl.</span>
            <span>Cap.</span>
            <span>Dif.</span>
          </div>
          <div className="mb-1.5 grid grid-cols-3 gap-0.5 text-center text-sm font-bold tabular-nums leading-none">
            <span className="text-[#16263F] dark:text-slate-100">{declared}</span>
            <span className="text-violet-700 dark:text-violet-300">{physical}</span>
            <span className={diffNumClass}>{faltantes}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div
              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progreso de captura de bultos"
            >
              <div
                className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="shrink-0 text-[10px] font-bold tabular-nums text-slate-700 dark:text-slate-200">
              {progressPct}%
            </span>
          </div>
          <p className="mt-1 truncate text-center text-[9px] tabular-nums text-slate-500 dark:text-slate-400">
            {physical}/{declared} bultos
            <span className="mx-1 text-slate-300 dark:text-slate-600">·</span>
            {Number(totalCbm).toFixed(2)}
            <M3Unit size="sm" className="mx-px text-[8px]" />
            {Number(totalWeight).toFixed(totalWeightDecimals)} kg
            {showTotalUnidades ? (
              <>
                <span className="mx-1 text-slate-300 dark:text-slate-600">·</span>
                {totalUnidades} und.
              </>
            ) : null}
          </p>
        </div>
      </div>
    </section>
  );
}
