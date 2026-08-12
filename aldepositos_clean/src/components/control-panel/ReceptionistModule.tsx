"use client";

import React, { useCallback, useState } from "react";
import { useSupabaseCollectionOrders } from "@/hooks/useSupabaseCollectionOrders";
import { sortCollectionOrdersByNumero } from "@/lib/collectionOrders";
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
} from "@/lib/receptionLogistics/repository";
import { CollectionOrderReceptionistView } from "@/components/control-panel/CollectionOrderReceptionistView";
import { useRampOccupancy } from "@/hooks/useRampOccupancy";

type ReceptionistModuleProps = {
  userEmail: string | null;
};

/** Solo campos de recepción — no pisar líneas Magaya (lista slim). */
function applyReceptionFields(
  base: CollectionOrder,
  patch: Pick<
    CollectionOrder,
    | "receptionStatus"
    | "receptionGroupId"
    | "receptionQueuedAt"
    | "updatedAt"
  > &
    Partial<CollectionOrder>,
): CollectionOrder {
  const next: CollectionOrder = {
    ...base,
    updatedAt: patch.updatedAt || base.updatedAt,
  };
  if ("receptionStatus" in patch) {
    if (patch.receptionStatus === undefined) {
      delete next.receptionStatus;
    } else {
      next.receptionStatus = patch.receptionStatus;
    }
  }
  if ("receptionGroupId" in patch) {
    if (patch.receptionGroupId === undefined) {
      delete next.receptionGroupId;
    } else {
      next.receptionGroupId = patch.receptionGroupId;
    }
  }
  if ("receptionQueuedAt" in patch) {
    if (patch.receptionQueuedAt === undefined) {
      delete next.receptionQueuedAt;
    } else {
      next.receptionQueuedAt = patch.receptionQueuedAt;
    }
  }
  return next;
}

function clearReceptionFields(order: CollectionOrder, now: string): CollectionOrder {
  const {
    receptionStatus: _s,
    receptionGroupId: _g,
    receptionQueuedAt: _q,
    ...rest
  } = order;
  return { ...rest, updatedAt: now };
}

export function ReceptionistModule({ userEmail }: ReceptionistModuleProps) {
  const { orders, setOrders, ordersLoading, reloadOrders } =
    useSupabaseCollectionOrders({
      enabled: !!userEmail,
      userKey: userEmail,
      mode: "receptionist",
    });
  const [receptionBusyId, setReceptionBusyId] = useState<string | null>(null);
  const { occupancy: rampOccupancy, busyRamp, toggleRamp } = useRampOccupancy();

  const handleSetReceptionStatus = useCallback(
    async (orderId: string, status: ReceptionStatusId) => {
      const order = orders.find((o) => o.id === orderId);
      if (!order || order.receptionStatus === status) return;

      const groupId = order.receptionGroupId;
      const busyKey = groupId || orderId;
      const now = new Date().toISOString();
      const prevSnapshot = orders;

      // UI inmediata (optimista).
      setOrders((prev) =>
        sortCollectionOrdersByNumero(
          prev.map((o) => {
            if (status === RECEPTION_STATUS.COMPLETADO && groupId) {
              if (o.id === orderId) {
                return applyReceptionFields(clearReceptionFields(o, now), {
                  receptionStatus: RECEPTION_STATUS.COMPLETADO,
                  receptionQueuedAt: o.receptionQueuedAt || now,
                  updatedAt: now,
                });
              }
              const mates = prev.filter(
                (x) => x.receptionGroupId === groupId && x.id !== orderId,
              );
              if (mates.length === 1 && o.id === mates[0]!.id) {
                const { receptionGroupId: _g, ...rest } = o;
                return { ...rest, updatedAt: now };
              }
              return o;
            }
            if (groupId) {
              if (o.receptionGroupId !== groupId) return o;
              return applyReceptionFields(o, {
                receptionStatus: status,
                receptionGroupId: groupId,
                receptionQueuedAt: o.receptionQueuedAt || now,
                updatedAt: now,
              });
            }
            if (o.id !== orderId) return o;
            return applyReceptionFields(o, {
              receptionStatus: status,
              receptionQueuedAt: o.receptionQueuedAt || now,
              updatedAt: now,
            });
          }),
        ),
      );

      setReceptionBusyId(busyKey);
      try {
        const updated = await setCollectionOrderReceptionStatus(orderId, status, {
          issueReceipt: RECEPTION_RECEIPT_ON_STATUS.includes(status),
        });
        const byId = new Map(updated.map((o) => [o.id, o]));
        setOrders((prev) =>
          sortCollectionOrdersByNumero(
            prev.map((o) => {
              const u = byId.get(o.id);
              if (!u) {
                // Tras LISTO en grupo, la OR saliente ya no trae groupId.
                if (
                  status === RECEPTION_STATUS.COMPLETADO &&
                  groupId &&
                  o.receptionGroupId === groupId &&
                  !updated.some((x) => x.id === o.id)
                ) {
                  return o;
                }
                return o;
              }
              return applyReceptionFields(o, {
                receptionStatus: u.receptionStatus,
                receptionGroupId: u.receptionGroupId,
                receptionQueuedAt: u.receptionQueuedAt,
                updatedAt: u.updatedAt,
              });
            }),
          ),
        );
      } catch (e) {
        console.error(e);
        setOrders(prevSnapshot);
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
      const mates = groupId
        ? orders.filter((o) => o.receptionGroupId === groupId && o.id !== orderId)
        : [];
      const now = new Date().toISOString();
      const prevSnapshot = orders;

      setOrders((prev) =>
        sortCollectionOrdersByNumero(
          prev.map((o) => {
            if (o.id === orderId) return clearReceptionFields(o, now);
            if (groupId && mates.length === 1 && o.id === mates[0]!.id) {
              const { receptionGroupId: _g, ...rest } = o;
              return { ...rest, updatedAt: now };
            }
            return o;
          }),
        ),
      );

      setReceptionBusyId(groupId || orderId);
      try {
        await removeOrderFromReceptionGroup(orderId);
      } catch (e) {
        console.error(e);
        setOrders(prevSnapshot);
        void reloadOrders();
        alert(
          e instanceof Error
            ? e.message
            : "No se pudo quitar la orden de recepción.",
        );
      } finally {
        setReceptionBusyId(null);
      }
    },
    [orders, setOrders, reloadOrders],
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
                ? applyReceptionFields(o, {
                    receptionStatus: RECEPTION_STATUS.EN_FILA,
                    receptionGroupId: truck.id,
                    receptionQueuedAt: o.receptionQueuedAt || queuedAt,
                    updatedAt: queuedAt,
                  })
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
                ? applyReceptionFields(o, {
                    receptionStatus: groupStatus,
                    receptionGroupId: truck.id,
                    receptionQueuedAt: o.receptionQueuedAt || queuedAt,
                    updatedAt: new Date().toISOString(),
                  })
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
