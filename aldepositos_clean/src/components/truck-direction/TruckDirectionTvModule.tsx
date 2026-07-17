"use client";

/**
 * Pantalla TV — Recepción de camiones / Bodega Central
 * Tablero de 3 columnas optimizado para lectura a distancia.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Clock3, Maximize2, Minimize2, Package, Radio, X } from "lucide-react";
import logoAldepositos from "@/assets/brand/logo-aldepositos.png";
import { useReceptionQueue } from "@/hooks/useReceptionQueue";
import {
  RECEPTION_COPY,
  RECEPTION_STATUS,
  RECEPTION_STATUS_LABELS,
  type ReceptionStatusId,
} from "@/lib/receptionLogistics/config";
import type { ReceptionTruck } from "@/lib/receptionLogistics/types";
import { ReceptionKanbanCardContent } from "@/components/truck-direction/ReceptionKanbanCardContent";
import type { ReceptionCardDensity } from "@/components/truck-direction/ReceptionKanbanCardContent";
import { useRampOccupancy } from "@/hooks/useRampOccupancy";
import { RampOccupancyTvCard } from "@/components/reception/RampOccupancyControls";
import {
  isRampOccupancyRampId,
  RAMP_OCCUPANCY_COPY,
  type RampOccupancyState,
} from "@/lib/receptionLogistics/rampOccupancy";

function queueDensity(count: number): ReceptionCardDensity {
  if (count >= 5) return "dense";
  if (count >= 3) return "compact";
  return "normal";
}

/** Columnas de rampa/carretillado: tarjetas grandes, se compactan antes. */
function rampDensity(count: number): ReceptionCardDensity {
  if (count >= 6) return "dense";
  if (count >= 3) return "compact";
  return "normal";
}

const TV_QUEUE_SCROLL_SPEED_PX = 0.55;
const TV_QUEUE_SCROLL_PAUSE_MS = 2800;

/** Lista con scroll automático cuando el contenido no cabe (columna En Fila en TV). */
function TvAutoScrollQueueList({
  children,
  className,
  itemCount,
}: {
  children: React.ReactNode;
  className?: string;
  itemCount: number;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const measure = () => {
      setOverflows(el.scrollHeight > el.clientHeight + 6);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of el.children) {
      ro.observe(child);
    }

    return () => ro.disconnect();
  }, [itemCount, children]);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !overflows || itemCount === 0) {
      if (el) el.scrollTop = 0;
      return;
    }

    let dir = 1;
    let pauseUntil = Date.now() + TV_QUEUE_SCROLL_PAUSE_MS;
    let raf = 0;

    const tick = () => {
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const now = Date.now();
      if (now < pauseUntil) {
        raf = requestAnimationFrame(tick);
        return;
      }

      el.scrollTop += dir * TV_QUEUE_SCROLL_SPEED_PX;

      if (el.scrollTop >= max - 1) {
        el.scrollTop = max;
        dir = -1;
        pauseUntil = now + TV_QUEUE_SCROLL_PAUSE_MS;
      } else if (el.scrollTop <= 0 && dir < 0) {
        el.scrollTop = 0;
        dir = 1;
        pauseUntil = now + TV_QUEUE_SCROLL_PAUSE_MS;
      }

      raf = requestAnimationFrame(tick);
    };

    el.scrollTop = 0;
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [overflows, itemCount]);

  return (
    <div className="relative min-h-0 flex-1">
      {overflows ? (
        <>
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-white via-white/80 to-transparent"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-white via-white/80 to-transparent"
            aria-hidden
          />
        </>
      ) : null}
      <ul
        ref={listRef}
        className={`${className ?? ""} ${overflows ? "overflow-hidden hide-scrollbar" : "overflow-y-auto custom-scrollbar"}`}
      >
        {children}
      </ul>
    </div>
  );
}

const TV_BASE_COLUMNS: ReceptionStatusId[] = [
  RECEPTION_STATUS.EN_FILA,
  RECEPTION_STATUS.RAMPA_1,
  RECEPTION_STATUS.RAMPA_2,
];

/** Estados especiales: solo aparecen como columna cuando tienen órdenes. */
const TV_OPTIONAL_COLUMNS: ReceptionStatusId[] = [
  RECEPTION_STATUS.RAMPA_EXTRA,
  RECEPTION_STATUS.CARRETILLADO,
];

const TV_ALL_COLUMNS: ReceptionStatusId[] = [
  ...TV_BASE_COLUMNS,
  ...TV_OPTIONAL_COLUMNS,
];

