"use client";

import { useEffect, useState } from "react";
import {
  defaultInventoryControlSettings,
  fetchInventoryControlSettings,
  operatorAllowsKeyboardMeasures,
  subscribeInventoryControlSettings,
  type InventoryControlSettings,
} from "@/lib/inventoryControlSettings";

/** Hook liviano para QuickInventoryEntry / Reekon. */
export function useAllowKeyboardMeasures(
  userKey: string | null | undefined,
  userLabel: string | null | undefined,
): boolean {
  const [settings, setSettings] = useState<InventoryControlSettings>(
    defaultInventoryControlSettings,
  );

  useEffect(() => {
    let cancelled = false;
    void fetchInventoryControlSettings().then((s) => {
      if (!cancelled) setSettings(s);
    });
    return subscribeInventoryControlSettings(() => {
      void fetchInventoryControlSettings().then((s) => {
        if (!cancelled) setSettings(s);
      });
    });
  }, []);

  return operatorAllowsKeyboardMeasures(settings, userKey, userLabel);
}
