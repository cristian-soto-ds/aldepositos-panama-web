import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export const GEMINI_LEARNING_TABLE = "gemini_learning_notes";

export type GeminiLearningNote = {
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
 * Texto a fusionar con `contextHint` en la API de Gemini.
 * No sustituye al documento: solo refuerza preferencias del operador.
 */
export async function fetchLearningBlockForGeminiPrompt(
  url: string,
  anonKey: string,
  accessToken: string,
  opts?: { maxNotes?: number; maxChars?: number },
): Promise<string> {
  const maxNotes = opts?.maxNotes ?? 40;
  const maxChars = opts?.maxChars ?? 14_000;
  const sb = createUserScopedSupabase(url, anonKey, accessToken);
  const { data, error } = await sb
    .from(GEMINI_LEARNING_TABLE)
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

export async function listGeminiLearningNotes(): Promise<GeminiLearningNote[]> {
  const { data, error } = await supabase
    .from(GEMINI_LEARNING_TABLE)
    .select("id, body, created_at")
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) throw error;
  return (data ?? []) as GeminiLearningNote[];
}

export async function insertGeminiLearningNote(body: string): Promise<void> {
  const trimmed = String(body ?? "").trim().slice(0, 2000);
  if (!trimmed) throw new Error("empty_body");

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) throw new Error("no_session");

  const { error } = await supabase.from(GEMINI_LEARNING_TABLE).insert({
    user_id: user.id,
    body: trimmed,
  });
  if (error) throw error;
}

export async function deleteGeminiLearningNote(id: string): Promise<void> {
  const { error } = await supabase.from(GEMINI_LEARNING_TABLE).delete().eq("id", id);
  if (error) throw error;
}
