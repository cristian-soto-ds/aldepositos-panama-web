"use client";

/**
 * Pantalla TV — Recepción de camiones / Bodega Central
 * Tablero de 3 columnas optimizado para lectura a distancia.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, Maximize2, Minimize2, Package, Radio, X } from "lucide-react";
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
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-slate-50 via-slate-50/80 to-transparent"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-slate-50 via-slate-50/80 to-transparent"
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

const TV_COLUMNS: ReceptionStatusId[] = [
  RECEPTION_STATUS.EN_FILA,
  RECEPTION_STATUS.RAMPA_1,
  RECEPTION_STATUS.RAMPA_2,
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
      className={`group relative overflow-hidden border border-slate-200/90 ring-1 ring-slate-100 transition duration-150 hover:bg-slate-50/80 ${
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
  const density = isQueueColumn ? queueDensity(trucks.length) : "normal";
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
          </div>
          <span
            className={`flex h-9 min-w-9 items-center justify-center rounded-lg px-2.5 text-base font-black tabular-nums ${ui.countBg}`}
            aria-label={`${trucks.length} en columna`}
          >
            {trucks.length}
          </span>
        </div>
      </header>

      {isQueueColumn && trucks.length > 0 ? (
        <TvAutoScrollQueueList
          itemCount={trucks.length}
          className={`flex min-h-0 flex-1 flex-col p-2 md:p-3 ${
            isDense ? "gap-1" : density === "compact" ? "gap-1.5" : "gap-2.5"
          }`}
        >
          {trucks.map((truck, index) => (
            <TruckTvCard
              key={truck.id}
              truck={truck}
              queuePosition={index + 1}
              density={density}
              stripeClass={ui.stripe}
              zebra={isDense && index % 2 === 1}
            />
          ))}
        </TvAutoScrollQueueList>
      ) : (
        <ul
          className={`custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto p-2 md:p-3 ${
            isDense ? "gap-1" : density === "compact" ? "gap-1.5" : "gap-2.5"
          }`}
        >
          {trucks.length === 0 ? (
            rampRetiroOccupied && isRampColumn ? (
              <RampOccupancyTvCard rampId={statusId} stripeClass={ui.stripe} />
            ) : (
            <li className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/60 px-4 py-12 text-center">
              <Package className={`mb-3 h-10 w-10 ${ui.emptyIcon}`} aria-hidden />
              <p className="text-sm font-bold uppercase tracking-wide text-slate-500">
                {RECEPTION_COPY.emptyColumn}
              </p>
            </li>
            )
          ) : (
            trucks.map((truck, index) => (
              <TruckTvCard
                key={truck.id}
                truck={truck}
                queuePosition={isQueueColumn ? index + 1 : undefined}
                density={density}
                stripeClass={ui.stripe}
                zebra={isDense && index % 2 === 1}
              />
            ))
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
      COMPLETADO: [],
    };

    for (const statusId of TV_COLUMNS) {
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

  const totalActive = useMemo(
    () => TV_COLUMNS.reduce((sum, id) => sum + (trucksByColumn[id]?.length ?? 0), 0),
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
    <div className="relative flex h-dvh min-h-screen flex-col overflow-hidden bg-gradient-to-br from-slate-100 via-white to-slate-50 text-slate-900">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(59,130,246,0.08),transparent)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.12) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
        aria-hidden
      />

      <header className="relative z-10 flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-md md:px-6 md:py-4">
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
        <div className="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 md:grid-cols-3 md:gap-4 md:p-5">
          {TV_COLUMNS.map((statusId) => (
            <KanbanColumn
              key={statusId}
              statusId={statusId}
              trucks={trucksByColumn[statusId] ?? []}
              rampOccupancy={rampOccupancy}
            />
          ))}
        </div>
      )}

      <footer className="relative z-10 shrink-0 border-t border-slate-200 bg-white/90 px-4 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400 backdrop-blur-sm md:px-6">
        {RECEPTION_COPY.companyName} — {RECEPTION_COPY.companyTagline}
      </footer>
    </div>
  );
}
