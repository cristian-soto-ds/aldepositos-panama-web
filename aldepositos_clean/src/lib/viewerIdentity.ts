/**
 * Nombre e iniciales visibles del operador (sin correo ni parte local del correo).
 */

export function isLikelyEmail(s: string): boolean {
  const t = s.trim();
  return t.includes("@");
}

export function presenceVisibleLabel(
  userLabel: string | null | undefined,
  authEmail: string | null | undefined,
): string {
  const raw = String(userLabel ?? "").trim();
  if (!raw || isLikelyEmail(raw)) return "Operador";

  const el = String(authEmail ?? "").trim().toLowerCase();
  const local = (el.split("@")[0] ?? "").toLowerCase();
  const rl = raw.toLowerCase();
  if (el && rl === el) return "Operador";
  if (local && rl === local) return "Operador";

  return raw;
}

/** Si `userKey` es correo, evita tratar la parte local como nombre visible. */
export function peerPresenceVisibleName(userLabel: string, userKey: string): string {
  const key = userKey.trim();
  return presenceVisibleLabel(userLabel, key.includes("@") ? key : null);
}

/**
 * Iniciales para avatar cuando no hay foto: solo desde un nombre legítimo (no correo).
 */
export function avatarInitialsFromName(
  fullName: string | null | undefined,
  fallbackName: string | null | undefined,
  authEmail: string | null | undefined,
): string {
  const email = String(authEmail ?? "").trim().toLowerCase();
  const local = (email.split("@")[0] ?? "").toLowerCase();

  const pick = (s: string | null | undefined): string | null => {
    const t = String(s ?? "").trim();
    if (!t || isLikelyEmail(t)) return null;
    const tl = t.toLowerCase();
    if (email && tl === email) return null;
    if (local && tl === local) return null;
    return t;
  };

  const name = pick(fullName) ?? pick(fallbackName);
  if (!name) return "?";

  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0]![0] ?? "";
    const b = parts[parts.length - 1]![0] ?? "";
    return (a + b).toUpperCase() || "?";
  }
  if (parts.length === 1 && parts[0]!.length >= 2) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}
