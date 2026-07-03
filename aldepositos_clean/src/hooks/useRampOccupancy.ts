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
    return subscribeRampOccupancy(() => {
      void reload();
    });
  }, [enabled, reload]);

  const toggleRamp = useCallback(
    async (rampId: RampOccupancyRampId) => {
      if (!occupancy) return;
      setBusyRamp(rampId);
      try {
        const currently = occupancy[rampId].occupied;
        const next = await setRampOccupancy(rampId, !currently);
        setOccupancy(next);
      } catch (e) {
        console.error(e);
        alert("No se pudo actualizar el estado de la rampa.");
      } finally {
        setBusyRamp(null);
      }
    },
    [occupancy],
  );

  return { occupancy, loading, busyRamp, reload, toggleRamp };
}
