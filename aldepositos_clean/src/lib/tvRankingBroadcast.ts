/**
 * Disparo manual del ranking inventariadores en la pantalla TV.
 * Panel → BroadcastChannel / localStorage → TV.
 */

export const TV_RANKING_CHANNEL = "aldepositos-tv-ranking-v1";
export const TV_RANKING_STORAGE_KEY = "aldepositos-tv-ranking-show";

export type TvRankingMessage = {
  type: "show-ranking";
  at: number;
};

export function publishShowTvRanking(): void {
  const payload: TvRankingMessage = {
    type: "show-ranking",
    at: Date.now(),
  };
  try {
    const ch = new BroadcastChannel(TV_RANKING_CHANNEL);
    ch.postMessage(payload);
    ch.close();
  } catch {
    /* BroadcastChannel no disponible */
  }
  try {
    localStorage.setItem(TV_RANKING_STORAGE_KEY, String(payload.at));
  } catch {
    /* private mode / blocked */
  }
}

/** Escucha pedidos de mostrar ranking (otras pestañas / misma app). */
export function subscribeShowTvRanking(onShow: () => void): () => void {
  let ch: BroadcastChannel | null = null;
  try {
    ch = new BroadcastChannel(TV_RANKING_CHANNEL);
    ch.onmessage = (ev: MessageEvent) => {
      const data = ev.data as TvRankingMessage | null;
      if (data?.type === "show-ranking") onShow();
    };
  } catch {
    ch = null;
  }

  const onStorage = (e: StorageEvent) => {
    if (e.key === TV_RANKING_STORAGE_KEY && e.newValue) onShow();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    try {
      ch?.close();
    } catch {
      /* ignore */
    }
    window.removeEventListener("storage", onStorage);
  };
}
