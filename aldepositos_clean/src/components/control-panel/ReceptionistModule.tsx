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
  markCollectionOrderPartialDelivery,
  removeOrderFromReceptionGroup,
  resumePartialDelivery,
  setCollectionOrderReceptionPriority,
  setCollectionOrderReceptionStatus,
  stripReceptionFields,
} from "@/lib/receptionLogistics/repository";
import {
  orderBultos,
  orderHasOpenPartialDelivery,
  orderReceivedBultos,
} from "@/lib/receptionLogistics/syncCollectionOrderReception";
import { CollectionOrderReceptionistView } from "@/components/control-panel/CollectionOrderReceptionistView";
import { useRampOccupancy } from "@/hooks/useRampOccupancy";

type ReceptionistModuleProps = {
  userEmail: string | null;
};

const RECEPTION_FIELD_KEYS = [
  "receptionStatus",
  "receptionGroupId",
  "receptionQueuedAt",
  "receptionPriority",
  "receptionPriorityAt",
  "receptionReceivedBultos",
  "receptionPartialHistory",
] as const satisfies readonly (keyof CollectionOrder)[];

type ReceptionFieldKey = (typeof RECEPTION_FIELD_KEYS)[number];

/** Solo campos de recepción — no pisar líneas Magaya (lista slim). */
function applyReceptionFields(
  base: CollectionOrder,
  patch: Partial<Pick<CollectionOrder, ReceptionFieldKey | "updatedAt">>,
): CollectionOrder {
  const next: CollectionOrder = {
    ...base,
    updatedAt: patch.updatedAt || base.updatedAt,
  };
  const target = next as Record<string, unknown>;
  for (const key of RECEPTION_FIELD_KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === undefined) delete target[key];
    else target[key] = value;
  }
  return next;
}

/** Copia todos los campos de recepción de la OR guardada en el servidor. */
function mergeReceptionFromServer(
  base: CollectionOrder,
  server: CollectionOrder,
): CollectionOrder {
  const patch: Partial<Pick<CollectionOrder, ReceptionFieldKey | "updatedAt">> =
    { updatedAt: server.updatedAt };
  const p = patch as Record<string, unknown>;
  for (const key of RECEPTION_FIELD_KEYS) p[key] = server[key];
  return applyReceptionFields(base, patch);
}

function clearReceptionFields(order: CollectionOrder, now: string): CollectionOrder {
  return { ...stripReceptionFields(order), updatedAt: now };
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

  const mergeServerOrders = useCallback(
    (updated: CollectionOrder[]) => {
      const byId = new Map(updated.map((o) => [o.id, o]));
      setOrders((prev) =>
        sortCollectionOrdersByNumero(
          prev.map((o) => {
            const u = byId.get(o.id);
            return u ? mergeReceptionFromServer(o, u) : o;
          }),
        ),
      );
    },
    [setOrders],
  );

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
        mergeServerOrders(updated);
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
    [orders, setOrders, mergeServerOrders],
  );

  const handleTogglePriority = useCallback(
    async (orderId: string) => {
      const order = orders.find((o) => o.id === orderId);
      if (!order) return;
      const on = order.receptionPriority !== true;
      const groupId = order.receptionGroupId;
      const now = new Date().toISOString();
      const prevSnapshot = orders;

      setOrders((prev) =>
        sortCollectionOrdersByNumero(
          prev.map((o) => {
            const inTruck = groupId ? o.receptionGroupId === groupId : o.id === orderId;
            if (!inTruck) return o;
            return on
              ? applyReceptionFields(o, {
                  receptionPriority: true,
                  receptionPriorityAt: o.receptionPriorityAt || now,
                  receptionStatus: o.receptionStatus ?? RECEPTION_STATUS.EN_FILA,
                  receptionQueuedAt: o.receptionQueuedAt || now,
                  updatedAt: now,
                })
              : applyReceptionFields(o, {
                  receptionPriority: undefined,
                  receptionPriorityAt: undefined,
                  updatedAt: now,
                });
          }),
        ),
      );

      setReceptionBusyId(groupId || orderId);
      try {
        mergeServerOrders(await setCollectionOrderReceptionPriority(orderId, on));
      } catch (e) {
        console.error(e);
        setOrders(prevSnapshot);
        alert(e instanceof Error ? e.message : "No se pudo cambiar la prioridad.");
      } finally {
        setReceptionBusyId(null);
      }
    },
    [orders, setOrders, mergeServerOrders],
  );

  const handleMarkPartialDelivery = useCallback(
    async (orderId: string, arrivedBultos: number) => {
      const order = orders.find((o) => o.id === orderId);
      if (!order) return;
      const now = new Date().toISOString();
      const total = orderBultos(order);
      const prevReceived = orderHasOpenPartialDelivery(order)
        ? orderReceivedBultos(order)
        : 0;
      const received = Math.min(total, prevReceived + Math.round(arrivedBultos));
      const prevSnapshot = orders;

      setOrders((prev) =>
        sortCollectionOrdersByNumero(
          prev.map((o) =>
            o.id !== orderId
              ? o
              : applyReceptionFields(o, {
                  receptionStatus:
                    received >= total
                      ? RECEPTION_STATUS.COMPLETADO
                      : RECEPTION_STATUS.PARCIAL,
                  receptionGroupId: undefined,
                  receptionPriority: undefined,
                  receptionPriorityAt: undefined,
                  receptionReceivedBultos: received,
                  receptionQueuedAt: o.receptionQueuedAt || now,
                  updatedAt: now,
                }),
          ),
        ),
      );

      setReceptionBusyId(order.receptionGroupId || orderId);
      try {
        mergeServerOrders(
          await markCollectionOrderPartialDelivery(orderId, arrivedBultos),
        );
      } catch (e) {
        console.error(e);
        setOrders(prevSnapshot);
        alert(
          e instanceof Error
            ? e.message
            : "No se pudo registrar la entrega parcial.",
        );
        throw e;
      } finally {
        setReceptionBusyId(null);
      }
    },
    [orders, setOrders, mergeServerOrders],
  );

  const handleResumePartialDelivery = useCallback(
    async (orderId: string) => {
      const order = orders.find((o) => o.id === orderId);
      if (!order) return;
      const now = new Date().toISOString();
      const prevSnapshot = orders;

      setOrders((prev) =>
        sortCollectionOrdersByNumero(
          prev.map((o) =>
            o.id !== orderId
              ? o
              : applyReceptionFields(o, {
                  receptionStatus: RECEPTION_STATUS.EN_FILA,
                  receptionQueuedAt: now,
                  updatedAt: now,
                }),
          ),
        ),
      );

      setReceptionBusyId(orderId);
      try {
        mergeServerOrders(await resumePartialDelivery(orderId));
      } catch (e) {
        console.error(e);
        setOrders(prevSnapshot);
        alert(
          e instanceof Error
            ? e.message
            : "No se pudo devolver la OR a la fila.",
        );
      } finally {
        setReceptionBusyId(null);
      }
    },
    [orders, setOrders, mergeServerOrders],
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
      onTogglePriority={(orderId) => void handleTogglePriority(orderId)}
      onMarkPartialDelivery={handleMarkPartialDelivery}
      onResumePartialDelivery={(orderId) =>
        void handleResumePartialDelivery(orderId)
      }
    />
  );
}
