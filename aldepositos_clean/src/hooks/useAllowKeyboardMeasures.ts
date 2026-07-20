"use client";

import { useEffect, useState } from "react";
import {
  fetchInventoryControlSettings,
  operatorAllowsKeyboardMeasures,
  subscribeInventoryControlSettings,
  type InventoryControlSettings,
  INVENTORY_CONTROL_STORAGE_KEY,
  defaultInventoryControlSettings,
} from "@/lib/inventoryControlSettings";

function readCachedSettings(): InventoryControlSettings {
  if (typeof window === "undefined") return defaultInventoryControlSettings();
  try {
    const raw = window.localStorage.getItem(INVENTORY_CONTROL_STORAGE_KEY);
    if (!raw) return defaultInventoryControlSettings();
    const parsed = JSON.parse(raw) as InventoryControlSettings;
    if (
      parsed &&
      Array.isArray(parsed.keyboardOperatorIds) &&
      typeof parsed.updatedAt === "string"
    ) {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return defaultInventoryControlSettings();
}

/** Hook liviano para QuickInventoryEntry / Reekon. */
export function useAllowKeyboardMeasures(
  userKey: string | null | undefined,
  userLabel: string | null | undefined,
): boolean {
  const [settings, setSettings] = useState<InventoryControlSettings>(readCachedSettings);

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
