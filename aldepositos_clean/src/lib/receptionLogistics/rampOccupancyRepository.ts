import { supabase } from "@/lib/supabase";
import {
  RECEPTION_BROADCAST_CHANNEL,
  RECEPTION_TABLE,
} from "@/lib/receptionLogistics/config";
import {
  defaultRampOccupancyState,
  RAMP_OCCUPANCY_META_ID,
  RAMP_OCCUPANCY_STORAGE_KEY,
  type RampOccupancyRampId,
  type RampOccupancyState,
} from "@/lib/receptionLogistics/rampOccupancy";

function isRampOccupancyState(value: unknown): value is RampOccupancyState {
  if (!value || typeof value !== "object") return false;
  const v = value as RampOccupancyState;
  return (
    typeof v.RAMPA_1 === "object" &&
    typeof v.RAMPA_2 === "object" &&
    typeof v.updatedAt === "string"
  );
}

function readLocalRampOccupancy(): RampOccupancyState {
  if (typeof window === "undefined") return defaultRampOccupancyState();
  try {
    const raw = window.localStorage.getItem(RAMP_OCCUPANCY_STORAGE_KEY);
    if (!raw) return defaultRampOccupancyState();
    const parsed = JSON.parse(raw) as RampOccupancyState;
    return isRampOccupancyState(parsed) ? parsed : defaultRampOccupancyState();
  } catch {
    return defaultRampOccupancyState();
  }
}

function writeLocalRampOccupancy(state: RampOccupancyState) {
  if (typeof window === "undefined") return;
  const serialized = JSON.stringify(state);
  const prev = window.localStorage.getItem(RAMP_OCCUPANCY_STORAGE_KEY);
  if (prev === serialized) return;
  window.localStorage.setItem(RAMP_OCCUPANCY_STORAGE_KEY, serialized);
  try {
    const ch = new BroadcastChannel(RECEPTION_BROADCAST_CHANNEL);
    ch.postMessage({ type: "ramp-occupancy", updatedAt: state.updatedAt });
    ch.close();
  } catch {
    /* BroadcastChannel no disponible */
  }
}

export async function fetchRampOccupancy(): Promise<RampOccupancyState> {
  try {
    const { data, error } = await supabase
      .from(RECEPTION_TABLE)
      .select("payload")
      .eq("id", RAMP_OCCUPANCY_META_ID)
      .maybeSingle();

    if (error) throw error;
    const payload = (data as { payload?: unknown } | null)?.payload;
    if (isRampOccupancyState(payload)) {
      writeLocalRampOccupancy(payload);
      return payload;
    }
  } catch {
    /* fallback local */
  }

  const local = readLocalRampOccupancy();
  writeLocalRampOccupancy(local);
  return local;
}

export async function saveRampOccupancy(state: RampOccupancyState): Promise<void> {
  writeLocalRampOccupancy(state);
  try {
    const { error } = await supabase.from(RECEPTION_TABLE).upsert({
      id: RAMP_OCCUPANCY_META_ID,
      payload: state,
      updated_at: state.updatedAt,
    });
    if (error) throw error;
  } catch {
    /* Solo local */
  }
}

export async function setRampOccupancy(
  rampId: RampOccupancyRampId,
  occupied: boolean,
): Promise<RampOccupancyState> {
  const current = await fetchRampOccupancy();
  const now = new Date().toISOString();
  const next: RampOccupancyState = {
    ...current,
    [rampId]: {
      occupied,
      reason: occupied ? "retiro" : null,
      updatedAt: occupied ? now : null,
    },
    updatedAt: now,
  };
  await saveRampOccupancy(next);
  return next;
}

const RAMP_OCCUPANCY_REALTIME_CHANNEL_ID = "ramp-occupancy-live";
const RAMP_OCCUPANCY_POLL_MS = 12_000;

let rampOccupancyListeners = new Set<() => void>();
let rampBroadcastChannel: BroadcastChannel | null = null;
let rampRealtimeChannel: ReturnType<typeof supabase.channel> | null = null;
let rampPollIntervalId: number | null = null;

function notifyRampOccupancyListeners() {
  for (const listener of rampOccupancyListeners) {
    listener();
  }
}

function ensureRampRealtimeChannel() {
  if (rampRealtimeChannel) return;
  try {
    // Escucha TODOS los cambios de la tabla (igual que la cola de camiones):
    // más robusto que un filtro por id, que en algunos proyectos no entrega
    // los eventos del registro meta a otros usuarios/dispositivos.
    rampRealtimeChannel = supabase
      .channel(RAMP_OCCUPANCY_REALTIME_CHANNEL_ID)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: RECEPTION_TABLE,
        },
        () => notifyRampOccupancyListeners(),
      )
      .subscribe();
  } catch {
    rampRealtimeChannel = null;
  }
}

function teardownRampRealtimeChannelIfIdle() {
  if (rampOccupancyListeners.size > 0 || !rampRealtimeChannel) return;
  void supabase.removeChannel(rampRealtimeChannel);
  rampRealtimeChannel = null;
}

export function subscribeRampOccupancy(onSync: () => void): () => void {
  rampOccupancyListeners.add(onSync);

  const onStorage = (e: StorageEvent) => {
    if (e.key === RAMP_OCCUPANCY_STORAGE_KEY) onSync();
  };
  window.addEventListener("storage", onStorage);

  if (!rampBroadcastChannel) {
    try {
      rampBroadcastChannel = new BroadcastChannel(RECEPTION_BROADCAST_CHANNEL);
      rampBroadcastChannel.onmessage = (ev: MessageEvent) => {
        const data = ev.data as { type?: string } | null;
        if (data?.type === "ramp-occupancy") notifyRampOccupancyListeners();
      };
    } catch {
      rampBroadcastChannel = null;
    }
  }

  // Respaldo por sondeo: garantiza la sincronización entre usuarios/dispositivos
  // aunque el realtime de Supabase no entregue el evento.
  if (rampPollIntervalId == null && typeof window !== "undefined") {
    rampPollIntervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      notifyRampOccupancyListeners();
    }, RAMP_OCCUPANCY_POLL_MS);
  }

  ensureRampRealtimeChannel();

  return () => {
    rampOccupancyListeners.delete(onSync);
    window.removeEventListener("storage", onStorage);
    teardownRampRealtimeChannelIfIdle();
    if (rampOccupancyListeners.size === 0) {
      if (rampPollIntervalId != null) {
        window.clearInterval(rampPollIntervalId);
        rampPollIntervalId = null;
      }
      if (rampBroadcastChannel) {
        rampBroadcastChannel.close();
        rampBroadcastChannel = null;
      }
    }
  };
}
