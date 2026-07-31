"use client";

import { useEffect, useMemo, useState } from "react";
import { subscribeWorkPresence, type WorkPresenceEntry } from "@/lib/panelPresence";
import { buildPresenceByRa } from "@/lib/presenceByRa";

/** Suscripción en vivo a operadores por RA (ingreso rápido, detallado, aéreo). */
export function useInventoryPresenceByRa(): {
  presenceByRa: ReturnType<typeof buildPresenceByRa>;
  presenceList: WorkPresenceEntry[];
} {
  const [presenceList, setPresenceList] = useState<WorkPresenceEntry[]>([]);

  useEffect(() => subscribeWorkPresence(setPresenceList), []);

  const presenceByRa = useMemo(
    () => buildPresenceByRa(presenceList),
    [presenceList],
  );

  return { presenceByRa, presenceList };
}
