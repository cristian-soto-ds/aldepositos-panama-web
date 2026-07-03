import { prepareGeminiAttachment } from "@/lib/geminiClientAttachment";
import { postCollectionOrderGemini } from "@/lib/geminiCollectionOrderApi";
import { supabase } from "@/lib/supabase";

/**
 * Prompt del botón «Leer documento»: extrae ÚNICAMENTE referencias y bultos.
 * El resto (medidas, peso por bulto, etc.) lo captura el inventariador en el RA.
 */
export const EXTRACT_REFERENCIAS_BULTOS_PROMPT =
  "Lee con cuidado el documento adjunto y extrae ÚNICAMENTE dos datos por fila: " +
  "la referencia (puede ser código, SKU, modelo, estilo, artículo, etc.) y la cantidad de bultos. " +
  "Coloca cada referencia en el campo Referencia y su cantidad de bultos en el campo Bultos. " +
  "NO completes descripción, unidades, peso, medidas, género ni ningún otro campo. " +
  "Genera una fila por cada referencia. " +
  "Si el documento no indica los bultos de una referencia, deja los bultos vacíos en vez de " +
  "inventar un número. No inventes referencias que no aparezcan en el documento.";

export type ExtractedRefLine = { referencia: string; bultos: string };

type GeminiLineLike = { referencia?: unknown; bultos?: unknown };

/**
 * Lee un documento (PDF/imagen) con Alde.IA y devuelve solo referencias y bultos.
 * Lanza Error con mensaje claro si falla la sesión o la respuesta.
 */
export async function extractReferenciasBultosFromFile(
  file: File,
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
  return rawLines
    .map((l) => ({
      referencia: String(l.referencia ?? "").trim(),
      bultos: String(l.bultos ?? "").trim(),
    }))
    .filter((l) => l.referencia || l.bultos);
}