const TV_COLUMN_UI: Record<
  ReceptionStatusId,
  {
    headerGradient: string;
    headerGlow: string;
    panelBg: string;
    panelBorder: string;
    countBg: string;
    stripe: string;
    emptyIcon: string;
  }
> = {
  EN_FILA: {
    headerGradient: "from-slate-600 via-slate-700 to-slate-800",
    headerGlow: "shadow-slate-300/50",
    panelBg: "bg-slate-50",
    panelBorder: "border-slate-200",
    countBg: "bg-white/20 text-white",
    stripe: "from-slate-400 to-slate-600",
    emptyIcon: "text-slate-300",
  },
  RAMPA_1: {
    headerGradient: "from-amber-500 via-amber-600 to-amber-700",
    headerGlow: "shadow-amber-200/80",
    panelBg: "bg-amber-50/80",
    panelBorder: "border-amber-200",
    countBg: "bg-white/25 text-white",
    stripe: "from-amber-400 to-amber-600",
    emptyIcon: "text-amber-300",
  },
  RAMPA_2: {
    headerGradient: "from-orange-500 via-orange-600 to-orange-700",
    headerGlow: "shadow-orange-200/80",
    panelBg: "bg-orange-50/80",
    panelBorder: "border-orange-200",
    countBg: "bg-white/25 text-white",
    stripe: "from-orange-400 to-orange-600",
    emptyIcon: "text-orange-300",
  },
  RAMPA_EXTRA: {
    headerGradient: "from-sky-500 via-sky-600 to-sky-700",
    headerGlow: "shadow-sky-200/80",
    panelBg: "bg-sky-50/80",
    panelBorder: "border-sky-200",
    countBg: "bg-white/25 text-white",
    stripe: "from-sky-400 to-sky-600",
    emptyIcon: "text-sky-300",
  },
  CARRETILLADO: {
    headerGradient: "from-violet-500 via-violet-600 to-violet-700",
    headerGlow: "shadow-violet-200/80",
    panelBg: "bg-violet-50/80",
    panelBorder: "border-violet-200",
    countBg: "bg-white/25 text-white",
    stripe: "from-violet-400 to-violet-600",
    emptyIcon: "text-violet-300",
  },
  COMPLETADO: {
    headerGradient: "from-emerald-600 to-emerald-800",
    headerGlow: "shadow-emerald-200/80",
    panelBg: "bg-emerald-50/80",
    panelBorder: "border-emerald-200",
    countBg: "bg-white/25 text-white",
    stripe: "from-emerald-400 to-emerald-600",
    emptyIcon: "text-emerald-300",
  },
};

function TruckTvCard({
  truck,
  queuePosition,
  density,
  stripeClass,
  zebra,
}: {
  truck: ReceptionTruck;
  queuePosition?: number;
  density: ReceptionCardDensity;
  stripeClass: string;
  zebra?: boolean;
}) {
  const isDense = density === "dense";
  return (
    <li
      className={`group relative shrink-0 overflow-hidden border border-slate-200/90 ring-1 ring-slate-100 transition duration-150 hover:bg-slate-50/80 ${
        isDense
          ? `rounded-lg px-2.5 py-2 shadow-sm ${zebra ? "bg-slate-50/90" : "bg-white"}`
          : density === "compact"
            ? "rounded-xl bg-white px-3 py-2.5 shadow-md"
            : "rounded-2xl bg-white px-4 py-4 shadow-md md:px-5 md:py-5"
      }`}
    >
      {!isDense ? (
        <span
          className={`pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b ${stripeClass}`}
          aria-hidden
        />
      ) : null}
      <ReceptionKanbanCardContent
        truck={truck}
        variant="tv"
        queuePosition={queuePosition}
        density={density}
        bultosBadgeClassName="border-slate-200 bg-slate-50"
      />
    </li>
  );
}

function TvColumnEmptyState({ emptyIconClass }: { emptyIconClass: string }) {
  return (
    <li className="relative z-[1] flex min-h-[12rem] flex-1 flex-col items-center justify-center px-4 py-12 text-center md:min-h-[14rem]">
      <Package className={`mb-3 h-10 w-10 ${emptyIconClass}`} aria-hidden />
      <p className="text-sm font-bold uppercase tracking-wide text-slate-500">
        {RECEPTION_COPY.emptyColumn}
      </p>
    </li>
  );
}

type KanbanColumnProps = {
  statusId: ReceptionStatusId;
  trucks: ReceptionTruck[];
  rampOccupancy: RampOccupancyState | null;
};

