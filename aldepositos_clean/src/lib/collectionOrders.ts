import { supabase } from "@/lib/supabase";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import type { CollectionOrder } from "@/lib/types/collectionOrder";
import type { DbPayloadRow } from "@/lib/realtimePatch";

function isCollectionOrder(value: unknown): value is CollectionOrder {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "cliente" in value &&
    "proveedor" in value &&
    Array.isArray((value as CollectionOrder).lines)
  );
}

export async function fetchCollectionOrders(): Promise<CollectionOrder[]> {
  const { data, error } = await supabase
    .from("collection_orders")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as { payload: unknown }[];
  return rows.map((r) => r.payload).filter(isCollectionOrder);
}

export async function insertCollectionOrder(order: CollectionOrder): Promise<void> {
  const { error } = await supabase.from("collection_orders").insert({
    id: order.id,
    payload: order,
  });
  if (error) throw error;
}

export async function updateCollectionOrder(order: CollectionOrder): Promise<void> {
  const { error } = await supabase
    .from("collection_orders")
    .update({
      payload: order,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);
  if (error) throw error;
}

export async function deleteCollectionOrderById(id: string): Promise<void> {
  const { error } = await supabase.from("collection_orders").delete().eq("id", id);
  if (error) throw error;
}

const COLLECTION_REALTIME_DEBOUNCE_MS = 50;

export type CollectionOrderRealtimeChange = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  order: CollectionOrder | null;
};

function orderFromDbRow(row: DbPayloadRow | null | undefined): CollectionOrder | null {
  if (!row?.id) return null;
  if (!isCollectionOrder(row.payload)) return null;
  if (row.payload.id !== row.id) {
    return { ...row.payload, id: row.id };
  }
  return row.payload;
}

function parseCollectionOrderChange(
  payload: RealtimePostgresChangesPayload<DbPayloadRow>,
): CollectionOrderRealtimeChange | null {
  const eventType = payload.eventType;
  if (eventType === "DELETE") {
    const id = payload.old?.id;
    if (!id) return null;
    return { eventType, id, order: null };
  }
  const row = payload.new;
  if (!row?.id) return null;
  return {
    eventType,
    id: row.id,
    order: orderFromDbRow(row),
  };
}

export function patchCollectionOrdersList(
  prev: CollectionOrder[],
  change: CollectionOrderRealtimeChange,
): CollectionOrder[] | null {
  if (change.eventType === "DELETE") {
    return prev.filter((o) => o.id !== change.id);
  }
  if (!change.order) return null;
  const exists = prev.some((o) => o.id === change.id);
  if (change.eventType === "INSERT" && !exists) {
    return [change.order, ...prev];
  }
  if (exists) {
    return prev.map((o) => (o.id === change.id ? change.order! : o));
  }
  return [change.order, ...prev];
}

type CollectionOrdersRealtimeHandlers = {
  onChange?: (change: CollectionOrderRealtimeChange) => void;
  onReload?: () => void;
};

export function subscribeCollectionOrdersRealtime(
  handlers: CollectionOrdersRealtimeHandlers | (() => void),
): () => void {
  const { onChange, onReload } =
    typeof handlers === "function"
      ? { onChange: undefined, onReload: handlers }
      : handlers;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReload = () => {
    if (!onReload) return;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onReload();
    }, COLLECTION_REALTIME_DEBOUNCE_MS);
  };

  const channel = supabase
    .channel("public-collection-orders-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "collection_orders" },
      (payload: RealtimePostgresChangesPayload<DbPayloadRow>) => {
        const change = parseCollectionOrderChange(payload);
        if (change) {
          onChange?.(change);
          if (!change.order && change.eventType !== "DELETE") {
            scheduleReload();
            return;
          }
        }
        scheduleReload();
      },
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR") {
        console.warn(
          "[Supabase Realtime] Error en el canal de `collection_orders`.",
        );
        scheduleReload();
      }
      if (status === "SUBSCRIBED") {
        scheduleReload();
      }
    });

  return () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    void supabase.removeChannel(channel);
  };
}
