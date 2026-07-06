import { prepareGeminiAttachment } from "@/lib/geminiClientAttachment";
import { postCollectionOrderGemini } from "@/lib/geminiCollectionOrderApi";
import type { CollectionGeminiLine } from "@/lib/collectionOrderGeminiSchema";
import {
  EXTRACT_REFERENCIAS_BULTOS_PROMPT,
  toRefsBultosOnlyLines,
} from "@/lib/geminiRefsBultosMode";
import { supabase } from "@/lib/supabase";

export { EXTRACT_REFERENCIAS_BULTOS_PROMPT };

export type ExtractedRefLine = { referencia: string; bultos: string };

type GeminiLineLike = { referencia?: unknown; bultos?: unknown };

/**
 * Lee un documento (PDF/imagen) con Alde.IA — mismo motor que el chat general
 * (texto PDF, páginas en orden, fragmentos largos) — y devuelve solo referencias y bultos.
 */
export async function extractReferenciasBultosFromFile(
  file: File,
  opts?: { viewerDisplayName?: string | null },
): Promise<ExtractedRefLine[]> {
  const attachment = await prepareGeminiAttachment(
    file,
    file.type || "application/octet-stream",
  );

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error("Sesión expirada. Vuelve a iniciar sesión.");
  }

  const res = await postCollectionOrderGemini(token, {
    message: EXTRACT_REFERENCIAS_BULTOS_PROMPT,
    history: [{ role: "user", text: EXTRACT_REFERENCIAS_BULTOS_PROMPT }],
    attachment,
    extractMode: "refsBultosOnly",
    viewerDisplayName: opts?.viewerDisplayName?.trim() || undefined,
  });

  let data: { error?: string; lines?: GeminiLineLike[] };
  try {
    const ct = res.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("application/json")) {
      throw new Error("non_json");
    }
    data = (await res.json()) as typeof data;
  } catch {
    throw new Error(
      res.status === 504
        ? "Se agotó el tiempo de espera. Prueba con un documento más liviano."
        : `Error ${res.status}. Reintenta en unos segundos.`,
    );
  }

  if (!res.ok) {
    throw new Error(data.error || `Error ${res.status}`);
  }

  const rawLines = Array.isArray(data.lines) ? data.lines : [];
  const asGeminiLines: CollectionGeminiLine[] = rawLines.map((l) => ({
    referencia: String(l.referencia ?? "").trim(),
    bultos: String(l.bultos ?? "").trim(),
  }));
  return toRefsBultosOnlyLines(asGeminiLines).map((l) => ({
    referencia: l.referencia ?? "",
    bultos: l.bultos ?? "",
  }));
}
