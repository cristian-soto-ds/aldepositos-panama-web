/**
 * Contador local (navegador) + límites orientativos para mostrar "cuánto falta".
 * Google no devuelve el cupo exacto restante en cada respuesta; esto es una guía.
 */

const STORAGE_KEY = "ald-gemini-usage-v2";

export type GeminiTokenUsage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

type Stored = {
  day: string;
  requestsToday: number;
  promptTokensToday: number;
  candidatesTokensToday: number;
  minuteKey: string;
  requestsThisMinute: number;
  tokensThisMinute: number;
};

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentMinuteKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${da}T${h}:${mi}`;
}

function readStored(): Stored {
  if (typeof window === "undefined") {
    return emptyStored();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStored();
    const p = JSON.parse(raw) as Partial<Stored>;
    return {
      day: typeof p.day === "string" ? p.day : todayUtcDate(),
      requestsToday: Math.max(0, Number(p.requestsToday) || 0),
      promptTokensToday: Math.max(0, Number(p.promptTokensToday) || 0),
      candidatesTokensToday: Math.max(0, Number(p.candidatesTokensToday) || 0),
      minuteKey: typeof p.minuteKey === "string" ? p.minuteKey : currentMinuteKey(),
      requestsThisMinute: Math.max(0, Number(p.requestsThisMinute) || 0),
      tokensThisMinute: Math.max(0, Number(p.tokensThisMinute) || 0),
    };
  } catch {
    return emptyStored();
  }
}

function emptyStored(): Stored {
  const mk = typeof window !== "undefined" ? currentMinuteKey() : "";
  return {
    day: todayUtcDate(),
    requestsToday: 0,
    promptTokensToday: 0,
    candidatesTokensToday: 0,
    minuteKey: mk,
    requestsThisMinute: 0,
    tokensThisMinute: 0,
  };
}

function writeStored(s: Stored): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota */
  }
}

/** Límites orientativos (plan gratuito típico Flash; ajusta en .env.local). */
export function readGeminiQuotaLimitsFromEnv(): {
  rpd: number;
  rpm: number;
} {
  const rpd = Math.max(0, parseInt(process.env.NEXT_PUBLIC_GEMINI_QUOTA_RPD || "1500", 10) || 0);
  const rpm = Math.max(0, parseInt(process.env.NEXT_PUBLIC_GEMINI_QUOTA_RPM || "15", 10) || 0);
  return { rpd, rpm };
}

export type GeminiUsageSummary = {
  lastReplyTokens: GeminiTokenUsage | null;
  today: {
    usedRequests: number;
    limitRequests: number;
    remainingRequests: number | null;
  };
  thisMinute: {
    usedRequests: number;
    limitRequests: number;
    remainingRequests: number | null;
  };
  tokensToday: { prompt: number; candidates: number };
};

function buildSummary(
  stored: Stored,
  last: GeminiTokenUsage | null,
  limits: { rpd: number; rpm: number },
): GeminiUsageSummary {
  const { rpd, rpm } = limits;
  return {
    lastReplyTokens: last,
    today: {
      usedRequests: stored.requestsToday,
      limitRequests: rpd,
      remainingRequests: rpd > 0 ? Math.max(0, rpd - stored.requestsToday) : null,
    },
    thisMinute: {
      usedRequests: stored.requestsThisMinute,
      limitRequests: rpm,
      remainingRequests: rpm > 0 ? Math.max(0, rpm - stored.requestsThisMinute) : null,
    },
    tokensToday: {
      prompt: stored.promptTokensToday,
      candidates: stored.candidatesTokensToday,
    },
  };
}

/** Solo lectura (al abrir el panel). */
export function loadGeminiUsageSummary(): GeminiUsageSummary {
  const limits = readGeminiQuotaLimitsFromEnv();
  let s = readStored();
  const day = todayUtcDate();
  if (s.day !== day) {
    s = {
      ...s,
      day,
      requestsToday: 0,
      promptTokensToday: 0,
      candidatesTokensToday: 0,
      requestsThisMinute: 0,
      tokensThisMinute: 0,
      minuteKey: currentMinuteKey(),
    };
    writeStored(s);
  }
  const mk = currentMinuteKey();
  if (s.minuteKey !== mk) {
    s = { ...s, minuteKey: mk, requestsThisMinute: 0, tokensThisMinute: 0 };
    writeStored(s);
  }
  return buildSummary(s, null, limits);
}

/** Tras una respuesta exitosa del API. */
export function recordGeminiRequestSuccess(
  usage: GeminiTokenUsage | null | undefined,
): GeminiUsageSummary {
  const limits = readGeminiQuotaLimitsFromEnv();
  let s = readStored();
  const day = todayUtcDate();
  const mk = currentMinuteKey();

  if (s.day !== day) {
    s = {
      day,
      requestsToday: 0,
      promptTokensToday: 0,
      candidatesTokensToday: 0,
      minuteKey: mk,
      requestsThisMinute: 0,
      tokensThisMinute: 0,
    };
  } else if (s.minuteKey !== mk) {
    s = { ...s, minuteKey: mk, requestsThisMinute: 0, tokensThisMinute: 0 };
  }

  s.requestsToday += 1;
  s.requestsThisMinute += 1;

  const p = usage?.promptTokenCount;
  const c = usage?.candidatesTokenCount;
  if (typeof p === "number" && Number.isFinite(p) && p > 0) {
    s.promptTokensToday += Math.round(p);
  }
  if (typeof c === "number" && Number.isFinite(c) && c > 0) {
    s.candidatesTokensToday += Math.round(c);
  }
  const tot = usage?.totalTokenCount;
  if (typeof tot === "number" && Number.isFinite(tot) && tot > 0) {
    s.tokensThisMinute += Math.round(tot);
  } else if ((p ?? 0) > 0 || (c ?? 0) > 0) {
    s.tokensThisMinute += Math.round((p ?? 0) + (c ?? 0));
  }

  writeStored(s);

  const last: GeminiTokenUsage | null =
    usage &&
    (usage.promptTokenCount != null ||
      usage.candidatesTokenCount != null ||
      usage.totalTokenCount != null)
      ? {
          promptTokenCount: usage.promptTokenCount,
          candidatesTokenCount: usage.candidatesTokenCount,
          totalTokenCount: usage.totalTokenCount,
        }
      : null;

  return buildSummary(s, last, limits);
}

/** Textos cortos para el panel (cada uso / acumulado). */
export function formatGeminiUsageLines(s: GeminiUsageSummary): string[] {
  const out: string[] = [];
  const last = s.lastReplyTokens;
  if (last && (last.promptTokenCount != null || last.candidatesTokenCount != null || last.totalTokenCount != null)) {
    const p = last.promptTokenCount;
    const c = last.candidatesTokenCount;
    const t = last.totalTokenCount;
    const parts: string[] = [];
    if (p != null && p > 0) parts.push(`entrada ${p.toLocaleString("es-MX")}`);
    if (c != null && c > 0) parts.push(`salida ${c.toLocaleString("es-MX")}`);
    if (t != null && t > 0) parts.push(`total ${t.toLocaleString("es-MX")}`);
    if (parts.length > 0) {
      out.push(`Esta respuesta (tokens): ${parts.join(" · ")}.`);
    }
  } else if (s.today.usedRequests > 0 || s.thisMinute.usedRequests > 0) {
    out.push(
      "Esta respuesta: Google no envió conteo de tokens (a veces ocurre con la API gratuita).",
    );
  }

  if (s.today.limitRequests > 0 && s.today.remainingRequests != null) {
    out.push(
      `Hoy en este navegador: ${s.today.usedRequests} envío(s) · tope orientativo ${s.today.limitRequests}/día · quedan ~${s.today.remainingRequests}.`,
    );
  }
  if (s.thisMinute.limitRequests > 0 && s.thisMinute.remainingRequests != null) {
    out.push(
      `Este minuto: ${s.thisMinute.usedRequests} envío(s) · tope orientativo ${s.thisMinute.limitRequests}/min · quedan ~${s.thisMinute.remainingRequests}.`,
    );
  }

  if (s.tokensToday.prompt > 0 || s.tokensToday.candidates > 0) {
    out.push(
      `Tokens acumulados hoy (este navegador): entrada ${s.tokensToday.prompt.toLocaleString("es-MX")} · salida ${s.tokensToday.candidates.toLocaleString("es-MX")}.`,
    );
  }

  const hasQuotaHints =
    s.today.limitRequests > 0 ||
    s.thisMinute.limitRequests > 0 ||
    (s.lastReplyTokens &&
      (s.lastReplyTokens.promptTokenCount != null ||
        s.lastReplyTokens.candidatesTokenCount != null));

  if (!hasQuotaHints && out.length === 0) {
    out.push(
      "Añade en .env.local NEXT_PUBLIC_GEMINI_QUOTA_RPD=1500 y NEXT_PUBLIC_GEMINI_QUOTA_RPM=15 (o los límites que veas en AI Studio) para estimar cuántas consultas te faltan.",
    );
  }
  out.push(
    "Los topes son orientativos; confirma cupos en https://aistudio.google.com · El contador de envíos es solo en este navegador.",
  );
  return out;
}
