"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReceptionTruck } from "@/lib/receptionLogistics/types";
import {
  fetchReceptionTrucks,
  peekReceptionTrucksLocal,
  receptionTrucksFingerprint,
  subscribeReceptionQueue,
} from "@/lib/receptionLogistics/repository";
import { subscribeCollectionOrdersRealtime } from "@/lib/collectionOrders";
import {
  applyTruckLiveChange,
  subscribeReceptionLive,
  type ReceptionTruckLiveChange,
} from "@/lib/receptionLogistics/receptionLiveSync";

/** Refetch de consistencia (los movimientos llegan antes por broadcast/parche). */
const RECEPTION_RELOAD_DEBOUNCE_MS = 900;

type UseReceptionQueueOptions = {
  /** false = no suscribe Realtime (p. ej. TV embebida que reutiliza datos del operador). */
  enabled?: boolean;
};

/** Hook compartido por Operador y Pantalla TV. */
export function useReceptionQueue(options: UseReceptionQueueOptions = {}) {
  const enabled = options.enabled !== false;
  const [trucks, setTrucks] = useState<ReceptionTruck[]>(() =>
    enabled ? peekReceptionTrucksLocal() : [],
  );
  const [loading, setLoading] = useState(() => {
    if (!enabled) return false;
    return peekReceptionTrucksLocal().length === 0;
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const reloadBusyRef = useRef(false);
  const pendingReloadRef = useRef(false);

  const reload = useCallback(async () => {
    if (!enabled) return;
    if (reloadBusyRef.current) {
      pendingReloadRef.current = true;
      return;
    }
    reloadBusyRef.current = true;
    try {
      do {
        pendingReloadRef.current = false;
        try {
          const list = await fetchReceptionTrucks();
          setTrucks((prev) =>
            receptionTrucksFingerprint(prev) ===
            receptionTrucksFingerprint(list)
              ? prev
              : list,
          );
          setLoadError(null);
        } catch (e) {
          console.error(e);
          if (peekReceptionTrucksLocal().length === 0) {
            setLoadError(
              e instanceof Error
                ? e.message
                : "No se pudo cargar el tablero de recepción",
            );
          }
        }
      } while (pendingReloadRef.current);
    } finally {
      reloadBusyRef.current = false;
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    // Cache ya pintó el tablero; hidratar en segundo plano.
    const local = peekReceptionTrucksLocal();
    if (local.length > 0) {
      setTrucks(local);
      setLoading(false);
    }
    void reload();
  }, [enabled, reload]);

  useEffect(() => {
    if (!enabled) return;

    // Parche inmediato (~50–200 ms) al mover un camión en otro dispositivo.
    const unsubLive = subscribeReceptionLive((change) => {
      if (change.kind !== "truck") return;
      setTrucks((prev) =>
        applyTruckLiveChange(prev, change as ReceptionTruckLiveChange),
      );
    });

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (debounceTimer != null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void reload();
      }, RECEPTION_RELOAD_DEBOUNCE_MS);
    };

    const unsubReception = subscribeReceptionQueue(scheduleReload);
    const unsubOrders = subscribeCollectionOrdersRealtime(scheduleReload);

    return () => {
      if (debounceTimer != null) clearTimeout(debounceTimer);
      unsubLive();
      unsubReception();
      unsubOrders();
    };
  }, [enabled, reload]);

  return { trucks, setTrucks, loading, loadError, reload };
}
