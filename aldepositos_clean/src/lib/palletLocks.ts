import type { WorkPresenceEntry } from "@/lib/panelPresence";
import { isAllowedInventoryOperator } from "@/lib/inventoryOperatorsAllowlist";
import { peerPresenceVisibleName } from "@/lib/viewerIdentity";

export type PalletClaim = {
  pallet: number;
  userKey: string;
  userLabel: string;
  tabId: string;
};

/** Quién tiene reclamada cada paleta en un RA (solo inventariadores). */
export function buildPalletClaimsForRa(
  presenceList: WorkPresenceEntry[],
  ra: string | number | null | undefined,
): Map<number, PalletClaim> {
  const raKey = String(ra ?? "").trim().toUpperCase();
  const map = new Map<number, PalletClaim>();
  if (!raKey) return map;

  for (const entry of presenceList) {
    if (String(entry.ra ?? "").trim().toUpperCase() !== raKey) continue;
    if (!isAllowedInventoryOperator(entry.userKey, entry.userLabel)) continue;
    const pallet = Number(entry.activePallet);
    if (!Number.isFinite(pallet) || pallet < 1) continue;
    const p = Math.floor(pallet);
    // Primero en llegar se queda (no pisar claim existente).
    if (map.has(p)) continue;
    map.set(p, {
      pallet: p,
      userKey: entry.userKey,
      userLabel: peerPresenceVisibleName(entry.userLabel, entry.userKey),
      tabId: entry.tabId,
    });
  }
  return map;
}

export function claimForPallet(
  claims: Map<number, PalletClaim>,
  pallet: number,
): PalletClaim | null {
  return claims.get(Math.max(1, Math.floor(pallet))) ?? null;
}

export function isPalletClaimedByOther(
  claims: Map<number, PalletClaim>,
  pallet: number,
  myUserKey: string,
): boolean {
  const claim = claimForPallet(claims, pallet);
  if (!claim) return false;
  const me = myUserKey.trim().toLowerCase();
  return claim.userKey.trim().toLowerCase() !== me;
}

/** Primera paleta libre entre las existentes; si todas ocupadas, max+1. */
export function findNextFreePallet(
  existingPallets: number[],
  claims: Map<number, PalletClaim>,
  myUserKey: string,
): number {
  const unique = [...new Set(existingPallets.map((n) => Math.max(1, Math.floor(n))))].sort(
    (a, b) => a - b,
  );
  const me = myUserKey.trim().toLowerCase();
  for (const p of unique) {
    const claim = claims.get(p);
    if (!claim || claim.userKey.trim().toLowerCase() === me) return p;
  }
  const max = unique.length > 0 ? Math.max(...unique) : 0;
  return max + 1;
}
