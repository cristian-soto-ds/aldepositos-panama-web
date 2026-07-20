/**
 * Ajustes compartidos de control de inventarios (teclado vs cinta Reekon).
 * Persistencia: Supabase `panel_settings` + cache local (fallback).
 */

import { supabase } from "@/lib/supabase";
import {
  getInventariadorById,
  resolveInventariadorId,
} from "@/lib/inventariadoresRoster";

export const INVENTORY_CONTROL_SETTINGS_ID = "inventory-control-v1";
export const INVENTORY_CONTROL_STORAGE_KEY = "aldepositos_inventory_control_v1";
const BROADCAST_CHANNEL = "aldepositos-inventory-control";
const REALTIME_CHANNEL_ID = "inventory-control-live";
const POLL_MS = 8_000;

export type InventoryControlSettings = {
  /** Ids del roster (`jahir`, `claudio`, `raul`) habilitados para teclear L/A/H. */
  keyboardOperatorIds: string[];
  updatedAt: string;
};

export type InventoryControlSaveResult = {
  settings: InventoryControlSettings;
  /** false si no se pudo escribir en Supabase (queda solo cache local de este navegador). */
  remoteOk: boolean;
};

export function defaultInventoryControlSettings(): InventoryControlSettings {
  return {
    keyboardOperatorIds: [],
    updatedAt: new Date(0).toISOString(),
  };
}

function isInventoryControlSettings(value: unknown): value is InventoryControlSettings {
  if (!value || typeof value !== "object") return false;
  const v = value as InventoryControlSettings;
  return (
    Array.isArray(v.keyboardOperatorIds) &&
    v.keyboardOperatorIds.every((id) => typeof id === "string") &&
    typeof v.updatedAt === "string"
  );
}

