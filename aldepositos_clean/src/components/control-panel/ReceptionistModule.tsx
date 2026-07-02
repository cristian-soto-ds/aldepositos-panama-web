"use client";

import React, { useCallback, useState } from "react";
import { useSupabaseCollectionOrders } from "@/hooks/useSupabaseCollectionOrders";
import { useRampOccupancy } from "@/hooks/useRampOccupancy";
import {
  sortCollectionOrdersByNumero,
  updateCollectionOrder,
} from "@/lib/collectionOrders";
import type { CollectionOrder } from "@/lib/types/collectionOrder";
import type { ReceptionStatusId } from "@/lib/receptionLogistics/config";
import { syncCollectionOrderToReceptionQueue } from "@/lib/receptionLogistics/repository";
import { CollectionOrderReceptionistView } from "@/components/control-panel/CollectionOrderReceptionistView";

type ReceptionistModuleProps = {
  userEmail: string | null;
};

export function ReceptionistModule({ userEmail }: ReceptionistModuleProps) {
  const { orders, setOrders, ordersLoading } = useSupabaseCollectionOrders({
    enabled: !!userEmail,
    userKey: userEmail,
  });
  const [receptionBusyId, setReceptionBusyId] = useState<string | null>(null);
  const { occupancy, busyRamp, toggleRamp } = useRampOccupancy(!!userEmail);

  const handleSetReceptionStatus = useCallback(
    async (orderId: string, status: ReceptionStatusId) => {
      const order = orders.find((o) => o.id === orderId);
      if (!order || order.receptionStatus === status) return;
      setReceptionBusyId(orderId);
      try {
        const payload: CollectionOrder = {
          ...order,
          receptionStatus: status,
          updatedAt: new Date().toISOString(),
        };
        await updateCollectionOrder(payload);
        setOrders((prev) =>
          sortCollectionOrdersByNumero(
            prev.map((o) => (o.id === orderId ? payload : o)),
          ),
        );
        await syncCollectionOrderToReceptionQueue(payload);
      } catch (e) {
        console.error(e);
        alert("No se pudo actualizar el estado de recepción.");
      } finally {
        setReceptionBusyId(null);
      }
    },
    [orders, setOrders],
  );

  const handleClearReceptionStatus = useCallback(
    async (orderId: string) => {
      const order = orders.find((o) => o.id === orderId);
      if (!order?.receptionStatus) return;
      setReceptionBusyId(orderId);
      try {
        const { receptionStatus: _removed, ...rest } = order;
        const payload: CollectionOrder = {
          ...rest,
          updatedAt: new Date().toISOString(),
        };
        await updateCollectionOrder(payload);
        setOrders((prev) =>
          sortCollectionOrdersByNumero(
            prev.map((o) => (o.id === orderId ? payload : o)),
          ),
        );
        await syncCollectionOrderToReceptionQueue(payload);
      } catch (e) {
        console.error(e);
        alert("No se pudo quitar la orden de recepción.");
      } finally {
        setReceptionBusyId(null);
      }
    },
    [orders, setOrders],
  );

  return (
    <CollectionOrderReceptionistView
      standalone
      orders={orders}
      loading={ordersLoading}
      busyOrderId={receptionBusyId}
      rampOccupancy={occupancy}
      rampOccupancyBusy={busyRamp}
      onToggleRampOccupancy={(rampId) => void toggleRamp(rampId)}
      onSetReceptionStatus={(orderId, status) =>
        void handleSetReceptionStatus(orderId, status)
      }
      onClearReceptionStatus={(orderId) =>
        void handleClearReceptionStatus(orderId)
      }
    />
  );
}
