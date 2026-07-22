"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RampOccupancyRampId,
  RampOccupancyState,
} from "@/lib/receptionLogistics/rampOccupancy";
import {
  fetchRampOccupancy,
  setRampOccupancy,
  subscribeRampOccupancy,
} from "@/lib/receptionLogistics/rampOccupancyRepository";
import { subscribeReceptionLive } from "@/lib/receptionLogistics/receptionLiveSync";

const RAMP_OCCUPANCY_RELOAD_DEBOUNCE_MS = 900;

export function useRampOccupancy(enabled = true) {
  const [occupancy, setOccupancy] = useState<RampOccupancyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyRamp, setBusyRamp] = useState<RampOccupancyRampId | null>(null);
  const reloadBusyRef = useRef(false);

  const reload = useCallback(async () => {
    if (!enabled || reloadBusyRef.current) return;
    reloadBusyRef.current = true;
    try {
      const state = await fetchRampOccupancy();
      setOccupancy((prev) => {
        const prevJson = JSON.stringify(prev);
        const nextJson = JSON.stringify(state);
        return prevJson === nextJson ? prev : state;
      });
    } catch (e) {
      console.error(e);
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

    const unsubLive = subscribeReceptionLive((change) => {
      if (change.kind !== "ramp") return;
      setOccupancy(change.occupancy);
    });

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (debounceTimer != null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void reload();
      }, RAMP_OCCUPANCY_RELOAD_DEBOUNCE_MS);
    };

    const unsubscribe = subscribeRampOccupancy(scheduleReload);
    return () => {
      if (debounceTimer != null) clearTimeout(debounceTimer);
      unsubLive();
      unsubscribe();
    };
  }, [enabled, reload]);

  const toggleRamp = useCallback(
    async (rampId: RampOccupancyRampId) => {
      if (!occupancy) return;
      const previous = occupancy;
      setBusyRamp(rampId);
      try {
        const currently = occupancy[rampId].occupied;
        const next = await setRampOccupancy(rampId, !currently);
        setOccupancy(next);
      } catch (e) {
        console.error(e);
        setOccupancy(previous);
        const message =
          e instanceof Error
            ? e.message
            : "No se pudo actualizar el estado de la rampa.";
        alert(message);
      } finally {
        setBusyRamp(null);
      }
    },
    [occupancy],
  );

  return { occupancy, loading, busyRamp, reload, toggleRamp };
}
