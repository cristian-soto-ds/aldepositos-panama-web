"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSharedWorkPresenceTabId } from "@/lib/panelPresence";
import {
  isForeignLiveUpdate,
  subscribeLiveUpdates,
} from "@/lib/liveCollaboration";
import {
  collectionOrdersListFingerprint,
  fetchCollectionOrders,
  fetchCollectionOrdersForReceptionist,
  mergeCollectionOrdersSnapshot,
  patchCollectionOrdersList,
  rememberDeletedCollectionOrder,
  slimCollectionOrderForReceptionist,
  subscribeCollectionOrdersRealtime,
  type CollectionOrderRealtimeChange,
} from "@/lib/collectionOrders";
import {
  mergeConcurrentCollectionLines,
  isIncompleteCollectionRemote,
} from "@/lib/collectionOrderLineMerge";
import type { CollectionOrder } from "@/lib/types/collectionOrder";

type Options = {
  enabled: boolean;
  userKey?: string | null;
  /**
   * `receptionist`: lista sin líneas Magaya (RPC slim) — tabs + fila/rampa.
   * `full`: payload completo (módulo OR / edición).
   */
  mode?: "full" | "receptionist";
};

export function useSupabaseCollectionOrders({
  enabled,
  userKey,
  mode = "full",
}: Options) {
  const [orders, setOrders] = useState<CollectionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const slim = mode === "receptionist";
  /** Último cambio realtime por OR (ms locales): el snapshot no lo pisa. */
  const realtimeTouchedAtRef = useRef<Map<string, number>>(new Map());
  const reloadInFlightRef = useRef<Promise<void> | null>(null);
  const reloadQueuedRef = useRef(false);
  const configGenerationRef = useRef(0);

  const reloadOnce = useCallback(async () => {
    if (!enabled) {
      setOrders([]);
      setReloadError(null);
      setLoading(false);
      return;
    }
    const generation = configGenerationRef.current;
    const startedAt = Date.now();
    try {
      const list = slim
        ? await fetchCollectionOrdersForReceptionist()
        : await fetchCollectionOrders();
      if (generation !== configGenerationRef.current) return;
      setReloadError(null);
      const touched = realtimeTouchedAtRef.current;
      setOrders((prev) => {
        const merged = mergeCollectionOrdersSnapshot({
          prev,
          snapshot: list,
          snapshotStartedAt: startedAt,
          touchedSince: (id) => (touched.get(id) ?? 0) >= startedAt,
        });
        return collectionOrdersListFingerprint(prev) ===
          collectionOrdersListFingerprint(merged)
          ? prev
          : merged;
      });
      for (const [id, at] of touched) {
        if (at < startedAt) touched.delete(id);
      }
    } catch (e) {
      console.error(e);
      // No vaciar la lista: un fallo de red no debe “borrar” las OR de la UI.
      setReloadError(
        e instanceof Error
          ? e.message
          : "No se pudieron recargar las órdenes de recolección.",
      );
    } finally {
      setLoading(false);
    }
  }, [enabled, slim]);

  const reloadOnceRef = useRef(reloadOnce);
  reloadOnceRef.current = reloadOnce;

  useEffect(() => {
    configGenerationRef.current += 1;
  }, [enabled, slim]);

  /** Un solo reload a la vez; pedidos durante uno en curso se agrupan en otro al terminar. */
  const reload = useCallback((): Promise<void> => {
    if (reloadInFlightRef.current) {
      reloadQueuedRef.current = true;
      return reloadInFlightRef.current;
    }
    const run = async () => {
      do {
        reloadQueuedRef.current = false;
        await reloadOnceRef.current();
      } while (reloadQueuedRef.current);
    };
    const p = run().finally(() => {
      reloadInFlightRef.current = null;
    });
    reloadInFlightRef.current = p;
    return p;
  }, []);

  const applyRealtimeChange = useCallback(
    (change: CollectionOrderRealtimeChange) => {
      realtimeTouchedAtRef.current.set(change.id, Date.now());
      if (change.eventType === "DELETE") {
        rememberDeletedCollectionOrder(change.id);
      }
      const normalized: CollectionOrderRealtimeChange =
        slim && change.order
          ? {
              ...change,
              order: slimCollectionOrderForReceptionist(change.order),
            }
          : change;
      setOrders((prev) => {
        const patched = patchCollectionOrdersList(prev, normalized);
        return patched ?? prev;
      });
    },
    [slim],
  );

  useEffect(() => {
    void reload();
  }, [reload, enabled, slim]);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = subscribeCollectionOrdersRealtime({
      onChange: applyRealtimeChange,
      onReload: reload,
    });
    return () => {
      unsubscribe();
    };
  }, [enabled, reload, applyRealtimeChange]);

  useEffect(() => {
    if (!enabled) return;
    const tabId = getSharedWorkPresenceTabId();
    return subscribeLiveUpdates((update) => {
      if (update.type !== "order") return;
      if (!isForeignLiveUpdate(update, tabId)) return;
      setOrders((prev) =>
        prev.map((o) => {
          if (o.id !== update.orderId) return o;
          const incoming = Array.isArray(update.lines) ? update.lines : [];
          // Broadcast mid-edit puede traer un subset; no reemplazar la lista.
          if (isIncompleteCollectionRemote(o.lines, o.lines, incoming)) {
            return o;
          }
          const merged = mergeConcurrentCollectionLines(
            o.lines,
            o.lines,
            incoming,
          );
          return { ...o, lines: merged };
        }),
      );
    });
  }, [enabled, userKey]);

  useEffect(() => {
    if (!enabled) return;
    const lastFocusReloadRef = { current: 0 };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastFocusReloadRef.current < 90_000) return;
      lastFocusReloadRef.current = now;
      void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [enabled, reload]);

  return {
    orders,
    setOrders,
    reloadOrders: reload,
    ordersLoading: loading,
    ordersReloadError: reloadError,
  };
}
