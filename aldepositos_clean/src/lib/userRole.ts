/**
 * Roles de panel (columna `rol` en perfiles / profiles).
 * Valores en minúsculas para filtrar fácil en Table Editor.
 */

export type AppRole = "admin" | "inventariador";

/** Vistas del sidebar que puede abrir un inventariador. */
export const INVENTARIADOR_VIEWS = [
  "quick-entry",
  "photo-record",
  "inventory-leaderboard",
  "control-carga",
  "options",
] as const;

export type InventariadorView = (typeof INVENTARIADOR_VIEWS)[number];

export const INVENTARIADOR_DEFAULT_VIEW: InventariadorView = "quick-entry";

export function normalizeRole(raw: unknown): AppRole {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "inventariador") return "inventariador";
  return "admin";
}

export function canAccessView(role: AppRole, view: string): boolean {
  if (role === "admin") return true;
  return (INVENTARIADOR_VIEWS as readonly string[]).includes(view);
}

export function clampViewForRole(role: AppRole, view: string): string {
  if (canAccessView(role, view)) return view;
  return INVENTARIADOR_DEFAULT_VIEW;
}