function KanbanColumn({ statusId, trucks, rampOccupancy }: KanbanColumnProps) {
  const ui = TV_COLUMN_UI[statusId];
  const isQueueColumn = statusId === RECEPTION_STATUS.EN_FILA;
  const isRampColumn = isRampOccupancyRampId(statusId);
  const rampRetiroOccupied =
    isRampColumn && rampOccupancy?.[statusId]?.occupied === true;
  const density = isQueueColumn
    ? queueDensity(trucks.length)
    : rampDensity(trucks.length);
  const isDense = density === "dense";
  const columnSubtitle = isQueueColumn
    ? "Esperando rampa"
    : rampRetiroOccupied && trucks.length === 0
      ? RAMP_OCCUPANCY_COPY.occupiedRetiroLong
      : rampRetiroOccupied
        ? RAMP_OCCUPANCY_COPY.operatorBadge
        : "En descarga";

  return (
    <section
      className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border shadow-sm ${ui.panelBorder} ${ui.panelBg}`}
    >
      <header
        className={`relative shrink-0 bg-gradient-to-r px-4 py-3 shadow-lg md:px-5 md:py-3.5 ${ui.headerGradient} ${ui.headerGlow}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black uppercase tracking-[0.12em] text-white md:text-lg">
              {RECEPTION_STATUS_LABELS[statusId]}
            </h2>
            <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-widest text-white/70">
              {columnSubtitle}
            </p>
            {rampRetiroOccupied ? (
              <p className="mt-1 inline-flex rounded-md bg-white/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white">
                {RAMP_OCCUPANCY_COPY.operatorBadge}
              </p>
            ) : null}
          </div>
          <span
            className={`flex h-9 min-w-9 items-center justify-center rounded-lg px-2.5 text-base font-black tabular-nums ${ui.countBg}`}
            aria-label={`${trucks.length} en columna`}
          >
            {trucks.length}
          </span>
        </div>
      </header>

      {trucks.length > 0 ? (
        <TvAutoScrollQueueList
          itemCount={trucks.length + (rampRetiroOccupied && isRampColumn ? 1 : 0)}
          className={`flex min-h-0 flex-1 flex-col p-2 md:p-3 ${
            isDense ? "gap-1" : density === "compact" ? "gap-1.5" : "gap-2.5"
          }`}
        >
          {rampRetiroOccupied && isRampColumn ? (
            <RampOccupancyTvCard rampId={statusId} stripeClass={ui.stripe} />
          ) : null}
          {trucks.map((truck, index) => (
            <TruckTvCard
              key={truck.id}
              truck={truck}
              queuePosition={isQueueColumn ? index + 1 : undefined}
              density={density}
              stripeClass={ui.stripe}
              zebra={isDense && index % 2 === 1}
            />
          ))}
        </TvAutoScrollQueueList>
      ) : (
        <ul
          className={`relative custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto p-2 md:p-3 ${
            isDense ? "gap-1" : density === "compact" ? "gap-1.5" : "gap-2.5"
          }`}
        >
          {!(rampRetiroOccupied && isRampColumn) ? (
            <div
              className="pointer-events-none absolute inset-2 flex items-center justify-center md:inset-3"
              aria-hidden
            >
              <Image
                src={logoAldepositos}
                alt=""
                width={320}
                height={320}
                className="max-h-[min(62%,280px)] w-[min(72%,260px)] object-contain opacity-[0.09]"
              />
            </div>
          ) : null}
          {rampRetiroOccupied && isRampColumn ? (
            <RampOccupancyTvCard rampId={statusId} stripeClass={ui.stripe} />
          ) : (
            <TvColumnEmptyState emptyIconClass={ui.emptyIcon} />
          )}
        </ul>
      )}
    </section>
  );
}

type TruckDirectionTvModuleProps = {
  onClose?: () => void;
  trucks?: ReceptionTruck[];
  loading?: boolean;
};

