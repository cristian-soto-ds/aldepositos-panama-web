/**
 * Presencia de operadores en el panel (misma sala vía Supabase Realtime).
 * Sustituye BroadcastChannel, que solo comparte estado entre pestañas del mismo navegador.
 *
 * Importante: Supabase aplica rate-limit a `presence.track`. Sin throttle, 2+
 * inventariadores en el mismo RA disparan `ClientPresenceRateLimitReached` y
 * dejan de sincronizar.
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type WorkPresenceModule = "quick" | "detailed" | "airway" | "none";

export type WorkPresenceEntry = {
  tabId: string;
  userKey: string;
  userLabel: string;
  /** URL pública del avatar (http/https); visible para otros en presencia. */
  avatarUrl?: string | null;
  ra: string;
  module: WorkPresenceModule;
  updatedAt: number;
};

const PRESENCE_CHANNEL = "aldepositos-work-presence-v1";
/** Mínimo entre tracks idénticos / heartbeats (ms). */
const PRESENCE_TRACK_MIN_INTERVAL_MS = 20_000;

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
/** Snapshot de membership para no emitir si solo cambia el timestamp. */
let lastMembershipKey = "";
let lastTrackedKey = "";
let lastTrackAt = 0;
let trackInFlight = false;
let pendingTrackTimer: ReturnType<typeof setTimeout> | null = null;

function membershipKey(entries: WorkPresenceEntry[]): string {
  if (entries.length === 0) return "";
  return entries
    .map(
      (e) =>
        `${e.tabId}\t${e.userKey}\t${e.ra}\t${e.module}\t${e.avatarUrl ?? ""}\t${e.userLabel}`,
    )
    .sort()
    .join("|");
}

function payloadKey(entry: Omit<WorkPresenceEntry, "updatedAt">): string {
  return [
    entry.tabId,
    entry.userKey,
    entry.userLabel,
    entry.avatarUrl ?? "",
    entry.ra,
    entry.module,
  ].join("\t");
}

function emit(entries: WorkPresenceEntry[]) {
  const key = membershipKey(entries);
  if (key === lastMembershipKey) return;
  lastMembershipKey = key;
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
      let avatarUrl: string | null | undefined;
      if (typeof m.avatarUrl === "string") {
        const au = m.avatarUrl.trim();
        if (au.startsWith("http://") || au.startsWith("https://")) {
          avatarUrl = au;
        }
      }
      const ra = typeof m.ra === "string" ? m.ra.trim() : "";
      const mod = m.module;
      const module: WorkPresenceModule =
        mod === "quick" || mod === "detailed" || mod === "airway" || mod === "none"
          ? mod
          : "none";
      out.push({
        tabId,
        userKey,
        userLabel,
        avatarUrl,
        ra,
        module,
        updatedAt: now,
      });
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
          void flushTrackNow(true);
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

async function flushTrackNow(force = false): Promise<void> {
  if (trackInFlight) return;
  const ch = await ensureRealtimeSubscribed();
  if (!ch || !lastPayload) return;

  const key = payloadKey(lastPayload);
  const now = Date.now();
  const unchanged = key === lastTrackedKey;

  // Heartbeat idéntico: respeta intervalo mínimo.
  if (!force && unchanged && now - lastTrackAt < PRESENCE_TRACK_MIN_INTERVAL_MS) {
    return;
  }
  // Contenido cambió (RA/módulo): permitir track, pero no más de 1/s para ráfagas.
  if (!force && !unchanged && now - lastTrackAt < 1_000) {
    scheduleTrack(true);
    return;
  }

  trackInFlight = true;
  try {
    await ch.track({
      userKey: lastPayload.userKey,
      userLabel: lastPayload.userLabel,
      avatarUrl: lastPayload.avatarUrl ?? null,
      ra: lastPayload.ra,
      module: lastPayload.module,
      tabId: lastPayload.tabId,
    });
    lastTrackedKey = key;
    lastTrackAt = Date.now();
  } catch (e) {
    console.warn("[AlDepósitos presencia] track falló:", e);
  } finally {
    trackInFlight = false;
  }
}

function scheduleTrack(forceContentChange: boolean) {
  if (pendingTrackTimer) {
    clearTimeout(pendingTrackTimer);
    pendingTrackTimer = null;
  }
  if (forceContentChange) {
    const wait = Math.max(0, 1_000 - (Date.now() - lastTrackAt));
    if (wait === 0) {
      void flushTrackNow(true);
      return;
    }
    pendingTrackTimer = setTimeout(() => {
      pendingTrackTimer = null;
      void flushTrackNow(true);
    }, wait);
    return;
  }
  const wait = Math.max(0, PRESENCE_TRACK_MIN_INTERVAL_MS - (Date.now() - lastTrackAt));
  pendingTrackTimer = setTimeout(() => {
    pendingTrackTimer = null;
    void flushTrackNow(false);
  }, wait);
}

/**
 * Publica presencia del cliente actual. Mismo tabId en toda la ventana (ver
 * `getSharedWorkPresenceTabId`). Throttled para no saturar Realtime.
 */
export function publishWorkPresence(entry: Omit<WorkPresenceEntry, "updatedAt">): void {
  if (typeof window === "undefined") return;
  const tabId = entry.tabId || getSharedWorkPresenceTabId();
  const next = {
    ...entry,
    tabId,
    ra: (entry.ra ?? "").trim(),
    module: entry.module,
    avatarUrl: entry.avatarUrl?.trim() || null,
  };
  const prevKey = lastPayload ? payloadKey(lastPayload) : "";
  const nextKey = payloadKey(next);
  lastPayload = next;
  scheduleTrack(prevKey !== nextKey);
}

/** Quita la presencia de este cliente (p. ej. al salir de un módulo). */
export async function clearWorkPresence(tabId: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (tabId !== getSharedWorkPresenceTabId()) return;

  lastPayload = null;
  lastTrackedKey = "";
  if (pendingTrackTimer) {
    clearTimeout(pendingTrackTimer);
    pendingTrackTimer = null;
  }
  // No resetear lastMembershipKey a "": emit([]) debe notificar ("" === "" lo saltaría).

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
