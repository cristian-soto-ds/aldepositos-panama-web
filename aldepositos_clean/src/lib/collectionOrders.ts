import { supabase } from "@/lib/supabase";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { normalizeCollectionOrderFields } from "@/lib/collectionOrderReconcile";
import { emptyManualRaTaskFields } from "@/lib/collectionOrderToTask";
import { normalizeOrNumero } from "@/lib/parseCollectionOrdersHtm";
import { RECEPTION_STATUS } from "@/lib/receptionLogistics/config";
import type { CollectionOrder } from "@/lib/types/collectionOrder";
import type { Task } from "@/lib/types/task";
import type { DbPayloadRow } from "@/lib/realtimePatch";
import { countOrdersForCollectionListTab } from "@/lib/collectionOrderListTabs";

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

function normalizeRaKeyForLink(ra: unknown): string {
  return String(ra ?? "")
    .trim()
    .toUpperCase()
    .replace(/^RA[\s\-_#]*/i, "");
}

/** RAs de inventario vinculados a esta OR (por id de OR o por número en linkedRaNumbers). */
export function findTasksLinkedToCollectionOrder(
  tasks: Task[],
  order: CollectionOrder,
): Task[] {
  const linkedKeys = new Set(
    (order.linkedRaNumbers ?? [])
      .map(normalizeRaKeyForLink)
      .filter(Boolean),
  );
  return tasks.filter((t) => {
    if (t.linkedCollectionOrderId === order.id) return true;
    const ra = normalizeRaKeyForLink(t.ra);
    return Boolean(ra && linkedKeys.has(ra));
  });
}

/**
 * Limpia el RA tras desvincular un traslado OR→RA:
 * solo deja id + número RA (lo manual); quita candado, medidas y datos de OR.
 */
export function clearRaAfterCollectionUnlink(task: Task): Task {
  const { linkedCollectionOrderId: _link, ...rest } = task;
  return {
    ...rest,
    ...emptyManualRaTaskFields(),
    measureData: [],
    currentBultos: 0,
    capturedWeight: 0,
    rowCount: 0,
    completeRowCount: 0,
    referenceMode: undefined,
    referenceModeChosen: false,
    // Vuelve a pendiente vacío (no borra el RA).
    status:
      String(task.status ?? "").toLowerCase() === "completed"
        ? task.status
        : "pending",
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Desvincula OR↔RA(s): la OR vuelve a poder transferirse y los RA
 * quedan disponibles otra vez en el selector (sin datos de inventario).
 */
export function unlinkCollectionOrderFromRas(input: {
  order: CollectionOrder;
  tasks: Task[];
  /** Si se omite, desvincula todos los RA ligados a la OR. */
  raNumbers?: string[];
}): {
  order: CollectionOrder;
  clearedTasks: Task[];
  blockedCompleted: Task[];
} {
  const { order, tasks } = input;
  const linked = findTasksLinkedToCollectionOrder(tasks, order);
  const onlyKeys =
    input.raNumbers && input.raNumbers.length > 0
      ? new Set(input.raNumbers.map(normalizeRaKeyForLink).filter(Boolean))
      : null;

  const targets = onlyKeys
    ? linked.filter((t) => onlyKeys.has(normalizeRaKeyForLink(t.ra)))
    : linked;

  const blockedCompleted = targets.filter(
    (t) => String(t.status ?? "").toLowerCase() === "completed",
  );
  const clearable = targets.filter(
    (t) => String(t.status ?? "").toLowerCase() !== "completed",
  );

  const removeKeys = new Set(
    clearable.map((t) => normalizeRaKeyForLink(t.ra)).filter(Boolean),
  );
  // También limpia números huérfanos en la OR (RA ya borrado / no en tasks).
  if (!onlyKeys) {
    for (const ra of order.linkedRaNumbers ?? []) {
      const key = normalizeRaKeyForLink(ra);
      if (key) removeKeys.add(key);
    }
  } else {
    for (const key of onlyKeys) removeKeys.add(key);
  }
  // No quitar de la OR los RA completados que no se pueden limpiar.
  for (const t of blockedCompleted) {
    removeKeys.delete(normalizeRaKeyForLink(t.ra));
  }

  const nextLinked = (order.linkedRaNumbers ?? []).filter(
    (ra) => !removeKeys.has(normalizeRaKeyForLink(ra)),
  );

  return {
    order: {
      ...order,
      linkedRaNumbers: nextLinked,
      updatedAt: new Date().toISOString(),
    },
    clearedTasks: clearable.map(clearRaAfterCollectionUnlink),
    blockedCompleted,
  };
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
 * Sin líneas Magaya: para el módulo Recepcionista (tabs + fila/rampa).
 * Usa RPC si está aplicada; si no, cae al fetch completo y recorta en cliente.
 */
export function slimCollectionOrderForReceptionist(
  order: CollectionOrder,
): CollectionOrder {
  if (!order.lines?.length) return order;
  let expected = order.expectedBultos;
  if (expected == null || !(expected > 0)) {
    let sum = 0;
    for (const l of order.lines) {
      const n = parseFloat(String(l.bultos ?? "").replace(",", "."));
      if (Number.isFinite(n) && n > 0) sum += Math.round(n);
    }
    if (sum > 0) expected = sum;
  }
  return {
    ...order,
    lines: [],
    expectedBultos: expected ?? order.expectedBultos,
  };
}

export async function fetchCollectionOrdersForReceptionist(): Promise<
  CollectionOrder[]
> {
  const { data, error } = await supabase.rpc(
    "fetch_collection_orders_receptionist_slim",
  );
  if (!error && data) {
    const rows = data as { id?: string; payload: unknown }[];
    return sortCollectionOrdersByNumero(
      rows
        .map((r) => {
          const order = orderFromDbRow(r as DbPayloadRow);
          return order ? slimCollectionOrderForReceptionist(order) : null;
        })
        .filter((o): o is CollectionOrder => !!o),
    );
  }

  // Fallback si la migración RPC aún no está en el proyecto.
  console.warn(
    "[collection_orders] RPC slim no disponible; fetch completo + strip local.",
    error?.message,
  );
  const full = await fetchCollectionOrders();
  return full.map(slimCollectionOrderForReceptionist);
}

/** OR del mismo camión unificado (evita paginar toda la cola de recepción). */
export async function fetchCollectionOrdersByReceptionGroupId(
  groupId: string,
): Promise<CollectionOrder[]> {
  const gid = String(groupId ?? "").trim();
  if (!gid) return [];

  const { data, error } = await supabase
    .from("collection_orders")
    .select("id, payload")
    .eq("payload->>receptionGroupId", gid);
  if (error) throw error;

  return ((data ?? []) as DbPayloadRow[])
    .map((r) => orderFromDbRow(r))
    .filter((o): o is CollectionOrder => !!o);
}

export type CollectionOrderTabCounts = {
  total: number;
  enBodega: number;
  pendientes: number;
};

/** Firma barata para no re-renderizar si el reload no cambió nada. */
export function collectionOrdersListFingerprint(orders: CollectionOrder[]): string {
  if (orders.length === 0) return "0";
  let acc = String(orders.length);
  for (const o of orders) {
    acc += `|${o.id}:${o.updatedAt ?? ""}:${o.receptionStatus ?? ""}:${o.lines?.length ?? 0}`;
  }
  return acc;
}

/**
 * Conteos del dashboard: id + campos de tab, sin líneas Magaya.
 * No usar para editar OR.
 */
function tabStubFromPayload(
  id: string,
  payload: unknown,
): CollectionOrder {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const linked = Array.isArray(p.linkedRaNumbers)
    ? (p.linkedRaNumbers as string[])
    : [];
  return {
    id,
    cliente: String(p.cliente ?? ""),
    proveedor: String(p.proveedor ?? ""),
    marca: typeof p.marca === "string" ? p.marca : undefined,
    lines: [],
    status: "draft",
    createdAt: "",
    updatedAt: "",
    receptionStatus: p.receptionStatus as CollectionOrder["receptionStatus"],
    linkedRaNumbers: linked,
    sinInventario: p.sinInventario === true,
  };
}

export async function fetchCollectionOrderTabCounts(): Promise<CollectionOrderTabCounts> {
  const pageSize = 1000;
  const stubs: CollectionOrder[] = [];
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("collection_orders")
      .select("id, payload")
      .range(from, to);
    if (error) throw error;
    const chunk = (data ?? []) as { id?: string; payload?: unknown }[];
    for (const row of chunk) {
      stubs.push(tabStubFromPayload(String(row.id ?? ""), row.payload));
    }
    if (chunk.length < pageSize) break;
    from += pageSize;
    if (from > 100_000) break;
  }

  return {
    total: stubs.length,
    enBodega: countOrdersForCollectionListTab(stubs, "warehouse"),
    pendientes: countOrdersForCollectionListTab(stubs, "general"),
  };
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