export function TruckDirectionTvModule({
  onClose,
  trucks: trucksFromParent,
  loading: loadingFromParent,
}: TruckDirectionTvModuleProps = {}) {
  const router = useRouter();
  const embedded = trucksFromParent != null;
  const internalQueue = useReceptionQueue({ enabled: !embedded });
  const trucks = embedded ? trucksFromParent! : internalQueue.trucks;
  const loading = embedded ? (loadingFromParent ?? false) : internalQueue.loading;
  const { occupancy: rampOccupancy } = useRampOccupancy();
  const [fullscreen, setFullscreen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    onFs();
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const trucksByColumn = useMemo(() => {
    const map: Record<ReceptionStatusId, ReceptionTruck[]> = {
      EN_FILA: [],
      RAMPA_1: [],
      RAMPA_2: [],
      RAMPA_EXTRA: [],
      CARRETILLADO: [],
      COMPLETADO: [],
    };

    for (const statusId of TV_ALL_COLUMNS) {
      map[statusId] = trucks
        .filter((t) => t.status === statusId)
        .sort((a, b) => {
          if (statusId === RECEPTION_STATUS.EN_FILA) {
            return a.sortOrder - b.sortOrder;
          }
          const ta = a.rampAssignedAt ?? a.updatedAt;
          const tb = b.rampAssignedAt ?? b.updatedAt;
          return tb.localeCompare(ta);
        });
    }

    return map;
  }, [trucks]);

  const visibleColumns = useMemo(
    () =>
      TV_ALL_COLUMNS.filter(
        (id) =>
          TV_BASE_COLUMNS.includes(id) || (trucksByColumn[id]?.length ?? 0) > 0,
      ),
    [trucksByColumn],
  );

  const totalActive = useMemo(
    () =>
      TV_ALL_COLUMNS.reduce(
        (sum, id) => sum + (trucksByColumn[id]?.length ?? 0),
        0,
      ),
    [trucksByColumn],
  );

  const timeStr = now.toLocaleTimeString("es-PA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const dateStr = now.toLocaleDateString("es-PA", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const exitFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* ignorar */
    }
  };

  const enterFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    } catch {
      /* ignorar */
    }
  };

  const closeTv = () => {
    if (onClose) {
      void exitFullscreen();
      onClose();
      return;
    }
    if (typeof window !== "undefined" && window.opener) {
      window.close();
      return;
    }
    router.push("/panel");
  };

  return (
    <div className="force-light relative flex h-dvh min-h-screen flex-col overflow-hidden bg-white text-slate-900">
      <header className="relative z-10 flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3 shadow-sm md:px-6 md:py-4">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#16263F]/70">
            Aldepósitos
          </p>
          <h1 className="truncate text-xl font-black tracking-tight text-[#16263F] md:text-2xl">
            Bodega Central
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-600">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <Radio className="h-3.5 w-3.5" aria-hidden />
              En vivo
            </span>
            <span className="text-slate-300">·</span>
            <span>{totalActive} activos</span>
          </p>
        </div>

        <div className="hidden text-right sm:block">
          <p className="flex items-center justify-end gap-2 text-2xl font-black tabular-nums tracking-tight text-[#16263F] md:text-3xl">
            <Clock3 className="h-6 w-6 text-amber-600" aria-hidden />
            {timeStr}
          </p>
          <p className="mt-0.5 text-xs font-medium capitalize text-slate-500">{dateStr}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void (fullscreen ? exitFullscreen() : enterFullscreen())}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            {fullscreen ? (
              <Minimize2 className="h-4 w-4" aria-hidden />
            ) : (
              <Maximize2 className="h-4 w-4" aria-hidden />
            )}
            <span className="hidden md:inline">
              {fullscreen ? "Salir" : "Pantalla completa"}
            </span>
          </button>
          <button
            type="button"
            onClick={closeTv}
            className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold uppercase tracking-wider text-red-700 shadow-sm transition hover:bg-red-100"
          >
            <X className="h-4 w-4" aria-hidden />
            <span className="hidden md:inline">Cerrar TV</span>
          </button>
        </div>
      </header>

      {loading ? (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-amber-500" />
          <p className="text-sm font-bold uppercase tracking-widest text-slate-500">
            Sincronizando…
          </p>
        </div>
      ) : (
        <div
          className={`relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 md:gap-4 md:p-5 ${
            visibleColumns.length >= 5
              ? "md:grid-cols-5"
              : visibleColumns.length === 4
                ? "md:grid-cols-4"
                : "md:grid-cols-3"
          }`}
        >
          {visibleColumns.map((statusId) => (
            <KanbanColumn
              key={statusId}
              statusId={statusId}
              trucks={trucksByColumn[statusId] ?? []}
              rampOccupancy={rampOccupancy}
            />
          ))}
        </div>
      )}

      <footer className="relative z-10 shrink-0 border-t border-slate-200 bg-white px-4 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400 md:px-6">
        {RECEPTION_COPY.companyName} — {RECEPTION_COPY.companyTagline}
      </footer>
    </div>
  );
}
