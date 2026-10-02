import { supabase } from "@/lib/supabase";
import { sanitizeContainerLoadItems } from "@/lib/containerLoadItems";
import type {
  ContainerLoad,
  ContainerLoadItem,
  ContainerLoadStatus,
} from "@/lib/types/containerLoad";

export {
  normalizeContainerLoadRa,
  sanitizeContainerLoadItems,
} from "@/lib/containerLoadItems";

export const CONTAINER_LOADS_TABLE = "container_loads";

type ContainerLoadRow = {
  id: string;
  name: string;
  status: string;
  source_file_name: string | null;
  items: unknown;
  sort_order: number | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

function rowToLoad(row: ContainerLoadRow): ContainerLoad {
  return {
    id: row.id,
    name: row.name,
    status: (row.status === "closed" ? "closed" : "open") as ContainerLoadStatus,
    sourceFileName: row.source_file_name,
    items: sanitizeContainerLoadItems(row.items),
    sortOrder: Number(row.sort_order) || 0,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
  };
}

function newLoadId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `cl_${crypto.randomUUID()}`;
  }
  return `cl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function fetchContainerLoads(): Promise<ContainerLoad[]> {
  const pageSize = 500;
  const all: ContainerLoadRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(CONTAINER_LOADS_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = (data ?? []) as ContainerLoadRow[];
    all.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
    if (from > 50_000) break;
  }
  return all.map(rowToLoad);
}

export async function createContainerLoad(input: {
  name: string;
  items: ContainerLoadItem[];
  sourceFileName?: string | null;
  createdByEmail?: string | null;
}): Promise<ContainerLoad> {
  const name = input.name.trim();
  if (!name) throw new Error("Poné un nombre al cargue.");
  const items = sanitizeContainerLoadItems(input.items);
  if (items.length === 0) throw new Error("El cargue no tiene RA.");
  const { data: last } = await supabase
    .from(CONTAINER_LOADS_TABLE)
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextOrder = (Number(last?.[0]?.sort_order) || 0) + 1;
  const { data, error } = await supabase
    .from(CONTAINER_LOADS_TABLE)
    .insert({
      id: newLoadId(),
      name,
      status: "open",
      source_file_name: input.sourceFileName ?? null,
      items,
      sort_order: nextOrder,
      created_by_email: input.createdByEmail?.trim().toLowerCase() || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return rowToLoad(data as ContainerLoadRow);
}

export async function updateContainerLoad(
  id: string,
  patch: { name?: string; items?: ContainerLoadItem[] },
): Promise<ContainerLoad> {
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error("El nombre no puede quedar vacío.");
    body.name = name;
  }
  if (patch.items !== undefined) {
    body.items = sanitizeContainerLoadItems(patch.items);
  }
  const { data, error } = await supabase
    .from(CONTAINER_LOADS_TABLE)
    .update(body)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToLoad(data as ContainerLoadRow);
}

export async function setContainerLoadStatus(
  id: string,
  status: ContainerLoadStatus,
): Promise<ContainerLoad> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from(CONTAINER_LOADS_TABLE)
    .update({
      status,
      updated_at: now,
      closed_at: status === "closed" ? now : null,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToLoad(data as ContainerLoadRow);
}

/** Guarda el orden de trabajo: el primer id queda como 1. */
export async function reorderContainerLoads(orderedIds: string[]): Promise<void> {
  const now = new Date().toISOString();
  const results = await Promise.all(
    orderedIds.map((id, i) =>
      supabase
        .from(CONTAINER_LOADS_TABLE)
        .update({ sort_order: i + 1, updated_at: now })
        .eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

export async function deleteContainerLoad(id: string): Promise<void> {
  const { data, error } = await supabase
    .from(CONTAINER_LOADS_TABLE)
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("No se pudo eliminar el cargue.");
  }
}

const CHANNEL_ID = "public-container-loads-changes";
const listeners = new Set<() => void>();
let channel: ReturnType<typeof supabase.channel> | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;

function notify() {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    for (const l of listeners) l();
  }, 250);
}

export function subscribeContainerLoadsRealtime(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!channel) {
    channel = supabase
      .channel(CHANNEL_ID)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: CONTAINER_LOADS_TABLE },
        notify,
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.warn("[Supabase Realtime] Error en el canal de `container_loads`.");
          notify();
        }
      });
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && channel) {
      void supabase.removeChannel(channel);
      channel = null;
    }
  };
}
