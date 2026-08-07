"use client";

import React, { useCallback, useState } from "react";
import { useSupabaseCollectionOrders } from "@/hooks/useSupabaseCollectionOrders";
import {
  sortCollectionOrdersByNumero,
  updateCollectionOrder,
  fetchCollectionOrderById,
} from "@/lib/collectionOrders";
import type { CollectionOrder } from "@/lib/types/collectionOrder";
import {
  RECEPTION_RECEIPT_ON_STATUS,
  RECEPTION_STATUS,
  type ReceptionStatusId,
} from "@/lib/receptionLogistics/config";
import {
  addOrdersToReceptionGroup,
  createReceptionTruckGroup,
  removeOrderFromReceptionGroup,
  setCollectionOrderReceptionStatus,
  syncCollectionOrderToReceptionQueue,
} from "@/lib/receptionLogistics/repository";
import { CollectionOrderReceptionistView } from "@/components/control-panel/CollectionOrderReceptionistView";
import { useRampOccupancy } from "@/hooks/useRampOccupancy";

type ReceptionistModuleProps = {
  userEmail: string | null;
};

export function ReceptionistModule({ userEmail }: ReceptionistModuleProps) {
  const { orders, setOrders, ordersLoading } = useSupabaseCollectionOrders({
    enabled: !!userEmail,
    userKey: userEmail,
  });
  const [receptionBusyId, setReceptionBusyId] = useState<string | null>(null);
  const { occupancy: rampOccupancy, busyRamp, toggleRamp } = useRampOccupancy();

  const handleSetReceptionStatus = useCallback(
    async (orderId: string, status: ReceptionStatusId) => {
      const order = orders.find((o) => o.id === orderId);
      if (!order || order.receptionStatus === status) return;

      const busyKey = order.receptionGroupId || orderId;
      setReceptionBusyId(busyKey);
      try {
        const updated = await setCollectionOrderReceptionStatus(orderId, status, {
          issueReceipt: RECEPTION_RECEIPT_ON_STATUS.includes(status),
        });
        const byId = new Map(updated.map((o) => [o.id, o]));
        setOrders((prev) =>
          sortCollectionOrdersByNumero(
            prev.map((o) => byId.get(o.id) ?? o),
          ),
        );
      } catch (e) {
        console.error(e);
        alert(
          e instanceof Error
            ? e.message
            : "No se pudo actualizar el estado de recepción.",
        );
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
      const groupId = order.receptionGroupId;
      const mateIds = groupId
        ? orders
            .filter((o) => o.receptionGroupId === groupId && o.id !== orderId)
            .map((o) => o.id)
        : [];
      setReceptionBusyId(groupId || orderId);
      try {
        if (groupId) {
          await removeOrderFromReceptionGroup(orderId);
          const refreshedMates = await Promise.all(
            mateIds.map((id) => fetchCollectionOrderById(id)),
          );
          const mateById = new Map(
            refreshedMates
              .filter((o): o is CollectionOrder => !!o)
              .map((o) => [o.id, o]),
          );
          setOrders((prev) =>
            sortCollectionOrdersByNumero(
              prev.map((o) => {
                if (o.id === orderId) {
                  const {
                    receptionStatus: _s,
                    receptionGroupId: _g,
                    receptionQueuedAt: _q,
                    ...rest
                  } = o;
                  return { ...rest, updatedAt: new Date().toISOString() };
                }
                return mateById.get(o.id) ?? o;
              }),
            ),
          );
          return;
        }

        const {
          receptionStatus: _removed,
          receptionGroupId: _g,
          receptionQueuedAt: _q,
          ...rest
        } = order;
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
        alert(
          e instanceof Error
            ? e.message
            : "No se pudo quitar la orden de recepción.",
        );
      } finally {
        setReceptionBusyId(null);
      }
    },
    [orders, setOrders],
  );

  const handleCreateTruckGroup = useCallback(
    async (input: { orderIds: string[] }) => {
      setReceptionBusyId("__group__");
      try {
        const truck = await createReceptionTruckGroup(input);
        const queuedAt = new Date(truck.sortOrder).toISOString();
        const idSet = new Set(input.orderIds);
        setOrders((prev) =>
          sortCollectionOrdersByNumero(
            prev.map((o) =>
              idSet.has(o.id)
                ? {
                    ...o,
                    receptionStatus: RECEPTION_STATUS.EN_FILA,
                    receptionGroupId: truck.id,
                    receptionQueuedAt: o.receptionQueuedAt || queuedAt,
                    updatedAt: queuedAt,
                  }
                : o,
            ),
          ),
        );
      } catch (e) {
        console.error(e);
        alert(
          e instanceof Error
            ? e.message
            : "No se pudo crear el camión con esas OR.",
        );
        throw e;
      } finally {
        setReceptionBusyId(null);
      }
    },
    [setOrders],
  );

  const handleAddOrdersToTruckGroup = useCallback(
    async (input: { groupId: string; orderIds: string[] }) => {
      setReceptionBusyId("__group__");
      try {
        const truck = await addOrdersToReceptionGroup(input);
        const mates = orders.filter((o) => o.receptionGroupId === input.groupId);
        const groupStatus =
          mates.find((m) => m.receptionStatus)?.receptionStatus ??
          RECEPTION_STATUS.EN_FILA;
        const queuedAt =
          mates.find((m) => m.receptionQueuedAt)?.receptionQueuedAt ??
          new Date().toISOString();
        const idSet = new Set(input.orderIds);
        setOrders((prev) =>
          sortCollectionOrdersByNumero(
            prev.map((o) =>
              idSet.has(o.id)
                ? {
                    ...o,
                    receptionStatus: groupStatus,
                    receptionGroupId: truck.id,
                    receptionQueuedAt: o.receptionQueuedAt || queuedAt,
                    updatedAt: new Date().toISOString(),
                  }
                : o,
            ),
          ),
        );
      } catch (e) {
        console.error(e);
        alert(
          e instanceof Error
            ? e.message
            : "No se pudo agregar la OR al camión.",
        );
        throw e;
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
      rampOccupancy={rampOccupancy}
      rampBusy={busyRamp}
      onToggleRampOccupancy={(rampId) => void toggleRamp(rampId)}
      onSetReceptionStatus={(orderId, status) =>
        void handleSetReceptionStatus(orderId, status)
      }
      onClearReceptionStatus={(orderId) =>
        void handleClearReceptionStatus(orderId)
      }
      onCreateTruckGroup={handleCreateTruckGroup}
      onAddOrdersToTruckGroup={handleAddOrdersToTruckGroup}
    />
  );
}
