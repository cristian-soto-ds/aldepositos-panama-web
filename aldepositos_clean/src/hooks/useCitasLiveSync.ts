"use client";

import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

/** Sondeo de respaldo si Realtime no está conectado. */
const POLL_OFFLINE_MS = 5_000;
/** Con Realtime activo solo verificamos de vez en cuando (barato con ?since=). */
const POLL_ONLINE_MS = 30_000;
const REALTIME_DEBOUNCE_MS = 200;
const REALTIME_CHANNEL = "citas-live-v1";

type UseCitasLiveSyncOptions = {
  /** Recarga silenciosa (sin spinner). */
  onRefresh: () => void | Promise<void>;
  enabled?: boolean;
  /** true cuando Realtime está SUBSCRIBED (opcional UI). */
  onRealtimeStatus?: (ok: boolean) => void;
};

/**
 * Actualiza citas en vivo priorizando Realtime; el sondeo es respaldo.
 * Evita ráfagas: debounce en eventos y poll más lento si Realtime vive.
 */
export function useCitasLiveSync({
  onRefresh,
  enabled = true,
  onRealtimeStatus,
}: UseCitasLiveSyncOptions): void {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const onStatusRef = useRef(onRealtimeStatus);
  onStatusRef.current = onRealtimeStatus;
  const debounceRef = useRef<number | null>(null);
  const realtimeOkRef = useRef(false);
  const pollIdRef = useRef<number | null>(null);

  const quietRefresh = useCallback(() => {
    void Promise.resolve(onRefreshRef.current()).catch(() => {
      /* no bloquear UI */
    });
  }, []);

  const scheduleDebounced = useCallback(() => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      quietRefresh();
    }, REALTIME_DEBOUNCE_MS);
  }, [quietRefresh]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const clearPoll = () => {
      if (pollIdRef.current != null) {
        window.clearInterval(pollIdRef.current);
        pollIdRef.current = null;
      }
    };

    const startPoll = (ms: number) => {
      clearPoll();
      pollIdRef.current = window.setInterval(quietRefresh, ms);
    };

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(REALTIME_CHANNEL)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "citas" },
          () => scheduleDebounced(),
        )
        .subscribe((status) => {
          const ok = status === "SUBSCRIBED";
          realtimeOkRef.current = ok;
          onStatusRef.current?.(ok);
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn(
              `[citas] Realtime ${status}; sondeo cada ${POLL_OFFLINE_MS / 1000}s.`,
            );
            startPoll(POLL_OFFLINE_MS);
          } else if (ok) {
            startPoll(POLL_ONLINE_MS);
          }
        });
    } catch (e) {
      console.warn("[citas] No se pudo suscribir a Realtime.", e);
      onStatusRef.current?.(false);
    }

    // Arranque: asumir offline hasta SUBSCRIBED
    startPoll(POLL_OFFLINE_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") quietRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearPoll();
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) void supabase.removeChannel(channel);
      onStatusRef.current?.(false);
    };
  }, [enabled, quietRefresh, scheduleDebounced]);
}
