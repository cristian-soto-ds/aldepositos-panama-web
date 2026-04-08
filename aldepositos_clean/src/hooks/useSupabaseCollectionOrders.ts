"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchCollectionOrders,
  subscribeCollectionOrdersRealtime,
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

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = subscribeCollectionOrdersRealtime(() => {
      void reload();
    });
    return () => {
      unsubscribe();
    };
  }, [enabled, reload]);

  return { orders, setOrders, reloadOrders: reload, ordersLoading: loading };
}
