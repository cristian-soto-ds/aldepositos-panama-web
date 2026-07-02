"use client";

/**
 * Pantalla TV — Dirección de camiones
 * Tablero Kanban minimalista de 3 columnas (En Fila, Rampa 1, Rampa 2).
 * Personalización de textos/estados: src/lib/receptionLogistics/config.ts
 */

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useReceptionQueue } from "@/hooks/useReceptionQueue";
import {
  RECEPTION_COPY,
  RECEPTION_STATUS,
  RECEPTION_STATUS_LABELS,
  type ReceptionStatusId,
} from "@/lib/receptionLogistics/config";
import type { ReceptionTruck } from "@/lib/receptionLogistics/types";

/** Columnas visibles en modo TV (sin «Completado»). */
const TV_COLUMNS: ReceptionStatusId[] = [
  RECEPTION_STATUS.EN_FILA,
  RECEPTION_STATUS.RAMPA_1,
  RECEPTION_STATUS.RAMPA_2,
];

const COLUMN_TITLE_CLASS: Record<ReceptionStatusId, string> = {
  EN_FILA: "text-neutral-800",
  RAMPA_1: "text-blue-600",
  RAMPA_2: "text-violet-700",
  COMPLETADO: "text-neutral-800",
};

function TruckTvCard({ truck }: { truck: ReceptionTruck }) {
  return (
    <li className="border border-neutral-300 bg-white px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xl font-semibold text-black md:text-2xl">{truck.plate}</p>
        <span className="text-sm font-medium text-neutral-600 tabular-nums">
          {truck.expectedBultos} bls
        </span>
      </div>
      <p className="mt-1 text-base font-medium text-neutral-800">RA {truck.ra}</p>
      <p className="mt-0.5 truncate text-sm text-neutral-600">{truck.provider}</p>
      <p className="truncate text-sm text-neutral-500">{truck.client}</p>
    </li>
  );
}

type KanbanColumnProps = {
  statusId: ReceptionStatusId;
  trucks: ReceptionTruck[];
};

function KanbanColumn({ statusId, trucks }: KanbanColumnProps) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col border border-neutral-300 bg-white">
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-300 px-4 py-3">
        <h2
          className={`text-base font-semibold md:text-lg ${COLUMN_TITLE_CLASS[statusId]}`}
        >
          {RECEPTION_STATUS_LABELS[statusId]}
        </h2>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full border border-neutral-400 text-xs font-semibold text-neutral-700"
          aria-label={`${trucks.length} camiones`}
        >
          {trucks.length}
        </span>
      </header>

      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {trucks.length === 0 ? (
          <li className="py-8 text-center text-sm text-neutral-400">
            {RECEPTION_COPY.emptyColumn}
          </li>
        ) : (
          trucks.map((truck) => <TruckTvCard key={truck.id} truck={truck} />)
        )}
      </ul>
    </section>
  );
}

type TruckDirectionTvModuleProps = {
  /** Al cerrar desde el panel (overlay). Si no se pasa, vuelve a /panel o cierra pestaña. */
  onClose?: () => void;
  /** Datos compartidos del operador (evita segunda suscripción Realtime). */
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
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    onFs();
    return () => document.removeEventListener("fullscreenchange", onFs);
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
          return ta.localeCompare(tb);
        });
    }

    return map;
  }, [trucks]);

  const exitFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      /* ignorar */
    }
  };

  const enterFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
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
    <div className="flex h-dvh min-h-screen flex-col bg-neutral-100">
      {/* Cabecera */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-neutral-300 bg-white px-4 py-4 md:px-6">
        <div>
          <h1 className="text-lg font-semibold text-black md:text-xl">Bodega Central</h1>
          <p className="mt-1 flex items-center gap-2 text-xs text-neutral-600 md:text-sm">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full bg-green-500"
              aria-hidden
            />
            Sincronización en vivo
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!fullscreen ? (
            <button
              type="button"
              onClick={() => void enterFullscreen()}
              className="border border-neutral-600 bg-white px-3 py-2 text-xs font-medium text-neutral-800 md:text-sm"
            >
              Pantalla completa
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void exitFullscreen()}
              className="border border-neutral-600 bg-white px-3 py-2 text-xs font-medium text-neutral-800 md:text-sm"
            >
              Salir Fullscreen
            </button>
          )}
          <button
            type="button"
            onClick={closeTv}
            className="border border-neutral-600 bg-white px-3 py-2 text-xs font-medium text-neutral-800 md:text-sm"
          >
            Cerrar TV
          </button>
        </div>
      </header>

      {/* Tablero 3 columnas */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
          Sincronizando…
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 md:grid-cols-3 md:gap-4 md:p-4">
          {TV_COLUMNS.map((statusId) => (
            <KanbanColumn
              key={statusId}
              statusId={statusId}
              trucks={trucksByColumn[statusId] ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
