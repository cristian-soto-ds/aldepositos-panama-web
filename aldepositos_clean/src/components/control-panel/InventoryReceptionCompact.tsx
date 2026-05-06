"use client";

import type { ReactNode } from "react";
import { Boxes, Package, Scale } from "lucide-react";
import { M3Unit } from "@/components/control-panel/inventorySummaryUnits";

function diffTone(faltantes: number): "ok" | "pending" | "error" {
  if (faltantes === 0) return "ok";
  if (faltantes > 0) return "pending";
  return "error";
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
}: InventoryReceptionCompactProps) {
  const state = diffTone(faltantes);

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

  return (
    <section
      className="shrink-0 overflow-hidden rounded-lg border border-slate-200/90 bg-gradient-to-b from-slate-50/90 to-white dark:border-slate-600 dark:from-slate-900 dark:to-slate-950 shadow-sm ring-1 ring-slate-900/[0.03] dark:ring-white/[0.04] sm:rounded-xl"
      role="region"
      aria-label="Resumen de documento y captura"
    >
      <div className="flex flex-col gap-1.5 p-1.5 sm:gap-2 sm:p-2">
        <div className="flex min-w-0 flex-col gap-1 border-b border-slate-200/80 pb-1.5 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between dark:border-slate-700/90">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#16263F] text-white shadow-sm ring-1 ring-[#16263F]/30 [&_svg]:h-3 [&_svg]:w-3">
              {leadingIcon}
            </span>
            <p className="min-w-0 text-balance text-[9px] font-black uppercase tracking-wide text-[#16263F] dark:text-slate-100 sm:text-[10px]">
              Datos originales
            </p>
          </div>
          <span className="inline-flex w-full min-w-0 items-center justify-center rounded-full border border-blue-200/80 bg-blue-50/95 px-2 py-0.5 text-center text-[8px] font-black uppercase leading-snug tracking-wide text-blue-900 dark:border-blue-800/60 dark:bg-blue-950/50 dark:text-blue-100 min-[420px]:w-auto sm:text-[9px]">
            {badge}
          </span>
        </div>

        <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-2.5">
          <div className="min-w-0 flex-1 space-y-1.5">
            <dl className="grid min-w-0 grid-cols-1 gap-1 min-[440px]:grid-cols-2 xl:grid-cols-4 xl:gap-x-2">
              <div className="min-w-0 rounded-md border border-slate-200/90 bg-white/80 px-1.5 py-1 dark:border-slate-600 dark:bg-slate-900/60 min-[440px]:min-h-[3.25rem] xl:min-h-0">
                <dt className="text-[8px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400 sm:text-[9px]">
                  Proveedor / naviera
                </dt>
                <dd className="mt-0.5 line-clamp-4 break-words text-[11px] font-bold leading-snug text-[#16263F] dark:text-slate-100 min-[440px]:line-clamp-3 min-[440px]:min-h-[2.35rem] xl:line-clamp-2 xl:min-h-0 sm:text-xs">
                  {provider}
                </dd>
              </div>
              <div className="min-w-0 rounded-md border border-slate-200/90 bg-white/80 px-1.5 py-1 dark:border-slate-600 dark:bg-slate-900/60 min-[440px]:min-h-[3.25rem] xl:min-h-0">
                <dt className="text-[8px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400 sm:text-[9px]">
                  Marca · tracking
                </dt>
                <dd className="mt-0.5 line-clamp-4 break-words text-[11px] font-bold leading-snug text-[#16263F] dark:text-slate-100 min-[440px]:line-clamp-3 min-[440px]:min-h-[2.35rem] xl:line-clamp-2 xl:min-h-0 sm:text-xs">
                  {brand}
                </dd>
              </div>
              <div className="min-w-0 rounded-md border border-sky-200/80 bg-sky-50/90 px-1.5 py-1 dark:border-sky-800/50 dark:bg-sky-950/35">
                <dt className="text-[8px] font-black uppercase tracking-wide text-sky-800 dark:text-sky-200/90 sm:text-[9px]">
                  Volumen doc.
                </dt>
                <dd className="mt-0.5 flex flex-wrap items-baseline gap-0.5 text-[11px] font-black tabular-nums text-sky-950 dark:text-sky-100 sm:text-xs">
                  {expectedCbm}
                  <M3Unit
                    size="sm"
                    className="text-[9px] font-black text-sky-800 dark:text-sky-300 sm:text-[10px]"
                  />
                </dd>
              </div>
              <div className="min-w-0 rounded-md border border-slate-200/90 bg-white/80 px-1.5 py-1 dark:border-slate-600 dark:bg-slate-900/60">
                <dt className="text-[8px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400 sm:text-[9px]">
                  Peso doc.
                </dt>
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
                className="rounded-md border border-dashed border-amber-300/80 bg-amber-50/55 px-1.5 py-1 dark:border-amber-800/50 dark:bg-amber-950/25"
                title={notesFull}
              >
                <p className="text-[8px] font-black uppercase tracking-wide text-amber-900 dark:text-amber-200/95 sm:text-[9px]">
                  Expedidor · notas
                </p>
                <div className="mt-0.5 max-h-[3.25rem] overflow-y-auto overflow-x-hidden overscroll-contain text-left text-[11px] font-semibold leading-snug text-amber-950/95 dark:text-amber-50/95 sm:max-h-[3.5rem] sm:text-xs">
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

          {/* Resumen de recepción: contenido centrado */}
          <div className="flex min-w-0 w-full shrink-0 flex-col items-center gap-1.5 border-t border-slate-200/80 pt-1.5 text-center dark:border-slate-700 lg:w-[min(100%,21.5rem)] lg:border-l lg:border-t-0 lg:pl-2.5 lg:pt-0">
            <div className="w-full rounded-md bg-[#16263F] px-2 py-1 shadow-sm">
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/90 sm:text-[10px]">
                {captureEyebrow}
              </p>
            </div>

            <div className="grid w-full min-w-0 grid-cols-3 gap-1 sm:gap-1.5">
              <div className="flex min-h-0 min-w-0 flex-col items-center gap-1 rounded-md border border-slate-200/95 bg-white px-1.5 py-1.5 shadow-sm dark:border-slate-600 dark:bg-slate-900">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200/90 bg-slate-50/80 text-slate-600 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-300"
                  aria-hidden
                >
                  <Package className="h-3 w-3" strokeWidth={1.5} />
                </span>
                <span className="w-full text-center text-[7px] font-black uppercase leading-tight tracking-wide text-slate-600 dark:text-slate-300 sm:text-[8px]">
                  <span className="md:hidden">Decl.</span>
                  <span className="hidden md:inline">Declarados</span>
                </span>
                <p className="w-full border-t border-slate-200/80 pt-1 text-center text-sm font-black tabular-nums leading-none text-[#16263F] dark:text-slate-100 dark:border-slate-600/80 sm:text-base">
                  {declared}
                </p>
              </div>
              <div className="flex min-h-0 min-w-0 flex-col items-center gap-1 rounded-md border border-violet-200/90 bg-violet-50/50 px-1.5 py-1.5 shadow-sm dark:border-violet-800/50 dark:bg-violet-950/35">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-violet-200/90 bg-white/70 text-violet-700 dark:border-violet-700/60 dark:bg-violet-950/40 dark:text-violet-300"
                  aria-hidden
                >
                  <Boxes className="h-3 w-3" strokeWidth={1.5} />
                </span>
                <span className="w-full text-center text-[7px] font-black uppercase leading-tight text-violet-900 dark:text-violet-200 sm:text-[8px]">
                  <span className="md:hidden">Fís.</span>
                  <span className="hidden md:inline">Físicos</span>
                </span>
                <p className="w-full border-t border-violet-200/70 pt-1 text-center text-sm font-black tabular-nums leading-none text-violet-950 dark:text-violet-100 dark:border-violet-800/50 sm:text-base">
                  {physical}
                </p>
              </div>
              <div
                className={`flex min-h-0 min-w-0 flex-col items-center gap-1 rounded-md border px-1.5 py-1.5 shadow-sm ${diffWrap}`}
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
                <span className="w-full text-center text-[7px] font-black uppercase leading-tight text-slate-800 dark:text-slate-100 sm:text-[8px]">
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

            <div className="w-full rounded-md border border-slate-200 bg-slate-50/90 px-1.5 py-1 dark:border-slate-600 dark:bg-slate-800/80 sm:px-2">
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 sm:text-[9px]">
                {totalsSectionTitle}
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
                  <span className="text-[9px] font-bold uppercase text-slate-500 dark:text-slate-400">
                    Volumen
                  </span>
                  {Number(totalCbm).toFixed(2)}
                  <M3Unit
                    size="sm"
                    className="text-[9px] font-black text-slate-600 dark:text-slate-300 sm:text-[10px]"
                  />
                </span>
                <span className="inline-flex items-baseline justify-center gap-1">
                  <span className="text-[9px] font-bold uppercase text-slate-500 dark:text-slate-400">
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
