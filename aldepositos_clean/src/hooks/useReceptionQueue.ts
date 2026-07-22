"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReceptionTruck } from "@/lib/receptionLogistics/types";
import {
  fetchReceptionTrucks,
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
  const [trucks, setTrucks] = useState<ReceptionTruck[]>([]);
  const [loading, setLoading] = useState(true);
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
          setTrucks((prev) => {
            const prevJson = JSON.stringify(prev);
            const nextJson = JSON.stringify(list);
            return prevJson === nextJson ? prev : list;
          });
        } catch (e) {
          console.error(e);
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

  return { trucks, setTrucks, loading, reload };
}
