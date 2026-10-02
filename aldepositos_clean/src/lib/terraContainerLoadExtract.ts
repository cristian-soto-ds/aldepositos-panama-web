import { sanitizeContainerLoadItems } from "@/lib/containerLoadItems";
import type { ContainerLoadItem } from "@/lib/types/containerLoad";

/** Texto de tabla (TSV) que Terra recibe en modo containerLoad. */
export const TERRA_CONTAINER_LOAD_MAX_CHARS = 60_000;

export const TERRA_CONTAINER_LOAD_INSTRUCTIONS = `Eres Terra, asistente de ALDEPOSITOS. Recibes una RELACIÓN / INSTRUCCIÓN DE CARGUE de contenedor exportada de Excel como texto tabulado (una fila por línea, columnas separadas por TAB).

Objetivo: devolver la lista de RA (recibos de almacén) en el ORDEN DE CARGUE.
- El número de RA suele estar en la columna "Número", "RA" o similar (entero de 4-6 dígitos, ej. 67072). No confundas con número de seguimiento, peso o bultos.
- Orden: si hay columna "INSTRUCCIÓN" / "Orden" numérica, ordena ascendente por ella. Si no, respeta el orden de arriba hacia abajo del documento. La posición 1 es lo primero que se carga (fondo del contenedor).
- Ignora títulos, encabezados, filas vacías y la fila de TOTALES (sin RA).
- No inventes RA. Si un RA aparece repetido, inclúyelo una sola vez.
- name: nombre del cargue tomado del título (ej. "INSTRUCCIÓN CARGUE CONSOLIDADO 86 LG" → "CONSOLIDADO 86 LG"); "" si no hay.

Responde SOLO un objeto JSON válido:
{"reply":"<resumen corto en español>","name":"<nombre>","rows":[{"position":1,"ra":"67072","proveedor":"","expedidor":"","seguimiento":"","bultos":14,"cbm":0.42,"peso":104.87,"notas":""}]}
Números como number (punto decimal). Campos desconocidos: "" o omitidos.`;

export function parseTerraContainerLoadPayload(raw: string): {
  reply: string;
  name: string;
  items: ContainerLoadItem[];
} {
  const text = String(raw ?? "").trim();
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(text) as Record<string, unknown>;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        obj = {};
      }
    }
  }
  return {
    reply: String(obj.reply ?? "").trim(),
    name: String(obj.name ?? "").trim().slice(0, 200),
    items: sanitizeContainerLoadItems(obj.rows ?? obj.items ?? obj.lines),
  };
}