function sanitizeSettings(raw: unknown): InventoryControlSettings {
  if (!isInventoryControlSettings(raw)) return defaultInventoryControlSettings();
  const ids = [
    ...new Set(
      raw.keyboardOperatorIds
        .map((id) => String(id ?? "").trim())
        .filter((id) => Boolean(getInventariadorById(id))),
    ),
  ];
  return {
    keyboardOperatorIds: ids,
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

function newerSettings(
  a: InventoryControlSettings,
  b: InventoryControlSettings,
): InventoryControlSettings {
  const ta = Date.parse(a.updatedAt) || 0;
  const tb = Date.parse(b.updatedAt) || 0;
  return tb >= ta ? b : a;
}

function readLocal(): InventoryControlSettings {
  if (typeof window === "undefined") return defaultInventoryControlSettings();
  try {
    const raw = window.localStorage.getItem(INVENTORY_CONTROL_STORAGE_KEY);
    if (!raw) return defaultInventoryControlSettings();
    return sanitizeSettings(JSON.parse(raw) as unknown);
  } catch {
    return defaultInventoryControlSettings();
  }
}

function writeLocal(state: InventoryControlSettings) {
  if (typeof window === "undefined") return;
  const serialized = JSON.stringify(state);
  const prev = window.localStorage.getItem(INVENTORY_CONTROL_STORAGE_KEY);
  if (prev === serialized) return;
  window.localStorage.setItem(INVENTORY_CONTROL_STORAGE_KEY, serialized);
  try {
    const ch = new BroadcastChannel(BROADCAST_CHANNEL);
    ch.postMessage({ type: "inventory-control", updatedAt: state.updatedAt });
    ch.close();
  } catch {
    /* BroadcastChannel no disponible */
  }
}

export async function fetchInventoryControlSettings(): Promise<InventoryControlSettings> {
  const local = readLocal();

  try {
    const { data, error } = await supabase
      .from("panel_settings")
      .select("payload")
      .eq("id", INVENTORY_CONTROL_SETTINGS_ID)
      .maybeSingle();

    if (error) throw error;
    const payload = (data as { payload?: unknown } | null)?.payload;
    if (payload != null) {
      const remote = sanitizeSettings(payload);
      const next = newerSettings(local, remote);
      writeLocal(next);
      return next;
    }
  } catch (e) {
    console.warn(
      "[inventory-control] No se pudo leer panel_settings; usando copia local.",
      e,
    );
  }

  writeLocal(local);
  return local;
}

export async function saveInventoryControlSettings(
  state: InventoryControlSettings,
): Promise<InventoryControlSaveResult> {
  const next: InventoryControlSettings = {
    keyboardOperatorIds: [
      ...new Set(
        state.keyboardOperatorIds.filter((id) => Boolean(getInventariadorById(id))),
      ),
    ],
    updatedAt: new Date().toISOString(),
  };
  writeLocal(next);

  const { error } = await supabase.from("panel_settings").upsert({
    id: INVENTORY_CONTROL_SETTINGS_ID,
    payload: next,
    updated_at: next.updatedAt,
  });
  if (error) {
    console.warn(
      "[inventory-control] No se pudo guardar en Supabase; quedó en cache local.",
      error,
    );
    return { settings: next, remoteOk: false };
  }
  return { settings: next, remoteOk: true };
}

export async function setKeyboardOperatorEnabled(
  operatorId: string,
  enabled: boolean,
): Promise<InventoryControlSaveResult> {
  if (!getInventariadorById(operatorId)) {
    return {
      settings: await fetchInventoryControlSettings(),
      remoteOk: true,
    };
  }
  // Preferir cache local (más reciente tras toggles) y no pisar con remoto viejo.
  const current = newerSettings(readLocal(), await fetchInventoryControlSettings());
  const set = new Set(current.keyboardOperatorIds);
  if (enabled) set.add(operatorId);
  else set.delete(operatorId);
  return saveInventoryControlSettings({
    ...current,
    keyboardOperatorIds: [...set],
  });
}

/** ¿Este usuario puede teclear medidas L/A/H en Reekon? */
export function operatorAllowsKeyboardMeasures(
  settings: InventoryControlSettings,
  userKey: string | null | undefined,
  userLabel: string | null | undefined,
): boolean {
  const id =
    resolveInventariadorId(userLabel, userKey) ??
    resolveInventariadorId(userKey, userLabel);
  if (!id) return false;
  return settings.keyboardOperatorIds.includes(id);
}

let listeners = new Set<() => void>();
let broadcastChannel: BroadcastChannel | null = null;
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
let pollIntervalId: number | null = null;

function notifyListeners() {
  for (const fn of listeners) fn();
}

function ensureRealtime() {
  if (realtimeChannel) return;
  try {
    realtimeChannel = supabase
      .channel(REALTIME_CHANNEL_ID)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "panel_settings",
        },
        () => notifyListeners(),
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(
            `[inventory-control] Realtime ${status}; sondeo cada ${POLL_MS / 1000}s.`,
          );
        }
      });
  } catch (e) {
    console.warn("[inventory-control] No se pudo suscribir a Realtime.", e);
    realtimeChannel = null;
  }
}

function teardownRealtimeIfIdle() {
  if (listeners.size > 0 || !realtimeChannel) return;
  void supabase.removeChannel(realtimeChannel);
  realtimeChannel = null;
}

export function subscribeInventoryControlSettings(onSync: () => void): () => void {
  listeners.add(onSync);

  const onStorage = (e: StorageEvent) => {
    if (e.key === INVENTORY_CONTROL_STORAGE_KEY) onSync();
  };
  window.addEventListener("storage", onStorage);

  if (!broadcastChannel) {
    try {
      broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL);
      broadcastChannel.onmessage = (ev: MessageEvent) => {
        const data = ev.data as { type?: string } | null;
        if (data?.type === "inventory-control") notifyListeners();
      };
    } catch {
      broadcastChannel = null;
    }
  }

  ensureRealtime();

  if (pollIntervalId == null) {
    pollIntervalId = window.setInterval(() => notifyListeners(), POLL_MS);
  }

  return () => {
    listeners.delete(onSync);
    window.removeEventListener("storage", onStorage);
    if (listeners.size === 0) {
      if (pollIntervalId != null) {
        window.clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
      if (broadcastChannel) {
        broadcastChannel.close();
        broadcastChannel = null;
      }
      teardownRealtimeIfIdle();
    }
  };
}
