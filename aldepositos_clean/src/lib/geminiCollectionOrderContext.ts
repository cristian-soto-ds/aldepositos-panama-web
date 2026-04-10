import type { User } from "@supabase/supabase-js";
import { AI_ASSISTANT_DISPLAY_NAME } from "@/lib/aiAssistantBrand";
import { ALDEPOSITOS_PANEL_KNOWLEDGE } from "@/lib/aldepositosAssistantKnowledge";

export function sanitizeViewerDisplayNameHint(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim().replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 120);
  return t || undefined;
}

/** Nombre legible desde JWT; si no hay metadata, parte local del correo. */
export function displayNameFromSessionUser(user: User): string {
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  for (const key of ["full_name", "name", "nombre_completo"] as const) {
    const v = meta?.[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const email = user.email?.trim();
  if (email) {
    const local = email.split("@")[0]?.trim();
    if (local) return local;
    return email;
  }
  return "operador";
}

export function buildCollectionOrderSystemInstruction(params: {
  assistantDisplayName?: string;
  preferredName: string;
  email: string | undefined;
}): string {
  const bot =
    (params.assistantDisplayName ?? AI_ASSISTANT_DISPLAY_NAME).trim() ||
    AI_ASSISTANT_DISPLAY_NAME;
  const emailRule = params.email
    ? `- Correo verificado de la sesión (no lo repitas salvo que el usuario lo pida): ${params.email}.`
    : "";

  return `Eres ${bot}, el asistente de IA de ALDEPOSITOS en el panel web (módulo orden de recolección). En mensajes breves puedes identificarte como ${bot} cuando encaje.

Funciones:
1) Extraer líneas de documentos (packing list, factura, foto de etiqueta, texto pegado): responde en JSON con "reply" y "lines" según el esquema.
2) Ayudar con el uso del panel: usa únicamente el bloque "Conocimiento del panel" abajo; si no está ahí, dilo con claridad.

Reglas generales:
- Español.
- Trata con respeto al usuario; puedes dirigirte por su nombre (${params.preferredName}) cuando sea natural.
${emailRule ? `${emailRule}\n` : ""}- Medidas L, W, H en cm por defecto; pulgadas → cm (1 in = 2,54 cm) o indícalo en reply.
- Peso en kg. Unidades siempre en piezas (1 docena = 12 unidades). Rellena unidadesPorBulto, unidadesTotales, pesoPorBulto o pesoTotalKg según lo que diga el documento. Si hay bultos y peso por bulto, calcula y rellena también pesoTotalKg (bultos × peso por bulto). Si el documento solo trae peso total de línea, usa pesoTotalKg y bultos; no inventes cifras.
- referencia = SKU / código tal como aparece. No inventes datos.
- Pregunta solo sobre la app: reply útil y "lines": [].
- Sin tabla clara en el archivo: "lines": [] y explica en reply.

--- Usuario en esta sesión ---
Nombre para dirigirte: ${params.preferredName}

--- Conocimiento del panel ALDEPOSITOS ---
${ALDEPOSITOS_PANEL_KNOWLEDGE}
`;
}
