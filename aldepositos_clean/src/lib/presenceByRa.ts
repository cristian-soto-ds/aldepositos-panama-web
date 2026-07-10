import type { WorkPresenceEntry, WorkPresenceModule } from "@/lib/panelPresence";
import { peerPresenceVisibleName } from "@/lib/viewerIdentity";

export type LiveOperatorOnRa = {
  userKey: string;
  name: string;
  /** Etiqueta cruda de presencia (antes de enmascarar correos como «Operador»). */
  rawLabel: string;
  module: WorkPresenceModule;
  avatarUrl?: string | null;
};

const INVENTORY_MODULES: WorkPresenceModule[] = ["quick", "detailed", "airway"];

export const PRESENCE_MODULE_LABELS: Record<WorkPresenceModule, string> = {
  quick: "Rápido",
  detailed: "Detallado",
  airway: "Aéreo",
  none: "Panel",
};

/** Agrupa operadores activos por RA (todas las modalidades de inventario). */
export function buildPresenceByRa(
  presenceList: WorkPresenceEntry[],
): Map<string, LiveOperatorOnRa[]> {
  const map = new Map<string, LiveOperatorOnRa[]>();

  for (const entry of presenceList) {
    if (!INVENTORY_MODULES.includes(entry.module)) continue;
    const raKey = String(entry.ra ?? "").trim().toUpperCase();
    if (!raKey) continue;

    const rawLabel = String(entry.userLabel ?? "").trim();
    const name = peerPresenceVisibleName(rawLabel, entry.userKey);
    const list = map.get(raKey) ?? [];
    const exists = list.some(
      (op) => op.userKey === entry.userKey && op.module === entry.module,
    );
    if (!exists) {
      list.push({
        userKey: entry.userKey,
        name,
        rawLabel: rawLabel || name,
        module: entry.module,
        avatarUrl: entry.avatarUrl,
      });
    }
    map.set(raKey, list);
  }

  return map;
}

export function liveOperatorsForRa(
  presenceByRa: Map<string, LiveOperatorOnRa[]>,
  ra: string | number | undefined | null,
): LiveOperatorOnRa[] {
  const raKey = String(ra ?? "").trim().toUpperCase();
  if (!raKey) return [];
  return presenceByRa.get(raKey) ?? [];
}
