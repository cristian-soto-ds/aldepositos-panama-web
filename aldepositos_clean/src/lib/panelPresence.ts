/**
 * Presencia de operadores en el panel (misma sala vía Supabase Realtime).
 * Sustituye BroadcastChannel, que solo comparte estado entre pestañas del mismo navegador.
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type WorkPresenceModule = "quick" | "detailed" | "airway" | "none";

export type WorkPresenceEntry = {
  tabId: string;
  userKey: string;
  userLabel: string;
  ra: string;
  module: WorkPresenceModule;
  updatedAt: number;
};

const PRESENCE_CHANNEL = "aldepositos-work-presence-v1";

declare global {
  interface Window {
    __aldepositosPresenceTabId?: string;
  }
}

/** Una sola “pestaña lógica” por ventana para no duplicar filas de presencia. */
export function getSharedWorkPresenceTabId(): string {
  if (typeof window === "undefined") {
    return "ssr";
  }
  if (!window.__aldepositosPresenceTabId) {
    window.__aldepositosPresenceTabId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `tab-${Math.random().toString(36).slice(2, 11)}`;
  }
  return window.__aldepositosPresenceTabId;
}

const listeners = new Set<(entries: WorkPresenceEntry[]) => void>();

let realtimeChannel: RealtimeChannel | null = null;
let subscribePromise: Promise<void> | null = null;
let lastPayload: Omit<WorkPresenceEntry, "updatedAt"> | null = null;

function emit(entries: WorkPresenceEntry[]) {
  for (const fn of listeners) {
    fn(entries);
  }
}

function parsePresenceState(
  state: Record<string, unknown[]>,
): WorkPresenceEntry[] {
  const out: WorkPresenceEntry[] = [];
  const now = Date.now();
  for (const [presenceKey, metas] of Object.entries(state)) {
    if (!Array.isArray(metas)) continue;
    for (const meta of metas) {
      if (!meta || typeof meta !== "object") continue;
      const m = meta as Record<string, unknown>;
      const tabId =
        typeof m.tabId === "string" && m.tabId.length > 0 ? m.tabId : presenceKey;
      const userKey = typeof m.userKey === "string" ? m.userKey.trim() : "";
      if (!userKey) continue;
      const userLabel =
        typeof m.userLabel === "string" && m.userLabel.trim().length > 0
          ? m.userLabel.trim()
          : userKey;
      const ra = typeof m.ra === "string" ? m.ra.trim() : "";
      const mod = m.module;
      const module: WorkPresenceModule =
        mod === "quick" || mod === "detailed" || mod === "airway" || mod === "none"
          ? mod
          : "none";
      out.push({ tabId, userKey, userLabel, ra, module, updatedAt: now });
    }
  }
  return out;
}

function scheduleEmitFromChannel() {
  if (!realtimeChannel) return;
  try {
    const state = realtimeChannel.presenceState();
    emit(parsePresenceState(state as Record<string, unknown[]>));
  } catch {
    emit([]);
  }
}

async function ensureRealtimeSubscribed(): Promise<RealtimeChannel | null> {
  if (typeof window === "undefined") return null;

  if (realtimeChannel && subscribePromise) {
    await subscribePromise;
    return realtimeChannel;
  }

  if (!subscribePromise) {
    const key = getSharedWorkPresenceTabId();
    const ch = supabase.channel(PRESENCE_CHANNEL, {
      config: {
        presence: { key },
      },
    });

    ch.on("presence", { event: "sync" }, () => scheduleEmitFromChannel());
    ch.on("presence", { event: "join" }, () => scheduleEmitFromChannel());
    ch.on("presence", { event: "leave" }, () => scheduleEmitFromChannel());

    realtimeChannel = ch;
    subscribePromise = new Promise((resolve) => {
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          resolve();
          scheduleEmitFromChannel();
          void flushTrackNow();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(
            "[AlDepósitos presencia] Realtime no disponible:",
            status,
            "¿Realtime activo en Supabase?",
          );
          resolve();
        }
      });
    });
  }

  await subscribePromise;
  return realtimeChannel;
}

async function flushTrackNow(): Promise<void> {
  const ch = await ensureRealtimeSubscribed();
  if (!ch || !lastPayload) return;
  try {
    await ch.track({
      userKey: lastPayload.userKey,
      userLabel: lastPayload.userLabel,
      ra: lastPayload.ra,
      module: lastPayload.module,
      tabId: lastPayload.tabId,
    });
  } catch (e) {
    console.warn("[AlDepósitos presencia] track falló:", e);
  }
}

/**
 * Publica presencia del cliente actual. Mismo tabId en toda la ventana (ver
 * `getSharedWorkPresenceTabId`).
 */
export function publishWorkPresence(entry: Omit<WorkPresenceEntry, "updatedAt">): void {
  if (typeof window === "undefined") return;
  const tabId = entry.tabId || getSharedWorkPresenceTabId();
  lastPayload = {
    ...entry,
    tabId,
    ra: (entry.ra ?? "").trim(),
    module: entry.module,
  };
  void flushTrackNow();
}

/** Quita la presencia de este cliente (p. ej. al salir de un módulo). */
export async function clearWorkPresence(tabId: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (tabId !== getSharedWorkPresenceTabId()) return;

  lastPayload = null;

  const ch = realtimeChannel;
  if (ch) {
    try {
      await ch.untrack();
    } catch {
      /* ignore */
    }
  }
  scheduleEmitFromChannel();
}

export function subscribeWorkPresence(
  onUpdate: (entries: WorkPresenceEntry[]) => void,
): () => void {
  listeners.add(onUpdate);

  if (typeof window === "undefined") {
    onUpdate([]);
    return () => {
      listeners.delete(onUpdate);
    };
  }

  void (async () => {
    await ensureRealtimeSubscribed();
    scheduleEmitFromChannel();
  })();

  return () => {
    listeners.delete(onUpdate);
  };
}
