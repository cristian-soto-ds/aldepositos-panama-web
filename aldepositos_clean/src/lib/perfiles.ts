import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/** Tabla principal en español. */
export const PERFILES_TABLE = "perfiles";
/** Tabla estándar Supabase (inglés), por si el proyecto usa ambas. */
export const PROFILES_TABLE_EN = "profiles";

export type PerfilNormalizado = {
  nombreCompleto: string;
  nombreUsuario: string;
  correoPerfil: string;
  avatarUrl: string | null;
};

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function pickNombreCompleto(row: Record<string, unknown>): string {
  const direct = trimStr(
    row.nombre_completo ?? row.full_name ?? row.nombre_para_mostrar,
  );
  if (direct) return direct;
  for (const [key, val] of Object.entries(row)) {
    if (typeof val !== "string" || !val.trim()) continue;
    const k = key.toLowerCase().replace(/\s+/g, "_");
    if (
      k.includes("nombre") &&
      k.includes("completo") &&
      !k.includes("usuario")
    ) {
      return val.trim();
    }
  }
  return "";
}

/**
 * Acepta filas de `perfiles` / `profiles` con nombres en español o inglés.
 */
export function normalizarFilaPerfil(
  row: Record<string, unknown> | null | undefined,
): PerfilNormalizado {
  if (!row) {
    return {
      nombreCompleto: "",
      nombreUsuario: "",
      correoPerfil: "",
      avatarUrl: null,
    };
  }
  const nombreCompleto = pickNombreCompleto(row);
  const nombreUsuario = trimStr(
    row.nombre_de_usuario ??
      row.nombre_usuario ??
      row.username ??
      row["nombre de usuario"],
  );
  const correoPerfil = trimStr(
    row.correo_electronico ??
      row.email ??
      row.correo ??
      row["correo electrónico"],
  );
  const rawAvatar = row.avatar_url;
  const avatarUrl =
    typeof rawAvatar === "string" && rawAvatar.trim() ? rawAvatar.trim() : null;
  return { nombreCompleto, nombreUsuario, correoPerfil, avatarUrl };
}

async function maybeSingleRowWithClient(
  client: SupabaseClient,
  table: string,
  column: string,
  value: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await client
    .from(table)
    .select("*")
    .eq(column, value)
    .maybeSingle();
  if (error) console.warn(`[${table}] ${column}=…`, error.message);
  return data ? (data as Record<string, unknown>) : null;
}

async function fetchPerfilRowByUserIdWithClient(
  client: SupabaseClient,
  userId: string,
): Promise<Record<string, unknown> | null> {
  for (const col of ["id", "uuid", "user_id"] as const) {
    const row = await maybeSingleRowWithClient(client, PERFILES_TABLE, col, userId);
    if (row) return row;
  }
  return null;
}

async function fetchPerfilRowByEmailWithClient(
  client: SupabaseClient,
  emailRaw: string,
): Promise<Record<string, unknown> | null> {
  const email = emailRaw.trim();
  if (!email) return null;
  const lower = email.toLowerCase();

  for (const col of ["email", "correo_electronico", "correo"] as const) {
    const rowEq = await maybeSingleRowWithClient(client, PERFILES_TABLE, col, email);
    if (rowEq) return rowEq;
    if (lower !== email) {
      const rowEqL = await maybeSingleRowWithClient(client, PERFILES_TABLE, col, lower);
      if (rowEqL) return rowEqL;
    }
  }

  for (const col of ["email", "correo_electronico", "correo"] as const) {
    const { data, error } = await client
      .from(PERFILES_TABLE)
      .select("*")
      .ilike(col, lower)
      .maybeSingle();
    if (error) console.warn(`[perfiles] ilike ${col}:`, error.message);
    if (data) return data as Record<string, unknown>;
  }

  return null;
}

async function fetchEnglishProfilesRowWithClient(
  client: SupabaseClient,
  userId: string,
): Promise<Record<string, unknown> | null> {
  return maybeSingleRowWithClient(client, PROFILES_TABLE_EN, "id", userId);
}

async function fetchPerfilRowRawWithClient(
  client: SupabaseClient,
  userId: string,
  authEmail: string | null | undefined,
): Promise<Record<string, unknown> | null> {
  const byUid = await fetchPerfilRowByUserIdWithClient(client, userId);
  if (byUid) return byUid;

  if (authEmail?.trim()) {
    const byMail = await fetchPerfilRowByEmailWithClient(client, authEmail);
    if (byMail) return byMail;
  }

  const en = await fetchEnglishProfilesRowWithClient(client, userId);
  if (en) return en;

  return null;
}

/**
 * Igual que el cliente anónimo del navegador, pero con cualquier `SupabaseClient` (p. ej. service role en API).
 */
export async function fetchPerfilUsuarioWithClient(
  client: SupabaseClient,
  userId: string,
  authEmail?: string | null,
): Promise<PerfilNormalizado> {
  const row = await fetchPerfilRowRawWithClient(client, userId, authEmail);
  return normalizarFilaPerfil(row);
}

/**
 * Carga perfil para el usuario autenticado: `perfiles` (id / uuid / user_id / correo) y fallback `profiles`.
 */
export async function fetchPerfilUsuario(
  userId: string,
  authEmail?: string | null,
): Promise<PerfilNormalizado> {
  return fetchPerfilUsuarioWithClient(supabase, userId, authEmail);
}

/**
 * Actualiza columnas de la fila del usuario en `perfiles`.
 * Prueba varias columnas de clave por compatibilidad con distintos esquemas.
 */
export async function updatePerfilByUserId(
  userId: string,
  patch: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  for (const col of ["id", "uuid", "user_id"] as const) {
    const { data, error } = await supabase
      .from(PERFILES_TABLE)
      .update(patch)
      .eq(col, userId)
      .select();
    if (error) {
      console.warn(`[perfiles] update (${col}):`, error.message);
      continue;
    }
    if (data && data.length > 0) return { ok: true };
  }
  return {
    ok: false,
    message:
      "No se actualizó el perfil. Revisa RLS y que exista la fila en public.perfiles.",
  };
}
