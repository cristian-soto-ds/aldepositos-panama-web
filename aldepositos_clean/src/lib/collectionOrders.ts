import { supabase } from "@/lib/supabase";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { normalizeCollectionOrderFields } from "@/lib/collectionOrderReconcile";
import { normalizeOrNumero } from "@/lib/parseCollectionOrdersHtm";
import { RECEPTION_STATUS } from "@/lib/receptionLogistics/config";
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

/** Número OR para ordenar (solo dígitos; sin número → 0). */
export function parseCollectionOrderNumber(n: string | undefined): number {
  const raw = String(n ?? "").trim();
  if (!raw) return 0;
  const onlyDigits = raw.replace(/\D+/g, "");
  if (!onlyDigits) return 0;
  const val = parseInt(onlyDigits, 10);
  return Number.isFinite(val) ? val : 0;
}

/** Lista por número de orden (descendente: mayor a menor). */
export function sortCollectionOrdersByNumero(
  orders: CollectionOrder[],
): CollectionOrder[] {
  return [...orders].sort((a, b) => {
    const na = parseCollectionOrderNumber(a.numero);
    const nb = parseCollectionOrderNumber(b.numero);
    if (na !== nb) return nb - na;
    return String(b.id).localeCompare(String(a.id));
  });
}

/** Otro OR con el mismo número Magaya (normalizado), excluyendo `excludeId`. */
export function findOtherOrderWithNumero(
  orders: CollectionOrder[],
  numero: string | undefined,
  excludeId?: string,
): CollectionOrder | undefined {
  const key = normalizeOrNumero(numero);
  if (!key) return undefined;
  return orders.find(
    (o) => o.id !== excludeId && normalizeOrNumero(o.numero) === key,
  );
}

/** Bodega = recepción completada. Requisito para transferir OR → RA. */
export function isCollectionOrderInBodega(order: CollectionOrder): boolean {
  return order.receptionStatus === RECEPTION_STATUS.COMPLETADO;
}

export function collectionOrderTransferBlockedReason(
  order: CollectionOrder,
): string | null {
  if (!isCollectionOrderInBodega(order)) {
    return "El OR debe estar en bodega (Completado) antes de transferirlo a un RA.";
  }
  return null;
}

export function upsertCollectionOrderInList(
  prev: CollectionOrder[],
  order: CollectionOrder,
): CollectionOrder[] {
  return sortCollectionOrdersByNumero([
    ...prev.filter((o) => o.id !== order.id),
    order,
  ]);
}

export async function fetchCollectionOrders(): Promise<CollectionOrder[]> {
  // PostgREST/Supabase trunca en 1000 filas por defecto; con >1000 OR el reload
  // “borra” altas recientes de la UI aunque existan en BD.
  const pageSize = 1000;
  const allRows: { id?: string; payload: unknown; updated_at?: string }[] = [];
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("collection_orders")
      .select("id, payload, updated_at")
      .order("updated_at", { ascending: false })
      .range(from, to);
    if (error) throw error;
    const chunk = (data ?? []) as {
      id?: string;
      payload: unknown;
      updated_at?: string;
    }[];
    allRows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
    // Safety: avoid infinite loops if API misbehaves
    if (from > 100_000) break;
  }

  return sortCollectionOrdersByNumero(
    allRows
      .map((r) => r.payload)
      .filter(isCollectionOrder)
      .map((order) => normalizeCollectionOrderFields(order)),
  );
}

/**
 * Solo OR que ya están en el tablero de recepción (tienen receptionStatus).
 * Evita paginar toda la tabla de collection_orders en cada hydrate del kanban.
 */
export async function fetchCollectionOrdersForReception(): Promise<
  CollectionOrder[]
> {
  const pageSize = 500;
  const allRows: { id?: string; payload: unknown }[] = [];
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("collection_orders")
      .select("id, payload")
      .not("payload->>receptionStatus", "is", null)
      .neq("payload->>receptionStatus", "")
      .order("updated_at", { ascending: false })
      .range(from, to);
    if (error) throw error;
    const chunk = (data ?? []) as { id?: string; payload: unknown }[];
    allRows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
    if (from > 20_000) break;
  }

  return allRows
    .map((r) => r.payload)
    .filter(isCollectionOrder)
    .filter((o) => !!o.receptionStatus)
    .map((order) => normalizeCollectionOrderFields(order));
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
  const { data, error } = await supabase
    .from("collection_orders")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  // RLS a veces “tiene éxito” sin borrar filas: verificar.
  if (!data || data.length === 0) {
    const still = await fetchCollectionOrderById(id);
    if (still) {
      throw new Error(
        "No se pudo eliminar la orden (sin permiso o la fila sigue en la base).",
      );
    }
  }
}

