import type { CollectionGeminiLine } from "@/lib/collectionOrderGeminiSchema";
import { JEANCENTER_CODIGO_HINT } from "@/lib/geminiFacturaHints";

/** Prompt compartido: botón «Leer documento» (orden de recolección e ingreso rápido). */
export const EXTRACT_REFERENCIAS_BULTOS_PROMPT =
  "Lee con cuidado el documento adjunto y extrae ÚNICAMENTE dos datos por fila: " +
  "la referencia (puede ser código, SKU, modelo, estilo, artículo, etc.) y la cantidad de bultos. " +
  "Coloca cada referencia en el campo Referencia y su cantidad de bultos en el campo Bultos. " +
  "NO completes descripción, unidades, peso, medidas, género ni ningún otro campo: esos los " +
  "completará después el inventariador en el RA. Genera una fila por cada referencia. " +
  "Si el documento tiene varias páginas, respeta el orden de las páginas (1, luego 2, luego 3…) " +
  "y dentro de cada página el orden de la tabla de arriba hacia abajo. " +
  "Si el documento no indica los bultos de una referencia, deja los bultos vacíos en vez de " +
  "inventar un número. No inventes referencias que no aparezcan en el documento.";

export const REFS_BULTOS_CHUNK_HINT = `Modo «Leer documento» (solo referencias y bultos):
- UNA fila JSON por cada línea de producto con código/referencia/SKU/Codigo visible.
- Solo completa referencia y bultos; deja vacíos descripción, unidades, peso, medidas y demás campos.
- Columna «Codigo», «Referencia», «No. Bulto» o «Bultos» → referencia y/o bultos según corresponda.
- Respeta el orden de página (1, 2, 3…) y el orden de la tabla de arriba hacia abajo.
- NO omitas filas por brevedad. Incluye TODAS las referencias visibles en este fragmento/página, incluidas las últimas antes del pie.
- Ignora filas SUBTOTAL, TOTAL, GASTOS o resúmenes sin referencia de producto.
${JEANCENTER_CODIGO_HINT}`;

export type GeminiExtractMode = "full" | "refsBultosOnly";

export function isRefsBultosExtractMode(
  mode: GeminiExtractMode | undefined,
): boolean {
  return mode === "refsBultosOnly";
}

/** Deja solo referencia y bultos (resto vacío) para ingreso rápido / lectura de documento. */
export function toRefsBultosOnlyLines(
  lines: CollectionGeminiLine[],
): CollectionGeminiLine[] {
  return lines
    .map((l) => ({
      referencia: String(l.referencia ?? "").trim(),
      bultos: String(l.bultos ?? "").trim(),
    }))
    .filter((l) => l.referencia || l.bultos);
}
