import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { fetchPerfilUsuarioWithClient } from "@/lib/perfiles";

/**
 * Devuelve nombre completo y avatar leyendo `perfiles` sin pasar por RLS del cliente,
 * solo si existe `SUPABASE_SERVICE_ROLE_KEY` y el token JWT es válido.
 * Así el panel puede mostrar `nombre_completo` aunque no haya política SELECT en `perfiles`.
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

  if (!serviceKey) {
    return NextResponse.json({
      fullName: null as string | null,
      avatarUrl: null as string | null,
      skipped: true,
    });
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const perfil = await fetchPerfilUsuarioWithClient(
    admin,
    user.id,
    user.email ?? null,
  );

  return NextResponse.json({
    fullName: perfil.nombreCompleto || null,
    avatarUrl: perfil.avatarUrl,
    skipped: false,
  });
}
