"use client";

import { useEffect, useMemo, useState } from "react";
import { subscribeWorkPresence, type WorkPresenceEntry } from "@/lib/panelPresence";
import { buildPresenceByRa } from "@/lib/presenceByRa";

/** Suscripción en vivo a operadores por RA (ingreso rápido, detallado, aéreo). */
export function useInventoryPresenceByRa() {
  const [presenceList, setPresenceList] = useState<WorkPresenceEntry[]>([]);

  useEffect(() => subscribeWorkPresence(setPresenceList), []);

  return useMemo(() => buildPresenceByRa(presenceList), [presenceList]);
}
