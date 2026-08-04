/**
 * Normalización y resolución de clientes canónicos AAA / JH / IMPOMEX.
 * Match exacto sobre aliases (nunca substring peligroso).
 */

import type {
  CanonicalWarehouseClient,
  WarehouseClientRow,
} from "@/lib/warehouse/types";
import {
  CANONICAL_WAREHOUSE_CLIENTS,
  CLIENT_DISPLAY_NAMES,
} from "@/lib/warehouse/types";

const ACCENT_MAP: Record<string, string> = {
  Á: "A",
  É: "E",
  Í: "I",
  Ó: "O",
  Ú: "U",
  Ü: "U",
  Ñ: "N",
  À: "A",
  È: "E",
  Ì: "I",
  Ò: "O",
  Ù: "U",
};

/** Mayúsculas, sin acentos, espacios colapsados, sin puntuación sobrante. */
export function normalizeWarehouseClientText(raw: unknown): string {
  let s = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (!s) return "";
  s = s.replace(/[ÁÉÍÓÚÜÑÀÈÌÒÙ]/g, (ch) => ACCENT_MAP[ch] ?? ch);
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/[.,;:/\\|_\-]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function aliasesOf(row: WarehouseClientRow): string[] {
  const a = row.aliases;
  if (Array.isArray(a)) {
    return a.map((x) => normalizeWarehouseClientText(x)).filter(Boolean);
  }
  if (typeof a === "string") {
    try {
      const parsed = JSON.parse(a) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((x) => normalizeWarehouseClientText(x)).filter(Boolean);
      }
    } catch {
      /* ignore */
    }
  }
  return [normalizeWarehouseClientText(row.code)].filter(Boolean);
}

/**
 * Resuelve un texto de cliente a código canónico usando filas de warehouse_clients.
 * Solo igualdad exacta tras normalizar.
 */
export function resolveCanonicalWarehouseClient(
  clientText: unknown,
  clients: WarehouseClientRow[],
): CanonicalWarehouseClient | null {
  const key = normalizeWarehouseClientText(clientText);
  if (!key) return null;

  for (const row of clients) {
    if (!row.active) continue;
    const code = normalizeWarehouseClientText(row.code);
    if (!CANONICAL_WAREHOUSE_CLIENTS.includes(code as CanonicalWarehouseClient)) {
      continue;
    }
    const set = new Set([code, ...aliasesOf(row)]);
    if (set.has(key)) return code as CanonicalWarehouseClient;
  }

  if (CANONICAL_WAREHOUSE_CLIENTS.includes(key as CanonicalWarehouseClient)) {
    return key as CanonicalWarehouseClient;
  }
  return null;
}

/** Extrae mainClient (u otros candidatos) desde payload de task. */
export function resolveCanonicalWarehouseClientFromPayload(
  payload: Record<string, unknown> | null | undefined,
  clients: WarehouseClientRow[],
): CanonicalWarehouseClient | null {
  if (!payload || typeof payload !== "object") return null;
  const candidates = [
    payload.mainClient,
    payload.cliente,
    payload.client,
    payload.customer,
  ];
  for (const c of candidates) {
    const hit = resolveCanonicalWarehouseClient(c, clients);
    if (hit) return hit;
  }
  return null;
}

export function clientDisplayName(
  code: CanonicalWarehouseClient | string | null | undefined,
  clients?: WarehouseClientRow[],
): string {
  if (!code) return "—";
  const row = clients?.find((c) => c.code === code);
  if (row?.display_name) return row.display_name;
  if (code in CLIENT_DISPLAY_NAMES) {
    return CLIENT_DISPLAY_NAMES[code as CanonicalWarehouseClient];
  }
  return String(code);
}

export function defaultWarehouseClientSeeds(): WarehouseClientRow[] {
  return [
    { code: "AAA", display_name: "AAA", aliases: ["AAA"], active: true },
    { code: "JH", display_name: "JH", aliases: ["JH"], active: true },
    {
      code: "IMPOMEX",
      display_name: "IMPOMEX DE COLOMBIA LTDA",
      aliases: ["IMPOMEX", "IMPOMEX DE COLOMBIA LTDA"],
      active: true,
    },
  ];
}

/** Alias list as string[] from jsonb. */
export function shipperAliasesList(aliases: unknown): string[] {
  if (Array.isArray(aliases)) {
    return aliases.map((x) => String(x ?? "").trim()).filter(Boolean);
  }
  if (typeof aliases === "string") {
    try {
      const parsed = JSON.parse(aliases) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x ?? "").trim()).filter(Boolean);
      }
    } catch {
      /* ignore */
    }
  }
  return [];
}
