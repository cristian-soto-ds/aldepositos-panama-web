import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { INVENTARIADORES, resolveInventariadorId } from "@/lib/inventariadoresRoster";
import {
  normalizarFilaPerfil,
  PERFILES_TABLE,
  PROFILES_TABLE_EN,
} from "@/lib/perfiles";

/**
 * Avatares de inventariadores del roster para el ranking.
 * Lee `perfiles` / `profiles` con service role (RLS del cliente no deja ver ajenos).
 */
export async function GET(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey) {
    return NextResponse.json(
      { error: "Falta configuración de Supabase." },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization");
  const token =
    authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Sin sesión." }, { status: 401 });
  }

  const verify = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user },
    error: authErr,
  } = await verify.auth.getUser(token);
  if (authErr || !user) {
    return NextResponse.json({ error: "Sesión inválida." }, { status: 401 });
  }

  const empty: Record<string, string> = {};
  for (const e of INVENTARIADORES) empty[e.id] = "";

  const admin = serviceKey
    ? createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      });

  const rows: Record<string, unknown>[] = [];
  for (const table of [PERFILES_TABLE, PROFILES_TABLE_EN] as const) {
    const { data, error } = await admin.from(table).select("*");
    if (error) {
      console.warn(`[leaderboard/avatars] ${table}:`, error.message);
      continue;
    }
    if (Array.isArray(data)) {
      for (const row of data) {
        if (row && typeof row === "object") {
          rows.push(row as Record<string, unknown>);
        }
      }
    }
  }

  const avatars: Record<string, string> = { ...empty };
  for (const row of rows) {
    const perfil = normalizarFilaPerfil(row);
    const avatar = perfil.avatarUrl?.trim() || "";
    if (!avatar) continue;
    const id =
      resolveInventariadorId(perfil.nombreCompleto, perfil.correoPerfil) ??
      resolveInventariadorId(perfil.nombreUsuario, perfil.correoPerfil);
    if (!id) continue;
    if (!avatars[id]) avatars[id] = avatar;
  }

  return NextResponse.json({
    avatars,
    skipped: false,
    usedServiceRole: Boolean(serviceKey),
  });
}
