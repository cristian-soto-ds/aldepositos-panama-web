import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export const TERRA_LEARNING_TABLE = "gemini_learning_notes";

export type TerraLearningNote = {
  id: string;
  body: string;
  created_at: string;
};

/** Cliente Supabase que actúa como el usuario del JWT (RLS). */
export function createUserScopedSupabase(
  url: string,
  anonKey: string,
  accessToken: string,
) {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * Texto a fusionar con las instrucciones de Terra en /api/chat.
 * No sustituye al documento: solo refuerza preferencias del operador.
 */
export async function fetchLearningBlockForTerraPrompt(
  url: string,
  anonKey: string,
  accessToken: string,
  opts?: { maxNotes?: number; maxChars?: number },
): Promise<string> {
  const maxNotes = opts?.maxNotes ?? 40;
  const maxChars = opts?.maxChars ?? 14_000;
  const sb = createUserScopedSupabase(url, anonKey, accessToken);
  const { data, error } = await sb
    .from(TERRA_LEARNING_TABLE)
    .select("body")
    .order("created_at", { ascending: false })
    .limit(maxNotes);

  if (error) {
    console.warn("[gemini_learning_notes]", error.message);
    return "";
  }

  const bodies = (data ?? [])
    .map((r: { body?: string }) => String(r.body ?? "").trim())
    .filter(Boolean);
  if (bodies.length === 0) return "";

  let out =
    "Aprendizajes y reglas guardadas por el usuario (memoria persistente). " +
    "Aplícalas cuando encajen con el documento o la tabla; no contradigas cantidades o textos explícitos en el archivo:\n";
  let used = out.length;
  for (const b of bodies) {
    const line = `- ${b.replace(/\s+/g, " ").slice(0, 480)}`;
    if (used + line.length + 1 > maxChars) break;
    out += `\n${line}`;
    used += line.length + 1;
  }
  return out;
}

export async function listTerraLearningNotes(): Promise<TerraLearningNote[]> {
  const { data, error } = await supabase
    .from(TERRA_LEARNING_TABLE)
    .select("id, body, created_at")
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) throw error;
  return (data ?? []) as TerraLearningNote[];
}

export async function insertTerraLearningNote(
  body: string,
): Promise<{ id: string }> {
  const trimmed = String(body ?? "").trim().slice(0, 2000);
  if (!trimmed) throw new Error("empty_body");

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) throw new Error("no_session");

  const { data, error } = await supabase
    .from(TERRA_LEARNING_TABLE)
    .insert({
      user_id: user.id,
      body: trimmed,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: String(data.id) };
}

export async function deleteTerraLearningNote(id: string): Promise<void> {
  const { error } = await supabase
    .from(TERRA_LEARNING_TABLE)
    .delete()
    .eq("id", id);
  if (error) throw error;
}

/** Regla corta al marcar una extracción como correcta. */
export function buildOkLearningNote(input: {
  orderNumero?: string | null;
  proveedor?: string | null;
  cliente?: string | null;
  lineCount: number;
}): string {
  const or = String(input.orderNumero ?? "").trim() || "(sin número)";
  const prov = String(input.proveedor ?? "").trim() || "(sin proveedor)";
  const cli = String(input.cliente ?? "").trim() || "(sin cliente)";
  const date = new Date().toISOString().slice(0, 10);
  return (
    `Extracción Terra verificada OK (${date}) OR #${or}. ` +
    `Proveedor: ${prov}. Cliente: ${cli}. ` +
    `${input.lineCount} fila(s). Conservar el mismo criterio de columnas, ` +
    `reempaques y totales en facturas similares de este proveedor.`
  ).slice(0, 2000);
}
