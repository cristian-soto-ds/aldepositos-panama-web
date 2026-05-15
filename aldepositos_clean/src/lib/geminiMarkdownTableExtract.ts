import type { CollectionGeminiLine } from "@/lib/collectionOrderGeminiSchema";

/** Último recurso: el modelo responde como en Gemini web (solo tabla markdown). */
export const MARKDOWN_TABLE_EXTRACTION_PROMPT = `El formato JSON falló. Hacé lo mismo que en un chat normal de Gemini:

Respondé **solo** con una tabla markdown (GitHub), sin texto antes ni después, sin bloques de código markdown.

Encabezados de la **primera fila** (exactamente, en minúsculas):
| referencia | descripcion | bultos | unidadesporbulto | unidadestotales | pesoporculo | pesototalkg | l | w | h |

Reglas:
- **referencia**: código/SKU (columna CODIGO, código, ref…).
- **descripcion**: nombre del artículo; sin saltos de línea (reemplazá por espacio).
- **bultos**: si el documento no separa bultos, dejá vacío o "1".
- **unidadesporbulto**: vacío si no aplica.
- **unidadestotales**: cantidad en **piezas** por línea (ej. columna CANT, cantidad, qty). Número entero sin separador de miles.
- **pesoporculo**, **pesototalkg**, **l**, **w**, **h**: vacíos si no hay dato.
- Una fila de datos por producto del documento. No incluyas filas de totales generales del pie de factura.
- Evitá el carácter | dentro del texto de las celdas.`;

function stripCodeFences(s: string): string {
  let t = s.trim();
  const fence = /^```(?:markdown|md)?\s*\n?([\s\S]*?)\n?```$/im.exec(t);
  if (fence) return fence[1]?.trim() ?? t;
  if (t.startsWith("```")) {
    t = t.replace(/^```[^\n]*\n?/, "");
    const end = t.lastIndexOf("```");
    if (end !== -1) t = t.slice(0, end);
  }
  return t.trim();
}

function splitPipeRow(line: string): string[] {
  const parts = line.split("|").map((c) => c.trim());
  if (parts.length && parts[0] === "") parts.shift();
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function isSeparatorRow(cells: string[]): boolean {
  if (cells.length === 0) return true;
  return cells.every((c) => /^[\s:-]+$/.test(c) || c.replace(/-/g, "").trim() === "");
}

function normalizeHeaderKey(cell: string): string {
  return cell
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Mapea encabezados típicos (factura, packing, Excel) a campos del esquema. */
function headerToField(norm: string): keyof CollectionGeminiLine | null {
  const skip = new Set([
    "precio",
    "preciounitario",
    "preciounit",
    "total",
    "importe",
    "subtotal",
    "iva",
    "descuento",
  ]);
  if (skip.has(norm)) return null;

  const map: Record<string, keyof CollectionGeminiLine> = {
    referencia: "referencia",
    codigo: "referencia",
    sku: "referencia",
    item: "referencia",
    ref: "referencia",
    descripcion: "descripcion",
    descripcin: "descripcion",
    producto: "descripcion",
    articulo: "descripcion",
    bultos: "bultos",
    cajas: "bultos",
    undbulto: "unidadesPorBulto",
    unidadesporbulto: "unidadesPorBulto",
    piezasporbulto: "unidadesPorBulto",
    unidadestotales: "unidadesTotales",
    cantidad: "unidadesTotales",
    cant: "unidadesTotales",
    qty: "unidadesTotales",
    piezas: "unidadesTotales",
    totalund: "unidadesTotales",
    pesoporculo: "pesoPorBulto",
    pesoporcul: "pesoPorBulto",
    pesopieza: "pesoUnaPiezaKg",
    pesounapieza: "pesoUnaPiezaKg",
    pesototalkg: "pesoTotalKg",
    pesototal: "pesoTotalKg",
    largo: "l",
    ancho: "w",
    alto: "h",
    largocm: "l",
    anchocm: "w",
    altocm: "h",
    l: "l",
    w: "w",
    h: "h",
    modelo: "modelo",
    pais: "paisOrigen",
    paisorigen: "paisOrigen",
    tejido: "tejido",
    talla: "talla",
    forro: "forro",
    genero: "genero",
    composicion: "composicion",
  };
  return map[norm] ?? null;
}

/** Convierte "2.502,40" / "312,00" / "200" a string numérico razonable para la app. */
export function normalizeNumericCell(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  let s = t.replace(/\s/g, "");
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return t;
  if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n));
  return String(n);
}

/**
 * Intenta extraer filas desde una respuesta tipo Gemini web (tabla markdown).
 */
export function tryParseMarkdownTableToLines(raw: string): CollectionGeminiLine[] {
  const text = stripCodeFences(String(raw ?? ""));
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  const rows: string[][] = [];
  for (const line of lines) {
    if (!line.includes("|")) continue;
    const cells = splitPipeRow(line);
    if (cells.length < 2) continue;
    if (isSeparatorRow(cells)) continue;
    rows.push(cells);
  }

  if (rows.length < 2) return [];

  const headerCells = rows[0].map((c) => normalizeHeaderKey(c));
  const fieldIndexes: (keyof CollectionGeminiLine | null)[] = headerCells.map((h) =>
    h ? headerToField(h) : null,
  );

  /** Si no reconocimos encabezados, asumimos: código | descripción | cant | … */
  const fallbackOrder: (keyof CollectionGeminiLine)[] = [
    "referencia",
    "descripcion",
    "unidadesTotales",
    "bultos",
  ];

  const out: CollectionGeminiLine[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => !String(c).trim())) continue;

    const row: CollectionGeminiLine = {};
    let any = false;

    const hasMappedHeader = fieldIndexes.some((x) => x != null);
    if (hasMappedHeader) {
      for (let i = 0; i < cells.length && i < fieldIndexes.length; i++) {
        const f = fieldIndexes[i];
        if (!f) continue;
        let v = String(cells[i] ?? "").trim();
        if (
          f === "unidadesTotales" ||
          f === "bultos" ||
          f === "unidadesPorBulto" ||
          f === "pesoPorBulto" ||
          f === "pesoUnaPiezaKg" ||
          f === "pesoTotalKg" ||
          f === "l" ||
          f === "w" ||
          f === "h" ||
          f === "volumenM3"
        ) {
          v = normalizeNumericCell(v);
        }
        if (v) {
          row[f] = v;
          any = true;
        }
      }
    } else {
      for (let i = 0; i < Math.min(cells.length, fallbackOrder.length); i++) {
        const f = fallbackOrder[i];
        let v = String(cells[i] ?? "").trim();
        if (f === "unidadesTotales" || f === "bultos") v = normalizeNumericCell(v);
        if (v) {
          row[f] = v;
          any = true;
        }
      }
    }

    if (any && (row.referencia || row.descripcion)) out.push(row);
  }

  return out;
}
