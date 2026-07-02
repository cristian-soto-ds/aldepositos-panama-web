"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchCollectionOrders,
  patchCollectionOrdersList,
  subscribeCollectionOrdersRealtime,
  type CollectionOrderRealtimeChange,
} from "@/lib/collectionOrders";
import type { CollectionOrder } from "@/lib/types/collectionOrder";

type Options = {
  enabled: boolean;
};

export function useSupabaseCollectionOrders({ enabled }: Options) {
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
      setOrders(list);
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
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void reload();
      }
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
