import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchPerfilUsuarioWithClient } from "@/lib/perfiles";

/**
 * Devuelve rol del usuario autenticado (staff | proveedor) para redirects post-login.
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

  const client = serviceKey
    ? createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : verify;

  let rol: "staff" | "proveedor" = "staff";
  for (const table of ["perfiles", "profiles"] as const) {
    for (const col of ["id", "uuid", "user_id"] as const) {
      const { data } = await client
        .from(table)
        .select("rol")
        .eq(col, user.id)
        .maybeSingle();
      if (data && typeof (data as { rol?: unknown }).rol === "string") {
        const r = String((data as { rol: string }).rol).toLowerCase();
        if (r === "proveedor") rol = "proveedor";
        break;
      }
    }
    if (rol === "proveedor") break;
  }

  const perfil = await fetchPerfilUsuarioWithClient(
    client,
    user.id,
    user.email ?? null,
  );

  return NextResponse.json({
    rol,
    fullName: perfil.nombreCompleto || null,
    email: user.email ?? perfil.correoPerfil ?? null,
  });
}
