/**
 * Presencia de trabajo sobre un RA (mismo origen / pestañas del mismo equipo).
 * Para sincronía entre equipos distintos hace falta backend (p. ej. Supabase Realtime).
 */

export type WorkPresenceModule = "quick" | "detailed" | "airway";

export type WorkPresenceEntry = {
  tabId: string;
  userKey: string;
  userLabel: string;
  ra: string;
  module: WorkPresenceModule;
  updatedAt: number;
};

const CHANNEL_NAME = "aldepositos-work-presence-v1";
const STALE_MS = 45000;

const globalMap = new Map<string, WorkPresenceEntry>();

let singletonChannel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (!("BroadcastChannel" in window)) return null;
  if (!singletonChannel) {
    singletonChannel = new BroadcastChannel(CHANNEL_NAME);
  }
  return singletonChannel;
}

function prune(): void {
  const now = Date.now();
  for (const [id, e] of globalMap) {
    if (now - e.updatedAt > STALE_MS) globalMap.delete(id);
  }
}

export function publishWorkPresence(entry: Omit<WorkPresenceEntry, "updatedAt">): void {
  const ch = getChannel();
  const full: WorkPresenceEntry = { ...entry, updatedAt: Date.now() };
  globalMap.set(full.tabId, full);
  ch?.postMessage({ type: "presence", payload: full });
}

export function clearWorkPresence(tabId: string): void {
  globalMap.delete(tabId);
  getChannel()?.postMessage({ type: "leave", payload: { tabId } });
}

export function subscribeWorkPresence(
  onUpdate: (entries: WorkPresenceEntry[]) => void,
): () => void {
  const ch = getChannel();
  prune();
  const emit = () => {
    prune();
    onUpdate(Array.from(globalMap.values()));
  };

  if (!ch) {
    emit();
    return () => {};
  }

  const handler = (ev: MessageEvent) => {
    const d = ev.data as
      | { type: "presence"; payload: WorkPresenceEntry }
      | { type: "leave"; payload: { tabId: string } };
    if (d?.type === "presence" && d.payload?.tabId) {
      globalMap.set(d.payload.tabId, { ...d.payload, updatedAt: Date.now() });
    }
    if (d?.type === "leave" && d.payload?.tabId) {
      globalMap.delete(d.payload.tabId);
    }
    emit();
  };

  ch.addEventListener("message", handler);
  emit();

  return () => {
    ch.removeEventListener("message", handler);
  };
}
