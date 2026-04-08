import { supabase } from "@/lib/supabase";
import type { CollectionOrder } from "@/lib/types/collectionOrder";

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

const COLLECTION_REALTIME_DEBOUNCE_MS = 250;

export function subscribeCollectionOrdersRealtime(onReload: () => void): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReload = () => {
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
      () => {
        scheduleReload();
      },
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR") {
        console.warn(
          "[Supabase Realtime] Error en el canal de `collection_orders`.",
        );
      }
    });

  return () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    void supabase.removeChannel(channel);
  };
}
