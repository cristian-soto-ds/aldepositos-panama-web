/**
 * Sincronización efímera vía Supabase Broadcast (mientras escriben, antes del autosave).
 * Complementa postgres_changes: el panel y los editores ven cambios en ~80–150 ms.
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { getSharedWorkPresenceTabId } from "@/lib/panelPresence";
import type { CollectionOrderLine } from "@/lib/types/collectionOrder";

export const COLLAB_CHANNEL = "aldepositos-collab-v1";
export const COLLAB_PUBLISH_DEBOUNCE_MS = 220;

export type TaskLiveUpdate = {
  type: "task";
  taskId: string;
  tabId: string;
  userKey: string;
  measureData: unknown[];
  currentBultos: number;
  status: string;
  /** Peso capturado (kg) para monitores sin measureData completo. */
  capturedWeight?: number;
  rowCount?: number;
  completeRowCount?: number;
  /** Modo de captura activo (con/sin refs o paletizado) para sincronizarlo entre vistas/dispositivos. */
  referenceMode?: string;
  seq: number;
  at: number;
};

export type OrderLiveUpdate = {
  type: "order";
  orderId: string;
  tabId: string;
  userKey: string;
  lines: CollectionOrderLine[];
  seq: number;
  at: number;
};

export type LiveUpdate = TaskLiveUpdate | OrderLiveUpdate;

type LiveListener = (update: LiveUpdate) => void;

const listeners = new Set<LiveListener>();
let channel: RealtimeChannel | null = null;
let subscribePromise: Promise<void> | null = null;
const publishTimers = new Map<string, ReturnType<typeof setTimeout>>();
const seqByTabKey = new Map<string, number>();

function ensureChannel(): Promise<void> {
  if (subscribePromise) return subscribePromise;
  subscribePromise = new Promise((resolve) => {
    const ch = supabase.channel(COLLAB_CHANNEL, {
      config: { broadcast: { self: false } },
    });
    ch.on("broadcast", { event: "live" }, ({ payload }) => {
      const update = payload as LiveUpdate;
      if (!update?.type) return;
      for (const fn of listeners) fn(update);
    }).subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
    channel = ch;
  });
  return subscribePromise;
}

export function subscribeLiveUpdates(listener: LiveListener): () => void {
  listeners.add(listener);
  void ensureChannel();
  return () => {
    listeners.delete(listener);
  };
}

function nextSeq(tabKey: string): number {
  const n = (seqByTabKey.get(tabKey) ?? 0) + 1;
  seqByTabKey.set(tabKey, n);
  return n;
}

function schedulePublish(key: string, fn: () => void) {
  const existing = publishTimers.get(key);
  if (existing) clearTimeout(existing);
  publishTimers.set(
    key,
    setTimeout(() => {
      publishTimers.delete(key);
      fn();
    }, COLLAB_PUBLISH_DEBOUNCE_MS),
  );
}

export function scheduleTaskLivePublish(params: {
  taskId: string;
  userKey: string;
  measureData: unknown[];
  currentBultos: number;
  status: string;
  capturedWeight?: number;
  rowCount?: number;
  completeRowCount?: number;
  referenceMode?: string;
}) {
  const key = `task:${params.taskId}`;
  schedulePublish(key, () => {
    void publishTaskLiveUpdate(params);
  });
}

async function publishTaskLiveUpdate(params: {
  taskId: string;
  userKey: string;
  measureData: unknown[];
  currentBultos: number;
  status: string;
  capturedWeight?: number;
  rowCount?: number;
  completeRowCount?: number;
  referenceMode?: string;
}) {
  await ensureChannel();
  if (!channel) return;
  const tabId = getSharedWorkPresenceTabId();
  const update: TaskLiveUpdate = {
    type: "task",
    taskId: params.taskId,
    tabId,
    userKey: params.userKey,
    measureData: JSON.parse(JSON.stringify(params.measureData)),
    currentBultos: params.currentBultos,
    status: params.status,
    capturedWeight: params.capturedWeight,
    rowCount: params.rowCount,
    completeRowCount: params.completeRowCount,
    referenceMode: params.referenceMode,
    seq: nextSeq(`${tabId}:task:${params.taskId}`),
    at: Date.now(),
  };
  await channel.send({ type: "broadcast", event: "live", payload: update });
}

export function scheduleOrderLivePublish(params: {
  orderId: string;
  userKey: string;
  lines: CollectionOrderLine[];
}) {
  const key = `order:${params.orderId}`;
  schedulePublish(key, () => {
    void publishOrderLiveUpdate(params);
  });
}

async function publishOrderLiveUpdate(params: {
  orderId: string;
  userKey: string;
  lines: CollectionOrderLine[];
}) {
  await ensureChannel();
  if (!channel) return;
  const tabId = getSharedWorkPresenceTabId();
  const update: OrderLiveUpdate = {
    type: "order",
    orderId: params.orderId,
    tabId,
    userKey: params.userKey,
    lines: JSON.parse(JSON.stringify(params.lines)) as CollectionOrderLine[],
    seq: nextSeq(`${tabId}:order:${params.orderId}`),
    at: Date.now(),
  };
  await channel.send({ type: "broadcast", event: "live", payload: update });
}

export function isForeignLiveUpdate(
  update: LiveUpdate,
  myTabId: string,
): boolean {
  return update.tabId !== myTabId;
}
