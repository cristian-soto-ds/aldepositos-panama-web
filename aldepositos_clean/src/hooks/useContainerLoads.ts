"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchContainerLoads,
  subscribeContainerLoadsRealtime,
} from "@/lib/containerLoads";
import type { ContainerLoad } from "@/lib/types/containerLoad";

export function useContainerLoads({ enabled = true }: { enabled?: boolean } = {}) {
  const [loads, setLoads] = useState<ContainerLoad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    try {
      const list = await fetchContainerLoads();
      setLoads(list);
      setError(null);
    } catch (e) {
      console.error("[container_loads]", e);
      // No vaciar la lista ante un fallo de red.
      setError(
        e instanceof Error
          ? e.message
          : "No se pudieron cargar los cargues de contenedores.",
      );
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeContainerLoadsRealtime(() => {
      void reload();
    });
  }, [enabled, reload]);

  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, reload]);

  return { loads, setLoads, loading, error, reload };
}