/** Una sola orden (evita cargar toda la tabla al sincronizar recepción). */
export async function fetchCollectionOrderById(
  id: string,
): Promise<CollectionOrder | null> {
  const { data, error } = await supabase
    .from("collection_orders")
    .select("id, payload")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return orderFromDbRow(data as DbPayloadRow | null);
}

const COLLECTION_REALTIME_DEBOUNCE_MS = 250;

export type CollectionOrderRealtimeChange = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  order: CollectionOrder | null;
};

function orderFromDbRow(row: DbPayloadRow | null | undefined): CollectionOrder | null {
  if (!row?.id) return null;
  if (!isCollectionOrder(row.payload)) return null;
  const order =
    row.payload.id !== row.id ? { ...row.payload, id: row.id } : row.payload;
  return normalizeCollectionOrderFields(order);
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
    return sortCollectionOrdersByNumero([...prev, change.order]);
  }
  if (exists) {
    return sortCollectionOrdersByNumero(
      prev.map((o) => (o.id === change.id ? change.order! : o)),
    );
  }
  return sortCollectionOrdersByNumero([...prev, change.order]);
}

type CollectionOrdersRealtimeHandlers = {
  onChange?: (change: CollectionOrderRealtimeChange) => void;
  onReload?: () => void;
};

type CollectionOrdersListener = {
  handlers: CollectionOrdersRealtimeHandlers;
  scheduleReload: () => void;
  clearDebounce: () => void;
};

const COLLECTION_ORDERS_CHANNEL_ID = "public-collection-orders-changes";

let collectionOrdersListeners = new Set<CollectionOrdersListener>();
let collectionOrdersChannel: ReturnType<typeof supabase.channel> | null = null;

function dispatchCollectionOrderPayload(
  payload: RealtimePostgresChangesPayload<DbPayloadRow>,
) {
  const change = parseCollectionOrderChange(payload);
  for (const listener of collectionOrdersListeners) {
    const { onChange, onReload } = listener.handlers;
    if (change) {
      onChange?.(change);
      const canPatchLocally =
        change.eventType === "DELETE" || change.order != null;
      if (onChange && canPatchLocally) {
        continue;
      }
      listener.scheduleReload();
      continue;
    }
    if (onReload) listener.scheduleReload();
  }
}

function ensureCollectionOrdersChannel() {
  if (collectionOrdersChannel) return;

  collectionOrdersChannel = supabase
    .channel(COLLECTION_ORDERS_CHANNEL_ID)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "collection_orders" },
      dispatchCollectionOrderPayload,
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR") {
        console.warn(
          "[Supabase Realtime] Error en el canal de `collection_orders`.",
        );
        for (const listener of collectionOrdersListeners) {
          listener.scheduleReload();
        }
      }
    });
}

function teardownCollectionOrdersChannelIfIdle() {
  if (collectionOrdersListeners.size > 0 || !collectionOrdersChannel) return;
  void supabase.removeChannel(collectionOrdersChannel);
  collectionOrdersChannel = null;
}

export function subscribeCollectionOrdersRealtime(
  handlers: CollectionOrdersRealtimeHandlers | (() => void),
): () => void {
  const normalized: CollectionOrdersRealtimeHandlers =
    typeof handlers === "function"
      ? { onReload: handlers }
      : handlers;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const clearDebounce = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const scheduleReload = () => {
    if (!normalized.onReload) return;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      normalized.onReload?.();
    }, COLLECTION_REALTIME_DEBOUNCE_MS);
  };

  const listener: CollectionOrdersListener = {
    handlers: normalized,
    scheduleReload,
    clearDebounce,
  };

  collectionOrdersListeners.add(listener);
  ensureCollectionOrdersChannel();

  return () => {
    clearDebounce();
    collectionOrdersListeners.delete(listener);
    teardownCollectionOrdersChannelIfIdle();
  };
}
