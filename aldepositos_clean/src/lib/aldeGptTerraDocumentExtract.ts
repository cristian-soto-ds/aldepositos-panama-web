/**
 * Extracción documental AldeGpt Terra → líneas de orden de recolección.
 * Prompt de negocio + post-proceso (docenas, JEANS, reempaque, Magaya).
 */

import { parseDozensToUnits } from "@/lib/collectionOrderUnitNormalization";
import type { ImportLineInput } from "@/lib/collectionOrderUnitNormalization";
import { ALDEGPT_TERRA_DISPLAY_NAME } from "@/lib/aldeGptTerraBrand";
import { MAGAYA_KNOWN_CODE_TABLES } from "@/lib/magayaCodeTables";
import {
  formatWeightPrecise,
  preserveDocumentNumber,
} from "@/lib/measureDecimals";

const DOZEN = 12;

export type AldeGptTerraLine = {
  referencia?: string;
  descripcion?: string;
  bultos?: string;
  unidadesPorBulto?: string;
  unidadesTotales?: string;
  pesoPorBulto?: string;
  pesoTotalKg?: string;
  reempaque?: boolean;
  /** Columna MODELO Magaya (marca/modelo). */
  modelo?: string;
  paisOrigen?: string;
  tejido?: string;
  talla?: string;
  genero?: string;
  composicion?: string;
};

/**
 * Clave para fusionar filas al aplicar a la OR.
 * Incluye descripción: en Magaya varias refs se ven truncadas igual
 * (BOLSO-CAMBRID…) pero son productos distintos (DENIM vs YUTE).
 */
