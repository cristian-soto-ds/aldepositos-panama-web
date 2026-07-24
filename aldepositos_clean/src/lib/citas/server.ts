import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import {
  fetchPerfilUsuarioWithClient,
  type PerfilNormalizado,
} from "@/lib/perfiles";
import type { Cita, CitaAdjunto } from "@/lib/citas/types";
import { normalizeCitaRow } from "@/lib/citas/types";

export const CITAS_BUCKET = "cita-adjuntos";

export type CitasAuthContext = {
  user: User | null;
  admin: SupabaseClient;
  anon: SupabaseClient;
  perfil: PerfilNormalizado | null;
  rol: "staff" | "proveedor";
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta variable de entorno ${name}`);
  return v;
}

export function createCitasAdminClient(): SupabaseClient {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY para citas.");
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function createCitasAnonClient(): SupabaseClient {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function generateCodigoSeguimiento(): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `CIT-${y}${m}${d}-${rand}`;
}

export function sanitizeFileName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

export async function resolveAuthFromRequest(
  request: NextRequest,
): Promise<CitasAuthContext> {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const admin = serviceKey
    ? createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : anon;

  const authHeader = request.headers.get("authorization");
  const token =
    authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!token) {
    return { user: null, admin, anon, perfil: null, rol: "staff" };
  }

  const {
    data: { user },
    error,
  } = await anon.auth.getUser(token);

  if (error || !user) {
    return { user: null, admin, anon, perfil: null, rol: "staff" };
  }

  const perfil = await fetchPerfilUsuarioWithClient(
    admin,
    user.id,
    user.email ?? null,
  );
  const rol = await fetchUserRol(admin, user.id);
  return { user, admin, anon, perfil, rol };
}

async function fetchUserRol(
  client: SupabaseClient,
  userId: string,
): Promise<"staff" | "proveedor"> {
  for (const table of ["perfiles", "profiles"] as const) {
    for (const col of ["id", "uuid", "user_id"] as const) {
      const { data, error } = await client
        .from(table)
        .select("rol")
        .eq(col, userId)
        .maybeSingle();
      if (error) continue;
      if (data && typeof (data as { rol?: unknown }).rol === "string") {
        const r = String((data as { rol: string }).rol).toLowerCase();
        if (r === "proveedor") return "proveedor";
        return "staff";
      }
    }
  }
  return "staff";
}

export async function fetchCitasForViewer(
  admin: SupabaseClient,
  opts: {
    rol: "staff" | "proveedor";
    userId: string;
    email: string | null;
    estado?: string | null;
  },
): Promise<Cita[]> {
  let q = admin.from("citas").select("*").order("created_at", { ascending: false });

  if (opts.estado) {
    q = q.eq("estado", opts.estado);
  }

  if (opts.rol === "proveedor") {
    const email = (opts.email ?? "").trim().toLowerCase();
    if (email) {
      q = q.or(
        `proveedor_user_id.eq.${opts.userId},email.eq.${email}`,
      );
    } else {
      q = q.eq("proveedor_user_id", opts.userId);
    }
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((row) =>
    normalizeCitaRow(row as Record<string, unknown>),
  );
}

export async function uploadCitaAdjuntos(
  admin: SupabaseClient,
  citaId: string,
  files: File[],
): Promise<CitaAdjunto[]> {
  const uploaded: CitaAdjunto[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const safe = sanitizeFileName(file.name || `archivo-${i + 1}`);
    const path = `${citaId}/${Date.now()}-${i}-${safe}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error } = await admin.storage.from(CITAS_BUCKET).upload(path, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (error) throw new Error(`Error subiendo ${file.name}: ${error.message}`);
    uploaded.push({
      path,
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
    });
  }
  return uploaded;
}

export async function createSignedAdjuntoUrls(
  admin: SupabaseClient,
  adjuntos: CitaAdjunto[],
  expiresIn = 3600,
): Promise<Array<CitaAdjunto & { url: string | null }>> {
  const out: Array<CitaAdjunto & { url: string | null }> = [];
  for (const a of adjuntos) {
    const { data, error } = await admin.storage
      .from(CITAS_BUCKET)
      .createSignedUrl(a.path, expiresIn);
    out.push({
      ...a,
      url: error ? null : (data?.signedUrl ?? null),
    });
  }
  return out;
}
