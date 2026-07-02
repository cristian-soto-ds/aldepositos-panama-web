"use client";

import { useCallback, useEffect, useState } from "react";
import { getSharedWorkPresenceTabId } from "@/lib/panelPresence";
import {
  isForeignLiveUpdate,
  subscribeLiveUpdates,
} from "@/lib/liveCollaboration";
import {
  fetchCollectionOrders,
  patchCollectionOrdersList,
  subscribeCollectionOrdersRealtime,
  type CollectionOrderRealtimeChange,
} from "@/lib/collectionOrders";
import type { CollectionOrder } from "@/lib/types/collectionOrder";

type Options = {
  enabled: boolean;
  userKey?: string | null;
};

export function useSupabaseCollectionOrders({ enabled, userKey }: Options) {
  const [orders, setOrders] = useState<CollectionOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!enabled) {
      setOrders([]);
      setLoading(false);
      return;
    }
    try {
      const list = await fetchCollectionOrders();
      setOrders((prev) => {
        const prevJson = JSON.stringify(prev);
        const nextJson = JSON.stringify(list);
        return prevJson === nextJson ? prev : list;
      });
    } catch (e) {
      console.error(e);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  const applyRealtimeChange = useCallback((change: CollectionOrderRealtimeChange) => {
    setOrders((prev) => {
      const patched = patchCollectionOrdersList(prev, change);
      return patched ?? prev;
    });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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
        prev.map((o) =>
          o.id === update.orderId ? { ...o, lines: update.lines } : o,
        ),
      );
    });
  }, [enabled, userKey]);

  useEffect(() => {
    if (!enabled) return;
    const lastFocusReloadRef = { current: 0 };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastFocusReloadRef.current < 30_000) return;
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

  return { orders, setOrders, reloadOrders: reload, ordersLoading: loading };
}