export function collectionLineDedupeKey(
  referencia?: string | null,
  descripcion?: string | null,
): string {
  const ref = String(referencia ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  const desc = String(descripcion ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!ref && !desc) return "";
  if (!desc) return ref;
  if (!ref) return `::${desc}`;
  return `${ref}::${desc}`;
}

/**
 * Modo rápido: solo referencia + bultos + reempaque (para pedidos que no
 * necesitan descripción, pesos ni Magaya en este paso).
 */
export const ALDEGPT_TERRA_REFS_BULTOS_PROMPT =
  "Lee el documento adjunto (TODAS las páginas) y extrae ÚNICAMENTE por cada fila de producto: " +
  "referencia (código/SKU/artículo), bultos y si es reempaque. " +
  "NO completes descripción, unidades, peso, medidas ni campos Magaya. " +
  "COMPLETITUD: una fila JSON por CADA producto de la tabla hasta el último #LN (si hay 50+, devuelve 50+). " +
  "No omitas filas intermedias ni te detengas a mitad. Si la ref se ve cortada, distingue productos por descripción. " +
  "Si Total Bultos/Bts ≥ 1 → bultos=ese número y reempaque=false. " +
  "Si Bts vacío / # BLTO vacío y la misma referencia se repite (packing list bodega) → bultos=\"0\" y reempaque=true. " +
  "Si Total Bultos = 0 (o vacío sin caja propia) → bultos=\"0\" y reempaque=true. " +
  "EMPAQUE del documento NO implica reempaque por sí solo. No inventes referencias.";

export const ALDEGPT_TERRA_REFS_BULTOS_INSTRUCTIONS = `Eres ${ALDEGPT_TERRA_DISPLAY_NAME}, asistente de ALDEPOSITOS. Modo «solo referencias y bultos»: el usuario solo necesita códigos, cantidades de bultos y marcas de reempaque para la orden de recolección.

Responde SIEMPRE con un único JSON válido:
{
  "reply": "resumen breve en español (1–4 frases)",
  "lines": [ { "referencia": "...", "bultos": "...", "reempaque": false } ]
}

Cada objeto en "lines" usa SOLO estas claves:
- referencia (string)
- bultos (string; cantidad de cajas/bultos)
- reempaque (boolean)

=== REGLAS ===
1) REFERENCIA: código/SKU/Codigo/Item/Style/Part Number. Una fila por CADA producto de la tabla. No inventes.
   COMPLETITUD OBLIGATORIA: si el packing tiene 50 productos, "lines" debe tener 50 objetos. NUNCA omitas una fila intermedia ni te cortes a mitad.
   Total Bultos=0 / Bts vacío / misma ref repetida sin # BLTO también cuenta (reempaque=true): EXTRÁELA igual.
   Si la columna Referencia se ve cortada (ej. BOLSO-CAMBRID), completa el código con la descripción
   (BOLSO CAMBRIDGE DENIM CANVAS vs BOLSO CAMBRIDGE YUTE → dos referencias distintas, no una sola).
2) BULTOS: columna «Total Bultos», «Bultos», «Bts», «Cajas». «# BLTO» es rango (1-5), NO uses ese rango como cantidad.
   Si Pack Code=BOX/CTN/CARTON, Issued Qty = bultos (cajas). No uses «Bulto No.» ni EMPAQUE como cantidad.
3) REEMPAQUE:
   - Total Bultos/Bts ≥ 1 y/o Peso Bruto > 0 → bultos≥1, reempaque=false SIEMPRE (ej. Total Bultos=1 peso=21.25).
   - Pack Code BOX/CTN + Issued Qty > 0 → bultos=Issued Qty, reempaque=false.
   - Packing list bodega: misma referencia repetida con # BLTO vacío y Bts vacío → bultos="0", reempaque=true (OBLIGATORIA).
   - Total Bultos Magaya = 0 y peso 0 → bultos="0", reempaque=true. ESTAS FILAS SON OBLIGATORIAS (no las saltes).
   - EMPAQUE del PDF ≠ reempaque.
4) Deja vacíos / no envíes descripción, unidades, peso, Magaya ni otros campos.
5) Respeta orden de páginas (1, 2, 3…) y de la tabla de arriba hacia abajo. Lee TODAS las páginas.
6) Ignora SUBTOTAL / TOTAL / GASTOS sin código de producto.
7) Si no hay documento usable: "lines": [] y explícalo en reply.
8) Si el mensaje dice «Documento K de N»: extrae SOLO ese documento. El pedido completo se arma concatenando K=1…N en ese orden.`;

/** Deja solo referencia, bultos y reempaque. */
export function toRefsBultosOnlyTerraLines(
  lines: AldeGptTerraLine[],
): AldeGptTerraLine[] {
  return lines
    .map((l) => {
      const referencia = String(l.referencia ?? "").trim();
      let bultos = String(l.bultos ?? "").trim();
      const bultosNum = Math.round(
        parseFloat(bultos.replace(",", ".")) || 0,
      );
      // Si tiene bultos > 0 NUNCA es reempaque.
      let reempaque = l.reempaque === true;
      if (bultosNum > 0) {
        reempaque = false;
        bultos = String(bultosNum);
      } else if (reempaque) {
        bultos = "0";
      }
      return { referencia, bultos, reempaque };
    })
    .filter((l) => l.referencia || l.bultos || l.reempaque);
}

export const ALDEGPT_TERRA_DOCUMENT_INSTRUCTIONS = `Eres ${ALDEGPT_TERRA_DISPLAY_NAME}, asistente de ALDEPOSITOS. Cuando el usuario adjunta un packing list, factura u otro documento de mercancía, EXTRAES filas de producto para la orden de recolección y el Excel Magaya.

Responde SIEMPRE con un único JSON válido:
{
  "reply": "resumen breve en español (2–6 frases)",
  "lines": [ { ...fila... } ]
}

Cada objeto en "lines" usa SOLO estas claves (strings; "" si no aplica; reempaque es boolean):
- referencia
- descripcion
- bultos
- unidadesPorBulto
- unidadesTotales
- cantidadFactura (opcional: valor EXACTO de columna cantidad+DOC, ej. "8.00 DOC", "6.06 DOC"; la app convierte a piezas y reparte)
- pesoPorBulto
- pesoTotalKg
- reempaque
- modelo
- paisOrigen
- tejido
- talla
- genero
- composicion
- packCode (opcional: BOX, CTN, CARTON…)
- issuedQty (opcional: Issued Qty / qty de cajas cuando Pack=BOX)

=== VARIOS DOCUMENTOS (mismo pedido) ===
Si el mensaje indica «Documento K de N»: es UN solo pedido partido en varios PDFs/imágenes.
- Extrae SOLO las filas de ESE documento (no inventes del resto).
- Respeta el orden de páginas y de la tabla (arriba → abajo).

=== REGLAS DE EXTRACCIÓN (obligatorias) ===

1) REFERENCIA
Identifica el código de producto aunque la columna se llame: Referencia, Codigo, ProductCode, Item, SKU, artículo, número de parte, Style, Part Number, etc.
Una fila JSON por CADA producto/código de la tabla. No inventes referencias.
COMPLETITUD OBLIGATORIA:
- Cuenta las filas de producto del documento (excluye SUBTOTAL/TOTAL/GASTOS) y genera exactamente ese número de objetos en "lines".
- Lee TODAS las páginas del PDF/imagen. Si hay 50+ referencias en 2–3 páginas, "lines" debe tener 50+ objetos. NUNCA cortes en la fila 40–48 dejando el resto.
- NUNCA omitas una fila intermedia. Ejemplo: si hay BACCI CANVAS, luego CAMBRIDGE DENIM CANVAS (Total Bultos=0), luego CAMBRIDGE YUTE (Total Bultos=0) → DEBES devolver las 3.
- Total Bultos=0 / Bts vacío / # BLTO vacío con la misma referencia repetida = reempaque: extráelo SIEMPRE como fila aparte.
- Si la columna Referencia se ve truncada en el PDF (BOLSO-CAMBRID…), usa el texto completo del documento y/o la descripción para distinguir
  (DENIM CANVAS ≠ YUTE → dos líneas con referencias distintas, p. ej. …DENIM… y …YUTE…).
- En "reply" indica cuántas filas extrajiste y el último #LN o referencia (para verificar completitud).

2) DESCRIPCIÓN
Usa la descripción del producto asociada a esa referencia.
Normalización JEANS (obligatoria):
- Si dice JEANS (pantalón) y NO bermuda → exactamente "PANTALON JEANS". NADA más: sin SKINNY, PREMIUM, WIDE LEG, PALAZZO, STRAIGHT, color, etc.
- Si dice JEANS BERMUDA / BERMUDA JEANS → exactamente "BERMUDA".
NUNCA pongas medidas (cm, m, 10x20x30, etc.) en descripcion.
NUNCA pongas género (dama/caballero) en descripcion: va en "genero".
Si no es jeans, deja la descripción del documento sin inventar datos.

3) BULTOS (tipos de documento)
FIDELIDAD: el número de bultos debe ser EXACTAMENTE el de la columna «bultos» / «Bts» / «Total Bultos» del documento. No lo cambies.
En facturas con columna «cantidad» en DOC/docenas: eso NO son bultos (va a unidades). Los bultos son la columna «bultos»/«Bts».
A) Packing Magaya — la columna «Total Bultos» MANDA (no «Bulto No.», no EMPAQUE):
   - REGLA DE ORO: si Total Bultos ≥ 1 → reempaque=false SIEMPRE. Nunca marques reempaque una fila que tenga bultos.
   - Total Bultos ≥ 1 y/o Peso Bruto > 0 → bultos=ese número (o 1 si solo hay peso), reempaque=false.
     Ejemplo OBLIGATORIO: Total Bultos=1, Peso=21.25, Ref GREY-BAG-BACCI → bultos="1", reempaque=false, pesoTotalKg="21.25", und="12".
   - Solo Total Bultos = 0 y Peso = 0 → bultos="0", reempaque=true (filas dentro del mismo cartón).
     Conserva piezas: "1/0 DOC" → unidadesPorBulto="12" y unidadesTotales="12".
     OBLIGATORIO extraerlas: no las saltes aunque Bulto No. esté vacío ("/").
   - EMPAQUE del PDF ≠ reempaque.
B) Recibo GLF / almacén (Pack Code BOX/CTN + Issued Qty):
   - Issued Qty con Pack=BOX → bultos=Issued Qty, reempaque=false.
   - No uses Issued Qty como piezas si Pack=BOX.
C) Factura comercial (columnas peso + bultos + cantidad DOC):
   - bultos = columna «bultos» exacta (ej. 12, 13).
   - peso → pesoTotalKg exacto (ej. 538.08).
   - cantidad DOC → unidades (docenas→piezas), NUNCA a bultos.
D) PACKING LIST BODEGA (columnas #LN, # BLTO, Referencia, Bts, Empaque, Cant. Pedida, Unidad DOC/PCS) — OBLIGATORIO:
   - Extrae TODAS las filas de producto de TODAS las páginas (si el #LN llega a 50, 60, 80… debes devolver ese mismo número de líneas). NUNCA te detengas a mitad (p. ej. solo hasta 48).
   - «Bts» = bultos de la fila. «# BLTO» es rango de bultos (1-5), NO es la cantidad de bultos.
   - REEMPAQUE (muy frecuente): la MISMA referencia se repite en la fila siguiente con #LN vacío o sin # BLTO, Bts vacío/en blanco, y Cant. Pedida en PCS (o DOC).
     → Esa segunda fila ES OBLIGATORIA: bultos="0", reempaque=true. Conserva Cant. Pedida como piezas (PCS→piezas; DOC→×12).
     Ejemplo OBLIGATORIO:
       Fila: ref 11-G331, # BLTO 46-47, Bts=2, Cant=9 DOC → bultos="2", reempaque=false, tot und=108 (o und según regla DOC).
       Fila siguiente: ref 11-G331, # BLTO vacío, Bts vacío, Cant=6 PCS → bultos="0", reempaque=true, unidadesTotales="6", unidadesPorBulto="6".
     Igual para 11-G337, 11-G309, etc. NUNCA omitas la fila de reempaque ni la fusiones con la anterior.
   - Filas normales con Bts≥1 → reempaque=false.

4) Und/bulto y Tot und (OBLIGATORIO — piezas enteras, NUNCA decimales en und/bulto)
1 docena = 12 piezas SIEMPRE.
En facturas (columna «cantidad» + u/m DOC + columna «bultos»): la cantidad DOC es el TOTAL de la LÍNEA (no por bulto).
1) Convierte cantidad → piezas TOTALES (Tot und).
2) Und/bulto = Tot und ÷ bultos (entero). NUNCA pongas el total de la línea en Und/bulto ni multipliques otra vez por bultos.
Ejemplos OBLIGATORIOS:
- 2 bultos, «8 DOC» / «8.00 DOC» → tot=8×12=96 → und/bulto=96÷2=48. NUNCA und=96 ni tot=192.
- 2 bultos, «6.06 DOC» → (6×12)+6=78 piezas (el decimal .06 = 6 sueltas, NO 6.06×12) → und/bulto=78÷2=39. NUNCA und=72 ni tot=144.
- 2 bultos, «4 DOC» → tot=48 → und/bulto=24.
- 12 bultos, «4 DOC» → tot=48 → und/bulto=4.
Notación con sueltas (total de línea): «4.4», «4/4», «4(4)», «4 / 4 DOC», «6.06 DOC» =
  · parte entera = docenas → ×12
  · dígitos tras punto / slash / paréntesis = piezas sueltas (enteros; «.06»→6, «.4»→4)
  · Tot und = docenas×12 + sueltas; Und/bulto = Tot ÷ bultos si divide exacto.
  Ej. 2 bultos + «4.4» → tot=52 → und=26.
«1/0 DOC» (reempaque, bultos=0) → und="12", tot="12".
Si Tot ÷ bultos no es entero → unidadesTotales=tot EXACTO de factura y unidadesPorBulto="48"
  (regla operativa: no uses decimales ni redondees el total; ej. 311÷6 → und=48 tot=311; 459÷10 → und=48 tot=459).
NUNCA dejes «4» ni «8.00» sin convertir a piezas.
NUNCA uses la columna cantidad DOC como bultos.

5) Peso (OBLIGATORIO: fidelidad a la factura)
En facturas con columnas «peso» + «bultos»:
- «peso» = PESO TOTAL de la línea en kg → pesoTotalKg con el valor EXACTO del documento (ej. 538.08, 487.73). NUNCA lo redondees ni lo recalcules.
- «bultos» = cantidad EXACTA de bultos del documento. NUNCA la cambies ni la infieras de «cantidad» (docenas).
- pesoPorBulto solo si el doc lo trae por bulto; si solo hay peso total, pon pesoTotalKg y deja que la app derive peso/b.
NUNCA inventes ni «corrijas» peso o bultos. Deben coincidir 1:1 con la factura adjunta.
En packing Magaya: Peso Bruto de la línea → pesoTotalKg exacto.
En reempaque (bultos=0 / peso 0) deja pesos vacíos.

6) Peso tot (pesoTotalKg)
Copia el número del documento sin alterarlo. Volume/CBM del doc NO va en peso.
Si Total Bultos Magaya = 0 y peso = 0, deja pesos vacíos (no inventes).

7) CAMPOS MAGAYA (Excel Magaya) — solo si el documento los trae
- modelo: marca/modelo (MARCA:, MARCAS=, MODELO). Ej. BACCI. Si dice SIN MARCA → "". Resuelve códigos con las tablas abajo.
- paisOrigen: país en español. COO / Country of Origin / ORIGEN: CHINA → "CHINA".
- tejido: tela/material textil solo si aplica (ropa). Equipo electrónico / LiteBeam / antenas / hardware → "" (no inventes).
- talla: solo talla real. Bolso, electrónica, sin talla, "TALLA NO ASIGNADO", N/A → "".
- genero: solo dama/caballero/niño/niña/bebe si el doc lo dice. Bolso/electrónica → "".
- composicion: texto legible si aparece COMPOSICION. Si no → "".
- descripcion: Product Name / Descripcion (ej. LITEBEAM 5AC GEN2).
- paisOrigen: país en español (ORIGEN: CHINA (518) → CHINA). Códigos CH/CN → CHINA.
- tejido: SOLO si el documento tiene un campo/etiqueta explícita «TEJIDO» o «TELA» (ej. TEJIDO: PLANO → "PLANO").
  NUNCA copies palabras de la descripción del producto (CANVAS, DENIM, YUTE en el nombre del bolso NO son tejido).
  NUNCA uses COMPOSICION como tejido (COMPOSICION 100% YUTE / 100% POLIESTER → campo composicion, tejido="").
  Si no hay etiqueta TEJIDO → "".
- talla: solo talla real o rango (12-18). Si dice "TALLA NO ASIGNADO", "sin talla", N/A, o el artículo es bolso/bag sin talla → "" (NO pongas N/A ni "sin talla").
- genero: solo dama, caballero, niño, niña o bebe si el doc lo dice. Bolso/bag u otros sin género → "" (NO pongas 0 ni N/A).
- composicion: texto legible (ej. 100% POLIESTER, 100% YUTE) si aparece COMPOSICION/COMPOSICIÓN.

REGLA VACÍO: si un dato Magaya no está en el documento o no aplica, déjalo "". Nunca inventes ni uses placeholders (N/A, 0, SIN TALLA, NO ASIGNADO).

Ignora filas SUBTOTAL / TOTAL / GASTOS sin código de producto.
No inventes datos ilegibles: deja "".
Si no hay documento o no es packing/factura, "lines": [] y responde en reply.

${MAGAYA_KNOWN_CODE_TABLES}`;

function parseFloatLoose(s: string): number {
  const n = parseFloat(String(s).replace(",", ".").trim());
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Docenas → piezas (total de línea en factura):
 * - «4 DOC» / «4doc» / «4 DOZ» → dozenPcs=48, totalPcs=48
 * - «4.4» | «4/4» | «4(4)» | «6.06 DOC» → dozenPcs = N×12,
 *   totalPcs = N×12 + sueltas (dígitos tras el separador como enteros:
 *   .4→4, .06→6). Und/bulto = totalPcs ÷ bultos lo hace el post-proceso.
 *
 * N.M sin marca DOC solo si las sueltas son 0–11 (resto de docena).
 * Así «48.11» suelto no se interpreta como 48 docenas + 11.
 */
export function parseDozenLooseNotation(
  raw: string,
): { dozenPcs: number; totalPcs: number } | null {
  const original = String(raw ?? "")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!original) return null;

  const hasDoc =
    /\b(doc|docs|doz|dz|dozen|docenas?)\b/i.test(original) ||
    /\d(doc|docs|doz|dz)\b/i.test(original);
  const t = original
    .replace(/\b(doc|docs|doz|dz|dozen|docenas?)\b\.?/gi, "")
    .replace(/(?<=\d)(doc|docs|doz|dz)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;

  let m = /^(\d{1,6})\s*\(\s*(\d{1,5})\s*\)$/.exec(t);
  if (!m) m = /^(\d{1,6})\s*\/\s*(\d{1,5})$/.exec(t);
  // Decimal N.M: con DOC siempre; sin DOC solo sueltas 0–11 (ej. 4.4, no 48.11 “a ciegas”).
  if (!m) {
    const dec = /^(\d{1,6})[.,](\d{1,5})$/.exec(t);
    if (dec) {
      const loosePart = parseInt(dec[2], 10);
      if (
        Number.isFinite(loosePart) &&
        (hasDoc || (loosePart >= 0 && loosePart <= 11 && dec[2].length <= 2))
      ) {
        // Sin DOC: exigir docenas “de packing” (no totales ya en piezas ~48+).
        const dzPart = parseInt(dec[1], 10);
        if (hasDoc || (dzPart >= 0 && dzPart <= 24)) {
          m = dec;
        }
      }
    }
  }
  if (m) {
    const dz = parseInt(m[1], 10);
    const loose = parseInt(m[2], 10);
    if (!Number.isFinite(dz) || !Number.isFinite(loose) || dz < 0 || loose < 0) {
      return null;
    }
    return { dozenPcs: dz * DOZEN, totalPcs: dz * DOZEN + loose };
  }

  // «4 DOC» / «4doc» sin sueltas → 48 piezas (und y tot iguales).
  if (hasDoc) {
    const plain = /^(\d{1,6})([.,]0+)?$/.exec(t);
    if (plain) {
      const dz = parseInt(plain[1], 10);
      if (!Number.isFinite(dz) || dz < 0) return null;
      const pcs = dz * DOZEN;
      return { dozenPcs: pcs, totalPcs: pcs };
    }
  }

  return null;
}

function stripMeasuresFromDescripcion(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  s = s.replace(
    /\b\d+([.,]\d+)?\s*[x×]\s*\d+([.,]\d+)?(\s*[x×]\s*\d+([.,]\d+)?)?\s*(cm|mm|m|in|")?\b/gi,
    " ",
  );
  return s.replace(/\s{2,}/g, " ").trim();
}

/** Normaliza descripción JEANS según reglas de negocio Magaya. */
export function normalizeJeansDescripcion(raw: string): string {
  const stripped = stripMeasuresFromDescripcion(raw);
  if (!stripped) return "";
  const upper = stripped.toUpperCase();
  const isBermuda =
    /\bJEANS\s+BERMUDA\b/.test(upper) ||
    /\bBERMUDA\s+JEANS\b/.test(upper) ||
    (/\bBERMUDA\b/.test(upper) && /\bJEANS?\b/.test(upper));
  if (isBermuda) return "BERMUDA";
  // Cualquier jean/pantalón jeans → solo "PANTALON JEANS" (sin skinny/premium/wide leg…).
  if (/\bJEANS?\b/.test(upper) || /\bPANTALON\s+JEANS\b/.test(upper)) {
    return "PANTALON JEANS";
  }
  return stripped;
}

function asStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "";
  return String(v).trim();
}

/** Quita placeholders Magaya (N/A, sin talla, 0 de género, etc.). */
export function sanitizeMagayaOptionalText(
  raw: string,
  kind: "modelo" | "pais" | "tejido" | "talla" | "genero" | "composicion" = "modelo",
): string {
  let t = String(raw ?? "").trim();
  if (!t) return "";

  if (/^sin\s+marca$/i.test(t)) return "";

  const upper = t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

  const placeholders = new Set([
    "N/A",
    "NA",
    "N.A",
    "N.A.",
    "NONE",
    "NULL",
    "-",
    "—",
    "NO APLICA",
    "NO ASIGNADO",
    "NO ASIGNADA",
    "SIN ASIGNAR",
    "SIN TALLA",
    "TALLA NO ASIGNADO",
    "TALLA NO ASIGNADA",
    "S/T",
    "S/N",
    "0",
  ]);
  if (placeholders.has(upper)) return "";
  if (/^TALLA\s+NO\s+ASIGNAD/.test(upper)) return "";
  if (/^SIN\s+TALLA/.test(upper)) return "";

  if (kind === "genero") {
    const allowed = new Set([
      "DAMA",
      "CABALLERO",
      "NINO",
      "NIÑO",
      "NINA",
      "NIÑA",
      "BEBE",
      "BEBÉ",
    ]);
    const g = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const map: Record<string, string> = {
      dama: "dama",
      caballero: "caballero",
      nino: "niño",
      nina: "niña",
      bebe: "bebe",
    };
    if (!allowed.has(upper) && !map[g]) return "";
    return map[g] ?? t.toLowerCase();
  }

  if (kind === "pais") {
    const code = upper.replace(/\s*\(\d+\)\s*$/, "").trim();
    const countries: Record<string, string> = {
      CH: "CHINA",
      CN: "CHINA",
      CHN: "CHINA",
      CHINA: "CHINA",
      US: "ESTADOS UNIDOS",
      USA: "ESTADOS UNIDOS",
      PA: "PANAMÁ",
      PANAMA: "PANAMÁ",
      MX: "MÉXICO",
      MEXICO: "MÉXICO",
      CO: "COLOMBIA",
      COLOMBIA: "COLOMBIA",
    };
    if (countries[code]) return countries[code];
    if (/^ORIGEN\s*:/.test(upper)) {
      t = t.replace(/^origen\s*:\s*/i, "").replace(/\s*\(\d+\)\s*$/, "").trim();
      return sanitizeMagayaOptionalText(t, "pais");
    }
    return t.replace(/\s*\(\d+\)\s*$/, "").trim().toUpperCase();
  }

  if (kind === "tejido") {
    // "TEJIDO PLANO" → "PLANO"; no repetir la palabra TEJIDO en el valor.
    let cleaned = t.replace(/^tejido\s*[:\-]?\s*/i, "").trim();
    cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
    if (!cleaned) return "";
    // COMPOSICION tipo "100% …" no es tejido.
    if (/^\d+\s*%/.test(cleaned) || /100\s*%/i.test(cleaned)) return "";
    return cleaned.toLocaleUpperCase("es");
  }

  return t;
}

/**
 * Evita tejido inventado desde la descripción o la composición
 * (ej. "CANVAS" / "YUTE" en el nombre del bolso).
 */
export function rejectTejidoInferredFromProduct(
  tejido: string,
  descripcion: string,
  composicion: string,
): string {
  const t = String(tejido ?? "").trim();
  if (!t) return "";
  const tUp = t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  const dUp = String(descripcion ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ");
  const cUp = String(composicion ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ");

  if (dUp && (dUp.includes(tUp) || tUp.split(" ").every((w) => w && dUp.includes(w)))) {
    return "";
  }
  if (cUp) {
    if (cUp.includes(tUp)) return "";
    // "YUTE" vs "100% YUTE"
    if (tUp.split(" ").some((w) => w.length >= 3 && cUp.includes(w))) return "";
  }
  return t;
}

function coerceIntPieces(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const notation = parseDozenLooseNotation(t);
  if (notation) return String(notation.dozenPcs);
  const fromDozen = parseDozensToUnits(t);
  if (fromDozen !== null) return String(fromDozen);
  const n = parseFloatLoose(t);
  if (!Number.isFinite(n) || n < 0) return "";
  return String(Math.round(n));
}

function coerceTotalPieces(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const notation = parseDozenLooseNotation(t);
  if (notation) return String(notation.totalPcs);
  const fromDozen = parseDozensToUnits(t);
  if (fromDozen !== null) return String(fromDozen);
  const n = parseFloatLoose(t);
  if (!Number.isFinite(n) || n < 0) return "";
  return String(Math.round(n));
}

function parseBultosNum(raw: string): number {
  const n = parseFloatLoose(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/**
 * Post-proceso de filas Terra: docenas, und entero, reempaque, JEANS, pesos.
 */
export function postProcessAldeGptTerraLines(
  rawLines: unknown[],
): AldeGptTerraLine[] {
  const out: AldeGptTerraLine[] = [];

  for (const item of rawLines) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;

    let referencia = asStr(row.referencia);
    let descripcion = normalizeJeansDescripcion(asStr(row.descripcion));
    let bultosRaw = asStr(
      row.bultos ??
        row.totalBultos ??
        row.total_bultos ??
        row.TotalBultos ??
        row.cartons,
    );
    let undBultoRaw = asStr(row.unidadesPorBulto);
    let totUndRaw = asStr(row.unidadesTotales);
    // Cantidad original de factura (ej. «8.00 DOC», «6.06 DOC») si el modelo la separó.
    // No uses quantity/issuedQty a ciegas (en packing BOX son cajas, no docenas).
    const cantidadFacturaExplicit = asStr(
      row.cantidadFactura ??
        row.cantidadOriginal ??
        row.cantidadDoc ??
        row.cantidad_doc,
    );
    const cantidadCandidate = asStr(row.cantidad ?? row.quantity ?? row.qty);
    const cantidadFacturaRaw =
      cantidadFacturaExplicit ||
      (parseDozenLooseNotation(cantidadCandidate) ||
      parseDozensToUnits(cantidadCandidate) !== null
        ? cantidadCandidate
        : "");
    let pesoBulto = asStr(row.pesoPorBulto);
    let pesoTot = preserveDocumentNumber(
      asStr(
        row.pesoTotalKg ??
          row.pesoBruto ??
          row.peso_bruto ??
          row.weight ??
          row.peso,
      ),
    );
    // Si solo vino un peso y no se distinguió por/total, tratarlo como total de línea.
    if (!pesoBulto && !asStr(row.pesoTotalKg) && pesoTot) {
      // pesoTot ya lleno desde aliases (total de factura)
    } else if (!pesoTot && asStr(row.pesoPorBulto)) {
      pesoBulto = asStr(row.pesoPorBulto);
    } else if (asStr(row.pesoTotalKg) || asStr(row.peso) || asStr(row.pesoBruto)) {
      // Preferir siempre el total del documento cuando viene en aliases de total.
      pesoTot = preserveDocumentNumber(
        asStr(row.pesoTotalKg || row.peso || row.pesoBruto || row.peso_bruto || row.weight),
      );
    }
    let reempaque = false;
    let modelo = sanitizeMagayaOptionalText(
      asStr(row.modelo ?? row.magayaModelo),
      "modelo",
    );
    let paisOrigen = sanitizeMagayaOptionalText(asStr(row.paisOrigen), "pais");
    let tejido = sanitizeMagayaOptionalText(asStr(row.tejido), "tejido");
    let talla = sanitizeMagayaOptionalText(asStr(row.talla), "talla");
    let genero = sanitizeMagayaOptionalText(asStr(row.genero), "genero");
    let composicion = sanitizeMagayaOptionalText(
      asStr(row.composicion),
      "composicion",
    );
    tejido = rejectTejidoInferredFromProduct(tejido, descripcion, composicion);

    // Cantidad DOC / N.M / N/M = TOTAL de la LÍNEA en piezas (no und/bulto).
    // Und/bulto se deriva después con Tot ÷ bultos.
    let fromDozenLineTotal = false;
    {
      const fromCant = parseDozenLooseNotation(cantidadFacturaRaw);
      const fromTot = parseDozenLooseNotation(totUndRaw);
      const fromUnd = parseDozenLooseNotation(undBultoRaw);
      const notation = fromCant ?? fromTot ?? fromUnd;
      if (notation) {
        fromDozenLineTotal = true;
        const lineTot = String(notation.totalPcs);
        undBultoRaw = lineTot;
        totUndRaw = lineTot;
      } else {
        const dzCant = parseDozensToUnits(cantidadFacturaRaw);
        const dzTot = parseDozensToUnits(totUndRaw);
        const dzUnd = parseDozensToUnits(undBultoRaw);
        const dzPcs = dzCant ?? dzTot ?? dzUnd;
        if (dzPcs !== null) {
          fromDozenLineTotal = true;
          const lineTot = String(dzPcs);
          undBultoRaw = lineTot;
          totUndRaw = lineTot;
        }
      }
    }

    let unidadesPorBulto = fromDozenLineTotal
      ? coerceTotalPieces(totUndRaw)
      : coerceIntPieces(undBultoRaw);
    let unidadesTotales = coerceTotalPieces(totUndRaw);

    if (!unidadesTotales && undBultoRaw) {
      unidadesTotales = coerceTotalPieces(undBultoRaw);
    }
    if (!unidadesPorBulto && unidadesTotales) {
      unidadesPorBulto = unidadesTotales;
    }

    // Garantizar enteros (nunca decimales en und/bulto).
    if (unidadesPorBulto) {
      const n = Math.round(parseFloatLoose(unidadesPorBulto) || 0);
      unidadesPorBulto = n > 0 ? String(n) : "";
    }
    if (unidadesTotales) {
      const n = Math.round(parseFloatLoose(unidadesTotales) || 0);
      unidadesTotales = n > 0 ? String(n) : "";
    }

    let bultosNum = parseBultosNum(bultosRaw);
    // "1/1" como Bulto No. → 1 bulto (no notación de docenas).
    const bultoNoMatch = /^(\d{1,6})\s*\/\s*\d{1,6}$/.exec(bultosRaw.trim());
    if (bultoNoMatch && bultosNum <= 0) {
      const first = parseInt(bultoNoMatch[1], 10);
      if (Number.isFinite(first) && first > 0) bultosNum = first;
    }

    // Solo el string "0" de Total Bultos cuenta como cero explícito (NO el flag del modelo).
    const bultosExplicitZero = /^0([.,]0+)?$/.test(bultosRaw.trim());

    // GLF / almacén: Pack Code BOX + Issued Qty → bultos = cajas (solo si Pack Code viene).
    const packCode = asStr(
      row.packCode ?? row.pack_code ?? row.tipoEmbalaje ?? row.tipo_embalaje,
    );
    const packIsBox = /\b(BOX|BOXES|CTN|CTNS|CARTON|CARTONS|CARTONES?|CAJAS?)\b/i.test(
      packCode,
    );
    const issuedQty = parseBultosNum(
      asStr(
        row.issuedQty ??
          row.issued_qty ??
          row.cantidadEmitida ??
          row.qty ??
          row.quantity,
      ),
    );
    if (bultosNum <= 0 && !bultosExplicitZero && packIsBox && issuedQty > 0) {
      bultosNum = issuedQty;
    }
    if (bultosNum <= 0 && !bultosExplicitZero && packIsBox) {
      const totAsBultos = parseBultosNum(unidadesTotales || totUndRaw);
      if (totAsBultos > 0) {
        bultosNum = totAsBultos;
        unidadesTotales = "";
        unidadesPorBulto = "";
      }
    }

    const pesoBultoNum = parseFloatLoose(pesoBulto);
    const pesoTotNum = parseFloatLoose(pesoTot);
    const hasPhysicalWeight =
      (Number.isFinite(pesoBultoNum) && pesoBultoNum > 0) ||
      (Number.isFinite(pesoTotNum) && pesoTotNum > 0);

    // Reglas duras (ignoran reempaque:true del modelo):
    // bultos>0 o peso>0 → NUNCA reempaque.
    // Total Bultos="0" y sin peso → reempaque (conservar piezas DOC).
    if (bultosNum > 0 || hasPhysicalWeight) {
      reempaque = false;
      if (bultosNum <= 0 && hasPhysicalWeight) {
        // Peso Bruto sin bultos: inferir 1 (p. ej. Magaya olvidó Total Bultos=1).
        // NUNCA usar las 12 piezas DOC como bultos.
        bultosNum = 1;
      }
    } else if (packIsBox && issuedQty > 0) {
      reempaque = false;
      bultosNum = issuedQty;
    } else if (bultosExplicitZero || bultosNum === 0 || !bultosRaw) {
      reempaque = true;
    } else {
      reempaque = false;
    }

    bultosRaw = String(Math.max(0, bultosNum));

    // Última red: si hay bultos, jamás reempaque (ni limpies peso/und de caja).
    if (bultosNum > 0) {
      reempaque = false;
    }

    // Tot und = piezas de la línea; Und/bulto = Tot ÷ bultos si es entero.
    // Si no divide exacto → und=48 y tot=factura (regla jefe; no decimales ni redondear tot).
    // NUNCA multiplies Tot × bultos (eso duplicaba: 8 DOC → 96 → 192).
    {
      const tot = Math.round(parseFloatLoose(unidadesTotales || "") || 0);
      if (tot > 0) {
        unidadesTotales = String(tot);
        if (!reempaque && bultosNum > 0) {
          if (tot % bultosNum === 0) {
            unidadesPorBulto = String(tot / bultosNum);
          } else {
            unidadesPorBulto = "48";
          }
        } else if (fromDozenLineTotal || !unidadesPorBulto) {
          unidadesPorBulto = String(tot);
        }
      }
    }

    if (reempaque) {
      bultosRaw = "0";
      // Conservar piezas de la factura (1/0 DOC → 12) para Magaya «cantidad por bulto».
      if (!unidadesTotales && unidadesPorBulto) {
        unidadesTotales = unidadesPorBulto;
      }
      if (!unidadesPorBulto && unidadesTotales) {
        unidadesPorBulto = unidadesTotales;
      }
      pesoBulto = "";
      pesoTot = "";
    }

    // Fidelidad a factura: si hay peso TOTAL del documento, NO lo recalcules.
    // Solo deriva peso/b con precisión alta para almacenamiento.
    if (!reempaque && pesoTot && bultosNum > 0) {
      const total = parseFloatLoose(pesoTot);
      if (Number.isFinite(total) && total > 0) {
        pesoTot = preserveDocumentNumber(pesoTot);
        pesoBulto = formatWeightPrecise(total / bultosNum);
      }
    } else if (!reempaque && pesoBulto && bultosNum > 0 && !pesoTot) {
      const pb = parseFloatLoose(pesoBulto);
      if (Number.isFinite(pb) && pb >= 0) {
        // Solo si el doc no trajo total: producto sin round-up agresivo.
        pesoTot = preserveDocumentNumber(
          String(Math.round(pb * bultosNum * 10000) / 10000),
        );
      }
    }

    if (
      !referencia &&
      !descripcion &&
      !bultosRaw &&
      !unidadesPorBulto &&
      !unidadesTotales &&
      !pesoBulto &&
      !pesoTot &&
      !reempaque
    ) {
      continue;
    }

    out.push({
      referencia,
      descripcion,
      bultos: bultosRaw,
      unidadesPorBulto,
      unidadesTotales,
      pesoPorBulto: pesoBulto,
      pesoTotalKg: pesoTot,
      reempaque,
      modelo,
      paisOrigen,
      tejido,
      talla,
      genero,
      composicion,
    });
  }

  return disambiguateSimilarReferencias(out);
}

const REF_DISAMBIG_STOP = new Set([
  "BOLSO",
  "BAG",
  "THE",
  "AND",
  "DE",
  "LA",
  "EL",
  "LOS",
  "LAS",
  "DEL",
  "CAMBRIDGE",
  "POLO",
  "CLUB",
  "CL",
  "MARCA",
  "ORIGEN",
  "CHINA",
  "EMPAQUE",
  "COMPOSICION",
  "TALLA",
  "TEJIDO",
  "PLANO",
]);

/**
 * Si Magaya trunca la misma ref en varias filas (BOLSO-CAMBRID…) pero las
 * descripciones difieren (DENIM vs YUTE), distingue las referencias.
 */
export function disambiguateSimilarReferencias(
  lines: AldeGptTerraLine[],
): AldeGptTerraLine[] {
  const byRef = new Map<string, number[]>();
  lines.forEach((l, i) => {
    const k = String(l.referencia ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    if (!k) return;
    const arr = byRef.get(k) ?? [];
    arr.push(i);
    byRef.set(k, arr);
  });

  const out = lines.map((l) => ({ ...l }));
  for (const [, idxs] of byRef) {
    if (idxs.length < 2) continue;
    const descs = idxs.map((i) => String(out[i]?.descripcion ?? "").trim());
    const normDescs = descs.map((d) =>
      d
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    );
    const unique = new Set(normDescs.filter(Boolean));
    if (unique.size < 2) continue;

    for (let j = 0; j < idxs.length; j++) {
      const i = idxs[j]!;
      const mine = normDescs[j] ?? "";
      if (!mine) continue;
      const others = normDescs.filter((_, k) => k !== j).join(" ");
      const words = mine.match(/[A-Z0-9]{3,}/g) ?? [];
      let token = "";
      for (const w of words) {
        if (REF_DISAMBIG_STOP.has(w)) continue;
        if (others.includes(w)) continue;
        token = w;
        break;
      }
      if (!token) {
        // Fallback: última palabra significativa de la descripción.
        for (let w = words.length - 1; w >= 0; w--) {
          const cand = words[w]!;
          if (!REF_DISAMBIG_STOP.has(cand)) {
            token = cand;
            break;
          }
        }
      }
      if (!token) continue;
      const ref = String(out[i]!.referencia ?? "").trim();
      if (ref.toUpperCase().includes(token)) continue;
      out[i] = {
        ...out[i]!,
        referencia: `${ref.replace(/[-\s]+$/g, "")}-${token}`,
      };
    }
  }
  return out;
}

/** Parsea el JSON crudo del modelo → reply + lines post-procesadas. */
export function parseAldeGptTerraModelPayload(raw: string): {
  reply: string;
  lines: AldeGptTerraLine[];
} {
  const text = String(raw ?? "").trim();
  if (!text) return { reply: "", lines: [] };

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { reply: text, lines: [] };
    }
    const obj = parsed as Record<string, unknown>;
    let reply = "";
    for (const key of ["reply", "message", "content", "text", "respuesta"] as const) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) {
        reply = v.trim();
        break;
      }
    }
    const linesRaw = Array.isArray(obj.lines) ? obj.lines : [];
    const lines = postProcessAldeGptTerraLines(linesRaw);
    return { reply: reply || (lines.length ? `Se extrajeron ${lines.length} fila(s).` : ""), lines };
  } catch {
    return { reply: text, lines: [] };
  }
}

/** Convierte línea Terra → input para normalizeCollectionOrderLineFromImport / orden. */
export function aldeGptTerraLineToImportInput(line: AldeGptTerraLine): ImportLineInput & {
  reempaque?: boolean;
} {
  return {
    referencia: line.referencia,
    descripcion: line.descripcion,
    bultos: line.bultos,
    unidadesPorBulto: line.unidadesPorBulto,
    unidadesTotales: line.unidadesTotales,
    pesoPorBulto: line.pesoPorBulto,
    pesoTotalKg: line.pesoTotalKg,
    modelo: line.modelo,
    paisOrigen: line.paisOrigen,
    tejido: line.tejido,
    talla: line.talla,
    genero: line.genero,
    composicion: line.composicion,
    reempaque: line.reempaque === true,
  };
}
