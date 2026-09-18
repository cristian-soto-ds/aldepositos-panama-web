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
  parseMeasureNumber,
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
  /** CTNS # del packing KING CARGO (ej. "1-23" o "164"); la app recalcula bultos. */
  ctns?: string;
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
  "COMPLETITUD: una fila JSON por CADA producto de la tabla hasta el último #LN (si hay 50+, 60+, 80+…, devuelve TODOS). " +
  "No omitas filas intermedias ni te detengas a mitad. Si la ref se ve cortada, distingue productos por descripción. " +
  "FACTURA NASA ZONA LIBRE: referencia = columna «NASA Referencia»; bultos = columna Cartons «MTR» (NO uses «Cant.» ni Piezas). " +
  "Ignora TRASPASO, TRANSPORTE ZL, SUBTOTAL, pie «Bultos totales» / «Piezas Totales». " +
  "PACKING KING CARGO / lista CTNS#: referencia = «CÓDIGO OEM»; bultos = cantidad de cajas del rango CTNS " +
  "(ej. 1-23 → 23; 24-73 → 50 = 73-24+1). NO uses QTY como bultos. " +
  "CTNS compartido: 164 KW-M180BT=1 y DMH-Z5150BT=0 reempaque; 165 si ambas MVH ya tuvieron rango, la última lleva 1. " +
  "PACKING BASH CORP (No.|Artículo|Descripción|Empaque|U/M|Cantidad|Bultos|Cubicaje|Peso): " +
  "referencia = Artículo COMPLETO uniendo líneas (PL-88801-BGE + MIC → «PL-88801-BGE MIC»). " +
  "bultos = SOLO la columna «Bultos» (1, 2…); NUNCA Empaque (12) ni Cantidad (24.00). " +
  "Envía también empaque y cantidad para validar. Pie «Bulto: N» = suma de bultos (ej. 55). " +
  "Si Total Bultos/Bts/MTR ≥ 1 → bultos=ese número y reempaque=false. " +
  "Si CANT. DE BULTO / Bts / # BLTO vacío (aunque haya peso) → bultos=\"0\" y reempaque=true. " +
  "Si Bts vacío / # BLTO vacío y la misma referencia se repite (packing list bodega) → bultos=\"0\" y reempaque=true. " +
  "Si Total Bultos = 0 (o vacío sin caja propia) → bultos=\"0\" y reempaque=true. " +
  "EMPAQUE del documento NO implica reempaque por sí solo. No inventes referencias.";

export const ALDEGPT_TERRA_REFS_BULTOS_INSTRUCTIONS = `Eres ${ALDEGPT_TERRA_DISPLAY_NAME}, asistente de ALDEPOSITOS. Modo «solo referencias y bultos»: el usuario solo necesita códigos, cantidades de bultos y marcas de reempaque para la orden de recolección.

Antes de emitir el JSON: recorre TODAS las páginas/filas, no te cortes a mitad, y verifica que cada producto de la tabla tenga su objeto en "lines".

Responde SIEMPRE con un único JSON válido:
{
  "reply": "resumen breve en español (1–4 frases)",
  "lines": [ { "referencia": "...", "bultos": "...", "reempaque": false } ]
}

Cada objeto en "lines" usa SOLO estas claves:
- referencia (string)
- bultos (string; cantidad de cajas/bultos)
- reempaque (boolean)
- cartonsMtr (opcional: valor de Cartons MTR en facturas NASA; la app lo usa como bultos)
- ctns (opcional: rango CTNS# de packing KING CARGO, ej. "1-23" o "164"; la app calcula bultos)
- articulo / articuloLine2 (opcional: Artículo multilínea BASH; la app une en referencia)
- empaque / cantidad (opcional: en PACKING BASH para corregir si confundiste Empaque/Cantidad con Bultos)

=== REGLAS ===
1) REFERENCIA: código/SKU/Codigo/Item/Style/Part Number/«NASA Referencia»/«CÓDIGO OEM»/«Artículo». Una fila por CADA producto de la tabla. No inventes.
   COMPLETITUD OBLIGATORIA: si el packing/factura tiene 50+ productos en 2–3 páginas, "lines" debe tener 50+ objetos. NUNCA omitas una fila intermedia ni te cortes a mitad.
   Total Bultos=0 / Bts vacío / misma ref repetida sin # BLTO también cuenta (reempaque=true): EXTRÁELA igual.
   Si la columna Referencia se ve cortada (ej. BOLSO-CAMBRID), completa el código con la descripción
   (BOLSO CAMBRIDGE DENIM CANVAS vs BOLSO CAMBRIDGE YUTE → dos referencias distintas, no una sola).
2) BULTOS: columna «Total Bultos», «Bultos», «Bts», «Cajas», o en facturas NASA Cartons «MTR». «# BLTO» / «CTNS #» en packing KING CARGO es un rango de cajas: bultos = fin−inicio+1.
   NUNCA uses «Cant.» / «Cantidad» / QTY / piezas como bultos (eso son unidades).
   Si Pack Code=BOX/CTN/CARTON, Issued Qty = bultos (cajas). No uses «Bulto No.» ni EMPAQUE como cantidad de bultos.
2b) FACTURA NASA ZONA LIBRE PANAMA S.A. (columnas NASA Referencia | Descripción | Cartons MTR | UxE | Cant. | Unid. | Precio | Importe):
   - referencia = «NASA Referencia» EXACTA (ej. 36587, 36704B, DIS-1025-01, 74114-2025).
   - bultos = Cartons «MTR» EXACTO (cajas físicas). También puedes enviar cartonsMtr=MTR.
   - NUNCA pongas «Cant.» (piezas) en bultos. Ejemplo: MTR=2, UxE=36, Cant=72 → bultos="2" (NO 72).
   - Una fila JSON por CADA línea de producto de TODAS las páginas (FAV multipágina).
   - IGNORA filas: SUBTOTAL, TRASPASO, TRANSPORTE ZL, Unid=SERV, pie «Bultos totales» / «Piezas Totales» / Peso Total (esos totales solo validan; no van en lines).
   - En reply indica cuántas refs y la suma de MTR (debe acercarse a «Bultos totales» del pie si consta).
2c) PACKING LIST KING CARGO / similar (columnas CTNS # | CÓDIGO OEM | QTY | KG | medidas):
   - referencia = «CÓDIGO OEM» COMPLETO (ej. KFC-1666S, DMH-AP6650BT, BASSPRONANO).
   - bultos = cantidad de cajas del rango CTNS #: inicio-fin → (fin − inicio + 1).
     Ejemplos OBLIGATORIOS: «1-23» → bultos="23"; «24-73» → bultos="50"; «164» → bultos="1".
   - Envía también ctns="1-23" (o el valor exacto) para que la app recalcule si hace falta.
   - NUNCA uses QTY como bultos (QTY=138 con CTNS 1-23 → bultos=23, no 138).
   - Varias refs en el MISMO CTNS: UNA sola lleva el cartón; las demás bultos="0" reempaque=true.
     Ej. CTNS 164: KW-M180BT bultos="1" (original); DMH-Z5150BT bultos="0" reempaque=true.
     Ej. CTNS 165: MVH-S325BT y MVH-S235BT — si ambas ya tuvieron rango propio antes, la ÚLTIMA lleva bultos="1" y la otra reempaque.
   - Si la misma OEM reaparece en otro CTNS (ej. DMH-AP6650BT en 121-131 y otra vez en 166): EXTRAÉ AMBAS filas con su ctns (la app suma).
   - Extrae TODAS las refs de TODAS las páginas. Ignora la fila total «Bultos / Total QTY / Total KG».
   - En reply: N refs + suma de bultos (debe coincidir con «Bultos» del pie, ej. 166).
2d) PACKING BASH CORP / similar (No. | Artículo | Descripción | Empaque | U/M | Cantidad | Bultos | Cubicaje | Peso):
   - referencia = «Artículo» COMPLETO. Si el código ocupa DOS líneas, ÚNELAS con espacio:
     «PL-88801-BGE» + «MIC» → «PL-88801-BGE MIC»; «PL-88803-BLK S» + «PU» → «PL-88803-BLK S PU».
     También puedes enviar articulo + articuloLine2; la app los une.
   - bultos = SOLO la columna «Bultos» (enteros 1, 2…). NUNCA «Empaque» (3, 12, 24) ni «Cantidad» (12.00, 24.00).
     Ejemplos OBLIGATORIOS: Empaque=12, Cantidad=12.00, Bultos=1 → bultos="1" (NO 12).
     Empaque=12, Cantidad=24.00, Bultos=2 → bultos="2" (NO 12 ni 24).
     Empaque=3, U/M=DOC, Cantidad=3.00, Bultos=1 → bultos="1" (NO 3).
   - Envía empaque y cantidad (números del PDF) para que la app corrija si mezclaste columnas.
   - La misma Artículo puede repetirse en filas distintas (ej. Bultos=1 y luego Bultos=2): EXTRAÉ AMBAS.
   - TODAS las páginas (1 of 2…). Pie «Bulto: 55» solo valida: suma de bultos de lines ≈ 55.
   - Empaque ≠ reempaque. Filas con Bultos≥1 → reempaque=false.
3) REEMPAQUE:   - Total Bultos/Bts/MTR ≥ 1 → bultos≥1, reempaque=false SIEMPRE (ej. Total Bultos=1 peso=21.25).
   - CANT. DE BULTO / Bts / BULTO No. vacíos aunque haya peso → bultos="0", reempaque=true (factura Tango).
   - Pack Code BOX/CTN + Issued Qty > 0 → bultos=Issued Qty, reempaque=false.
   - Packing list bodega: misma referencia repetida con # BLTO vacío y Bts vacío → bultos="0", reempaque=true (OBLIGATORIA).
   - Total Bultos Magaya = 0 y peso 0 → bultos="0", reempaque=true. ESTAS FILAS SON OBLIGATORIAS (no las saltes).
   - EMPAQUE del PDF ≠ reempaque.
4) Deja vacíos / no envíes descripción, unidades, peso, Magaya ni otros campos.
5) Respeta orden de páginas (1, 2, 3…) y de la tabla de arriba hacia abajo. Lee TODAS las páginas.
6) Ignora SUBTOTAL / TOTAL / GASTOS / TRASPASO / TRANSPORTE sin código de producto de mercancía.
7) Si no hay documento usable: "lines": [] y explícalo en reply.
8) Si el mensaje dice «Documento K de N»: extrae SOLO ese documento. El pedido completo se arma concatenando K=1…N en ese orden.`;

/** Deja solo referencia, bultos, reempaque y ctns (para finalizar CTNS en el cliente). */
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
      const ctns = String(l.ctns ?? "").trim();
      return ctns
        ? { referencia, bultos, reempaque, ctns }
        : { referencia, bultos, reempaque };
    })
    .filter((l) => l.referencia || l.bultos || l.reempaque || l.ctns);
}

export const ALDEGPT_TERRA_DOCUMENT_INSTRUCTIONS = `Eres ${ALDEGPT_TERRA_DISPLAY_NAME}, asistente de ALDEPOSITOS. Cuando el usuario adjunta un packing list, factura u otro documento de mercancía, EXTRAES filas de producto para la orden de recolección y el Excel Magaya.

Antes de emitir el JSON: revisa mentalmente TODAS las páginas y filas de la tabla, cruza totales (bultos/peso) si aparecen, y corrige inconsistencias evidentes. Prefiere exhaustividad y exactitud sobre velocidad. No inventes códigos ni cantidades.

Responde SIEMPRE con un único JSON válido:
{
  "reply": "resumen claro en español (2–8 frases): qué extrajiste, totales si constan, y avisos si algo quedó ambiguo",
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
- articulo / articuloLine2 (opcional: Artículo multilínea PACKING BASH; la app une en referencia)
- empaque (opcional: columna Empaque PACKING BASH; ayuda a corregir bultos)
- um (opcional: U/M del packing, ej. DOC, PAR)

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
   - REGLA DE ORO: si Total Bultos / CANT. DE BULTO ≥ 1 → reempaque=false SIEMPRE.
   - Total Bultos ≥ 1 → bultos=ese número, reempaque=false. Si además hay Peso Bruto, copialo a pesoTotalKg.
   - Ejemplo: Total Bultos=1, Peso=21.25, Ref GREY-BAG-BACCI → bultos="1", reempaque=false, pesoTotalKg="21.25".
   - REEMPAQUE TANGO / factura comercial: CANT. DE BULTO vacío Y BULTO No. vacío → bultos="0", reempaque=true
     AUNQUE haya Peso Bruto > 0 (ej. 0.73 kg) y cantidad «0 (1)» / «0 (3)». Conserva pesoTotalKg y piezas.
     NUNCA inventes bultos=1 solo porque hay peso: sin columna de bultos = reempaque.
   - Solo Total Bultos = 0 y Peso = 0 → bultos="0", reempaque=true (filas dentro del mismo cartón).
     Conserva piezas: "1/0 DOC" → unidadesPorBulto="12" y unidadesTotales="12".
   - EMPAQUE del PDF ≠ reempaque.
B) Recibo GLF / almacén (Pack Code BOX/CTN + Issued Qty):
   - Issued Qty con Pack=BOX → bultos=Issued Qty, reempaque=false.
   - No uses Issued Qty como piezas si Pack=BOX.
C) Factura comercial Tango / similar (BULTO No., CANT. DE BULTO, REFERENCIA, PESO, CANTIDAD DOC):
   - bultos = CANT. DE BULTO exacta (ej. 7, 11). Si CANT. DE BULTO y BULTO No. están vacíos → reempaque=true, bultos="0".
   - cantidad «28 (11)» = 28 docenas + 11 piezas → unidadesTotales="347". «0 (1)» en reempaque → unidadesTotales="1".
   - peso → pesoTotalKg exacto (también en reempaque: 0.73).
   - Si la MISMA referencia aparece con bultos y luego como reempaque, EXTRAÉ AMBAS filas (la app las consolidará).
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
E) FACTURA NASA ZONA LIBRE PANAMA S.A. (NASA Referencia | Descripción | Cartons MTR | UxE | Cant. | Unid. | Precio | Importe):
   - referencia = columna «NASA Referencia» EXACTA (36587, 36704B, DIS-1025-01, 118166, 74114-2025, etc.).
   - bultos = Cartons «MTR» (cajas físicas). También puedes enviar cartonsMtr con ese valor.
   - unidadesPorBulto = UxE si consta; unidadesTotales = Cant. (piezas). NUNCA pongas Cant. en bultos.
   - Ejemplo OBLIGATORIO: MTR=2, UxE=36, Cant=72 → bultos="2", unidadesPorBulto="36", unidadesTotales="72".
   - Extrae TODAS las páginas (1 of 3, 1 of 2…). Si hay 60+ refs, "lines" debe tener 60+ objetos.
   - IGNORA: SUBTOTAL, TRASPASO, TRANSPORTE ZL, Unid=SERV, y el pie «Bultos totales» / «Piezas Totales» / Peso Total (solo para validar en reply).
   - En reply: N refs + suma MTR (debe coincidir con «Bultos totales» del pie si aparece).
F) PACKING LIST KING CARGO / similar (CTNS # | CÓDIGO OEM | QTY | KG | L/W/H):
   - referencia = «CÓDIGO OEM» completo.
   - bultos = cajas del rango CTNS: (fin − inicio + 1). Ej. 1-23→23; 24-73→50; 164→1.
   - Envía ctns con el rango exacto ("24-73"). NUNCA pongas QTY en bultos.
   - Varias refs en un mismo CTNS: solo UNA lleva bultos=1; las demás reempaque bultos=0.
     CTNS 164: KW-M180BT=1, DMH-Z5150BT=0. CTNS 165: si MVH-S325BT ya tuvo 100-103, MVH-S235BT lleva el 1.
   - Misma OEM en otro CTNS (DMH-AP6650BT 121-131 y 166): dos filas con ctns; la app suma (11+1=12).
   - Ignora fila total «Bultos / Total QTY». Completitud: suma bultos ≈ pie (ej. 166).
G) PACKING BASH CORP / similar (No. | Artículo | Descripción | Empaque | U/M | Cantidad | Bultos | Cubicaje | Peso):
   - referencia = «Artículo» COMPLETO uniendo líneas del PDF (espacio simple):
     «PL-88801-BGE»+«MIC» → «PL-88801-BGE MIC»; «PL-37901-BGE S»+«PU» → «PL-37901-BGE S PU».
     Opcional: articulo + articuloLine2 (la app une).
   - bultos = columna «Bultos» EXACTA. NUNCA Empaque ni Cantidad.
     Ej.: Empaque=12 Cantidad=12.00 Bultos=1 → bultos="1"; Empaque=12 Cantidad=24 Bultos=2 → bultos="2".
   - Envía empaque y cantidad del PDF (la app corrige confusiones Empaque/Cantidad↔Bultos).
   - U/M=PAR → unidadesTotales=Cantidad (pares); U/M=DOC → unidadesTotales=Cantidad×12.
     unidadesPorBulto = unidadesTotales÷bultos si divide exacto; si no, Empaque (PAR) o Empaque×12 (DOC).
   - peso (columna Peso) → pesoTotalKg exacto. Cubicaje NO es peso.
   - Misma Artículo en varias filas → varias lines (la app consolidará sumando bultos).
   - TODAS las páginas. Reply: N filas + suma bultos ≈ pie «Bulto: N» (ej. 55). Empaque ≠ reempaque.

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
En reempaque CON peso de factura (Tango: 0.73 kg) → conservá pesoTotalKg (la app lo suma a la misma ref con bultos).
En reempaque sin peso del documento → deja pesos vacíos.

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
  const raw = String(s ?? "").trim();
  if (!raw || !/\d/.test(raw)) return NaN;
  return parseMeasureNumber(raw);
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
 * CTNS # / rango de cajas → cantidad de bultos.
 * «1-23» → 23; «24-73» → 50; «164» → 1 (solo si allowSingle).
 * Equivale a (fin − inicio + 1).
 */
export function parseCtnsRangeToBultos(
  raw: string | null | undefined,
  options?: { allowSingle?: boolean },
): number | null {
  const parsed = parseCtnsRange(raw, options);
  return parsed ? parsed.bultos : null;
}

/** Normaliza CTNS para detectar varias refs en el mismo cartón/rango. */
export function normalizeCtnsKey(
  raw: string | null | undefined,
  options?: { allowSingle?: boolean },
): string | null {
  const parsed = parseCtnsRange(raw, options);
  if (!parsed) return null;
  return parsed.start === parsed.end
    ? String(parsed.start)
    : `${parsed.start}-${parsed.end}`;
}

function parseCtnsRange(
  raw: string | null | undefined,
  options?: { allowSingle?: boolean },
): { start: number; end: number; bultos: number } | null {
  const allowSingle = options?.allowSingle !== false;
  const s = String(raw ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!s) return null;

  const range = /^(\d{1,6})\s*[-–—]\s*(\d{1,6})$/.exec(s);
  if (range) {
    const start = parseInt(range[1]!, 10);
    const end = parseInt(range[2]!, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return null;
    }
    return { start, end, bultos: end - start + 1 };
  }

  // No usar "/" aquí: en Magaya/Tango «1/1» o refs «DD32520/6» no son CTNS.
  if (!allowSingle) return null;

  const single = /^(\d{1,6})$/.exec(s);
  if (single) {
    const n = parseInt(single[1]!, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return { start: n, end: n, bultos: 1 };
  }

  return null;
}

/**
 * Une Artículo multilínea de packing BASH CORP.
 * Ej. «PL-88801-BGE» + «MIC» → «PL-88801-BGE MIC».
 */
export function joinBashArticuloReferencia(
  primary: string | null | undefined,
  line2?: string | null | undefined,
): string {
  const a = String(primary ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const b = String(line2 ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!a) return b;
  if (!b) return a;
  const aUp = a.toUpperCase();
  const bUp = b.toUpperCase();
  if (aUp.includes(bUp) || bUp.includes(aUp)) {
    return a.length >= b.length ? a : b;
  }
  return `${a} ${b}`;
}

/**
 * PACKING BASH: Bultos = Cantidad ÷ Empaque cuando el modelo puso Empaque o Cantidad
 * en la columna de bultos (o la dejó vacía).
 * Ej. Empaque=12, Cantidad=24, bultos=12 → 2; Empaque=3, Cantidad=3, bultos=3 → 1.
 */
export function resolveBashPackingBultos(input: {
  bultos?: string | null;
  empaque?: string | null;
  cantidad?: string | null;
}): number | null {
  const emp = Math.round(parseFloatLoose(String(input.empaque ?? "")) || 0);
  const cantRaw = String(input.cantidad ?? "")
    .trim()
    .replace(/,/g, ".");
  // Solo cantidad numérica simple (12 / 12.00 / 24.00), no notación DOC «6.06».
  if (!/^\d+(\.\d+)?$/.test(cantRaw)) return null;
  const cant = parseFloatLoose(cantRaw);
  if (!(emp > 0) || !(cant > 0)) return null;
  const packages = cant / emp;
  if (!Number.isFinite(packages) || packages <= 0) return null;
  if (Math.abs(packages - Math.round(packages)) > 1e-6) return null;
  const expected = Math.round(packages);

  const bultosRaw = String(input.bultos ?? "").trim();
  const bultosNum = Math.round(parseFloatLoose(bultosRaw) || 0);
  const cantRounded = Math.round(cant);

  if (!bultosRaw || bultosNum <= 0) return expected;
  if (bultosNum === expected) return expected;
  // Confusión clásica: copió Empaque o Cantidad en vez de Bultos.
  if (bultosNum === emp || bultosNum === cantRounded) return expected;
  return null;
}

/**
 * Si el modelo pone ctns solo en la 1ª fila del cartón compartido y la
 * siguiente viene sin ctns (a menudo con QTY en bultos), hereda el mismo CTNS.
 * Evita MVH-S325BT=5 y MVH-S235BT=5 cuando ambas deberían compartir el 165.
 */
export function inheritAdjacentSharedCtns(
  items: Array<{
    line: AldeGptTerraLine;
    ctnsKey: string | null;
    ctnsBultos: number | null;
  }>,
): void {
  for (let i = 0; i < items.length; i++) {
    const cur = items[i]!;
    if (!cur.ctnsKey || cur.ctnsBultos == null || cur.ctnsBultos !== 1) continue;
    // Solo cartón suelto («164»), no rangos «100-103».
    if (cur.ctnsKey.includes("-")) continue;

    let inherited = 0;
    for (let j = i + 1; j < items.length; j++) {
      const next = items[j]!;
      if (next.ctnsKey) break;
      // Una sola compañera típica (2 SKUs por cartón).
      if (inherited >= 1) break;
      next.ctnsKey = cur.ctnsKey;
      next.ctnsBultos = 1;
      inherited++;
    }
  }
}

/**
 * Si varias refs comparten el mismo CTNS, solo UNA lleva los bultos;
 * el resto queda reempaque (bultos=0). Evita 168/167 cuando el pie dice 166.
 *
 * Quién gana el cartón compartido:
 * 1) Si alguna ref del grupo aún NO tiene bultos de un CTNS anterior → la primera
 *    de esas (ej. CTNS 164: KW-M180BT gana; DMH-Z5150BT = reempaque).
 * 2) Si TODAS ya tenían bultos de rangos previos → la ÚLTIMA del grupo
 *    (ej. CTNS 165: MVH-S325BT ya tenía 100-103 → 0; MVH-S235BT gana el 1).
 */
export function assignBultosForSharedCtns(
  items: Array<{
    line: AldeGptTerraLine;
    ctnsKey: string | null;
    ctnsBultos: number | null;
  }>,
): AldeGptTerraLine[] {
  const refKey = (line: AldeGptTerraLine) =>
    String(line.referencia ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");

  // Orden de aparición de cada CTNS (primera vez que sale en el packing).
  const ctnsOrder: string[] = [];
  const groups = new Map<
    string,
    Array<{ index: number; count: number; ref: string }>
  >();

  items.forEach((item, index) => {
    const key = item.ctnsKey;
    const count = item.ctnsBultos;
    if (!key || count == null || count <= 0) return;
    if (!groups.has(key)) {
      groups.set(key, []);
      ctnsOrder.push(key);
    }
    groups.get(key)!.push({ index, count, ref: refKey(item.line) });
  });

  const winnerByIndex = new Map<number, number>(); // index → bultos a asignar
  const refsWithPriorBultos = new Set<string>();

  // Refs que ya traen bultos sin CTNS explícito (Magaya/Tango) cuentan como "prior".
  items.forEach((item) => {
    if (item.ctnsKey && item.ctnsBultos != null && item.ctnsBultos > 0) return;
    const b = Math.round(
      parseFloat(String(item.line.bultos ?? "").replace(",", ".")) || 0,
    );
    const r = refKey(item.line);
    if (r && b > 0 && item.line.reempaque !== true) {
      refsWithPriorBultos.add(r);
    }
  });

  for (const key of ctnsOrder) {
    const members = groups.get(key)!;
    const count = members[0]!.count;
    let winnerIdx = members[0]!.index;

    if (members.length > 1) {
      const withoutPrior = members.filter((m) => !refsWithPriorBultos.has(m.ref));
      if (withoutPrior.length > 0) {
        winnerIdx = withoutPrior[0]!.index;
      } else {
        winnerIdx = members[members.length - 1]!.index;
      }
    }

    for (const m of members) {
      if (m.index === winnerIdx) {
        winnerByIndex.set(m.index, count);
        if (m.ref) refsWithPriorBultos.add(m.ref);
      } else {
        winnerByIndex.set(m.index, 0);
      }
    }
  }

  return items.map((item, index) => {
    const line: AldeGptTerraLine = { ...item.line };
    if (item.ctnsKey) {
      line.ctns = item.ctnsKey;
    }
    if (winnerByIndex.has(index)) {
      const count = winnerByIndex.get(index)!;
      if (count > 0) {
        line.bultos = String(count);
        line.reempaque = false;
      } else {
        line.bultos = "0";
        line.reempaque = true;
      }
    }
    return line;
  });
}

/** Filas de factura NASA / pie / servicios que no son mercancía. */
export function isNonProductTerraRow(
  referencia: string,
  descripcion: string,
  unid?: string,
): boolean {
  const ref = referencia
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const desc = descripcion
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const unit = String(unid ?? "")
    .trim()
    .toUpperCase();

  if (unit === "SERV" || unit === "SERVICE") return true;

  const blob = `${ref} ${desc}`.trim();
  if (!blob) return false;

  if (
    /^(SUBTOTAL|TOTAL|GASTOS?|TRASPASO|TRANSPORTE(\s+ZL)?|BULTOS)\b/.test(blob) ||
    /\b(SUBTOTAL|BULTOS\s*TOTALES|PIEZAS\s*TOTALES|PESO\s*TOTAL|TOTAL\s*VOLUMEN|TOTAL\s*QTY|TOTAL\s*KG)\b/.test(
      blob,
    ) ||
    /^(TRASPASO|TRANSPORTE(\s+ZL)?|BULTOS)$/.test(ref)
  ) {
    return true;
  }
  return false;
}

/**
 * Post-proceso de filas Terra: docenas, und entero, reempaque, JEANS, pesos.
 * @param options.deferFinalize — si true, conserva ctns y no consolida (para
 *   concatenar continuaciones; luego finalizeAldeGptTerraLines).
 */
export function postProcessAldeGptTerraLines(
  rawLines: unknown[],
  options?: { deferFinalize?: boolean },
): AldeGptTerraLine[] {
  type CtnsItem = {
    line: AldeGptTerraLine;
    ctnsKey: string | null;
    ctnsBultos: number | null;
  };
  const staged: CtnsItem[] = [];

  for (const item of rawLines) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;

    let referencia = asStr(
      row.referencia ??
        row.articulo ??
        row.Artículo ??
        row.nasaReferencia ??
        row.nasa_referencia ??
        row.NASAReferencia ??
        row.codigoOem ??
        row.codigo_oem ??
        row.codigoOEM ??
        row.oem,
    );
    const articuloLine2 = asStr(
      row.articuloLine2 ??
        row.articulo_line2 ??
        row.articuloSufijo ??
        row.articulo_sufijo ??
        row.articulo2,
    );
    if (articuloLine2) {
      referencia = joinBashArticuloReferencia(referencia, articuloLine2);
    } else {
      referencia = joinBashArticuloReferencia(referencia);
    }
    let descripcion = normalizeJeansDescripcion(asStr(row.descripcion));
    const unidDoc = asStr(row.unid ?? row.unidad ?? row.unit ?? row.Unid ?? row.um ?? row["U/M"]);
    if (isNonProductTerraRow(referencia, descripcion, unidDoc)) {
      continue;
    }

    // NASA Cartons MTR = bultos físicos. Preferir MTR sobre Cant./piezas.
    const cartonsMtrRaw = asStr(
      row.cartonsMtr ??
        row.cartons_mtr ??
        row.mtr ??
        row.CartonsMTR ??
        row.cartons,
    );
    const cartonsMtrNum = parseBultosNum(cartonsMtrRaw);
    const hasCartonsMtr =
      cartonsMtrRaw !== "" &&
      (/^0([.,]0+)?$/.test(cartonsMtrRaw.trim()) || cartonsMtrNum > 0);

    let bultosRaw = asStr(
      row.bultos ??
        row.totalBultos ??
        row.total_bultos ??
        row.TotalBultos,
    );

    // KING CARGO: CTNS explícito (permite «164») o rango metido en bultos («1-23»).
    // Ojo: un número solo en bultos (7, 12…) NO es CTNS — es cantidad Magaya/Tango.
    const ctnsFieldRaw = asStr(
      row.ctns ??
        row.ctnsRange ??
        row.ctns_range ??
        row.CTNS ??
        row.cartonRange ??
        row.carton_range ??
        row.bltoRange ??
        row["#BLTO"],
    );
    let ctnsRaw = ctnsFieldRaw;
    if (!ctnsRaw && parseCtnsRangeToBultos(bultosRaw, { allowSingle: false })) {
      ctnsRaw = bultosRaw;
    }
    const ctnsFromExplicit = Boolean(ctnsFieldRaw);
    const ctnsBultos = parseCtnsRangeToBultos(ctnsRaw, {
      allowSingle: ctnsFromExplicit,
    });
    const ctnsKey = normalizeCtnsKey(ctnsRaw, {
      allowSingle: ctnsFromExplicit,
    });

    if (hasCartonsMtr) {
      bultosRaw = String(cartonsMtrNum);
    } else if (ctnsBultos != null && ctnsBultos > 0) {
      bultosRaw = String(ctnsBultos);
    }

    // PACKING BASH CORP: Empaque | Cantidad | Bultos — corregir si mezcló columnas.
    const empaqueRaw = asStr(
      row.empaque ?? row.Empaque ?? row.packSize ?? row.pack_size,
    );
    const cantidadBashRaw = asStr(
      row.cantidad ??
        row.Cantidad ??
        row.quantity ??
        row.qty ??
        row.cantidadFactura ??
        row.cantidadDoc,
    );
    if (!hasCartonsMtr && (ctnsBultos == null || ctnsBultos <= 0)) {
      const bashBultos = resolveBashPackingBultos({
        bultos: bultosRaw,
        empaque: empaqueRaw,
        cantidad: cantidadBashRaw,
      });
      if (bashBultos != null && bashBultos > 0) {
        bultosRaw = String(bashBultos);
      }
    }

    let undBultoRaw = asStr(
      row.unidadesPorBulto ?? row.uxe ?? row.UxE ?? row.unitsPerCarton,
    );
    let totUndRaw = asStr(
      row.unidadesTotales ?? row.cant ?? row.Cant ?? row.piezas,
    );
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
    // Si no hay UxE/tot y vino Cant. numérico (NASA), úsalo como piezas de línea.
    if (!totUndRaw && cantidadCandidate && !cantidadFacturaRaw) {
      const cantPcs = parseBultosNum(cantidadCandidate);
      if (cantPcs > 0 && !(hasCartonsMtr && cantPcs === cartonsMtrNum)) {
        // Evitar confundir MTR con Cant. cuando son iguales (raro).
        totUndRaw = String(cantPcs);
      }
    }

    // PACKING BASH: U/M DOC → Cantidad son docenas; PAR → pares/piezas.
    {
      const um = unidDoc.toUpperCase().replace(/\./g, "");
      const cantNum = parseFloatLoose(cantidadBashRaw);
      const empNum = Math.round(parseFloatLoose(empaqueRaw) || 0);
      const cantLooksPlain = /^\d+([.,]\d+)?$/.test(
        String(cantidadBashRaw ?? "").trim(),
      );
      if (empaqueRaw && cantLooksPlain && cantNum > 0) {
        if (um === "DOC" || um === "DOCENA" || um === "DOCENAS") {
          const pcs = Math.round(cantNum) * DOZEN;
          totUndRaw = String(pcs);
          if (!undBultoRaw) undBultoRaw = String(pcs);
          // Forzar conversión DOC aunque cantidadFactura no trajera sufijo.
          if (!cantidadFacturaRaw) {
            // marca más abajo vía fromDozen al recalcular — set tot ya en piezas
          }
        } else if (um === "PAR" || um === "PARES" || um === "PARSES") {
          totUndRaw = String(Math.round(cantNum));
          if (!undBultoRaw && empNum > 0) {
            undBultoRaw = String(empNum);
          }
        }
      }
    }

    if (
      hasCartonsMtr &&
      bultosRaw &&
      parseBultosNum(bultosRaw) === parseBultosNum(cantidadCandidate) &&
      cartonsMtrNum > 0 &&
      parseBultosNum(cantidadCandidate) !== cartonsMtrNum
    ) {
      // Modelo puso Cant. en bultos; corregir a MTR.
      bultosRaw = String(cartonsMtrNum);
    }
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

    // Cantidad tipo «0 (1)» / «0 (3)» típica de reempaque en factura Tango.
    const cantidadLooksReempaque = /^0([.,]0+)?\s*[(/]\s*\d/i.test(
      cantidadFacturaRaw.trim(),
    );
    const modelSaysReempaque = row.reempaque === true;
    const modelSaysNotReempaque = row.reempaque === false;

    // Reglas duras:
    // - bultos>0 → NUNCA reempaque.
    // - bultos vacío/0 + (modelo reempaque | cantidad 0(N) | cero explícito) → reempaque
    //   AUNQUE haya peso (Tango: reempaque con 0.73 kg).
    // - bultos vacío + peso + modelo NO dijo reempaque → Magaya olvidó Total Bultos=1.
    if (bultosNum > 0) {
      reempaque = false;
    } else if (
      modelSaysReempaque ||
      bultosExplicitZero ||
      cantidadLooksReempaque
    ) {
      reempaque = true;
    } else if (!bultosRaw && hasPhysicalWeight && modelSaysNotReempaque) {
      // Magaya: el modelo niega reempaque y olvidó Total Bultos → 1 bulto.
      reempaque = false;
      bultosNum = 1;
    } else if (!bultosRaw || bultosNum === 0) {
      // Sin bultos en documento (Tango / packing): reempaque aunque haya peso.
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
      // Conservar peso del documento en reempaque (Tango) para consolidar con la misma ref.
      // Solo limpiar peso/b unitario confuso; el total de línea se mantiene si vino.
      pesoBulto = "";
      if (!hasPhysicalWeight) {
        pesoTot = "";
      }
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

    staged.push({
      line: {
        referencia,
        descripcion,
        bultos: bultosRaw,
        unidadesPorBulto,
        unidadesTotales,
        pesoPorBulto: pesoBulto,
        pesoTotalKg: pesoTot,
        reempaque,
        ...(ctnsKey ? { ctns: ctnsKey } : {}),
        modelo,
        paisOrigen,
        tejido,
        talla,
        genero,
        composicion,
      },
      ctnsKey: hasCartonsMtr ? null : ctnsKey,
      ctnsBultos: hasCartonsMtr ? null : ctnsBultos,
    });
  }

  inheritAdjacentSharedCtns(staged);

  if (options?.deferFinalize) {
    // CTNS → bultos ya aplicado; shared + consolidate en el cliente al juntar pasadas.
    return staged.map((item) => {
      const line: AldeGptTerraLine = { ...item.line };
      if (item.ctnsKey) line.ctns = item.ctnsKey;
      if (item.ctnsBultos != null && item.ctnsBultos > 0) {
        line.bultos = String(item.ctnsBultos);
      }
      return line;
    });
  }

  const withSharedCtns = assignBultosForSharedCtns(staged);

  return consolidateTerraLinesByReferencia(
    disambiguateSimilarReferencias(withSharedCtns),
  );
}

/**
 * Aplica CTNS compartidos + consolidación sobre líneas que aún traen `ctns`
 * (p. ej. tras concatenar continuaciones de extracción).
 */
export function finalizeAldeGptTerraLines(
  lines: AldeGptTerraLine[],
): AldeGptTerraLine[] {
  const staged = lines.map((line) => {
    const ctnsRaw = String(line.ctns ?? "").trim();
    const ctnsFromExplicit = Boolean(ctnsRaw);
    const ctnsBultos = ctnsRaw
      ? parseCtnsRangeToBultos(ctnsRaw, { allowSingle: ctnsFromExplicit })
      : null;
    const ctnsKey = ctnsRaw
      ? normalizeCtnsKey(ctnsRaw, { allowSingle: ctnsFromExplicit })
      : null;
    const next: AldeGptTerraLine = { ...line };
    if (ctnsBultos != null && ctnsBultos > 0) {
      next.bultos = String(ctnsBultos);
    }
    return {
      line: next,
      ctnsKey,
      ctnsBultos,
    };
  });

  inheritAdjacentSharedCtns(staged);
  const withShared = assignBultosForSharedCtns(staged);
  const finalized = consolidateTerraLinesByReferencia(
    disambiguateSimilarReferencias(withShared),
  );
  // ctns ya no hace falta en la OR.
  return finalized.map(({ ctns: _c, ...rest }) => rest);
}

function normalizeTerraRefKey(referencia?: string | null): string {
  return String(referencia ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function parseLinePieces(line: AldeGptTerraLine): number {
  const tot = Math.round(
    parseFloat(String(line.unidadesTotales ?? "").replace(",", ".")) || 0,
  );
  if (tot > 0) return tot;
  return Math.max(
    0,
    Math.round(
      parseFloat(String(line.unidadesPorBulto ?? "").replace(",", ".")) || 0,
    ),
  );
}

function parseLinePesoKg(line: AldeGptTerraLine): number {
  const totRaw = String(line.pesoTotalKg ?? "").trim();
  if (totRaw) {
    const tot = parseFloat(totRaw.replace(",", ".")) || 0;
    if (tot > 0) return tot;
  }
  const bultos = Math.round(
    parseFloat(String(line.bultos ?? "").replace(",", ".")) || 0,
  );
  const porBulto =
    parseFloat(String(line.pesoPorBulto ?? "").replace(",", ".")) || 0;
  if (porBulto > 0 && bultos > 0) return porBulto * bultos;
  if (porBulto > 0 && line.reempaque === true) return porBulto;
  return 0;
}

/** Suma pesos de factura en centésimas (evita 253.02+2.19+0.73 → 255.99 por float/redondeo). */
function sumPesoKgExact(weights: number[]): number {
  let hundredths = 0;
  for (const w of weights) {
    if (!Number.isFinite(w) || w <= 0) continue;
    hundredths += Math.round(w * 100 + Number.EPSILON);
  }
  return hundredths / 100;
}

/**
 * Misma referencia (bultos + reempaque Tango, o varias páginas): suma bultos,
 * peso y piezas. Reempaques sin pareja con bultos quedan como reempaque.
 */
export function consolidateTerraLinesByReferencia(
  lines: AldeGptTerraLine[],
): AldeGptTerraLine[] {
  const groups = new Map<string, AldeGptTerraLine[]>();
  const order: string[] = [];
  const noRef: AldeGptTerraLine[] = [];

  for (const line of lines) {
    const key = normalizeTerraRefKey(line.referencia);
    if (!key) {
      noRef.push({ ...line });
      continue;
    }
    const arr = groups.get(key);
    if (!arr) {
      groups.set(key, [line]);
      order.push(key);
    } else {
      arr.push(line);
    }
  }

  const out: AldeGptTerraLine[] = [];
  for (const key of order) {
    const group = groups.get(key)!;
    if (group.length === 1) {
      out.push({ ...group[0]! });
      continue;
    }

    let bultosSum = 0;
    let piezasSum = 0;
    const pesos: number[] = [];
    let base: AldeGptTerraLine = { ...group[0]! };

    for (const g of group) {
      const b = Math.max(
        0,
        Math.round(parseFloat(String(g.bultos ?? "").replace(",", ".")) || 0),
      );
      bultosSum += b;
      piezasSum += parseLinePieces(g);
      const p = parseLinePesoKg(g);
      if (p > 0) pesos.push(p);
      if (b > 0 && g.reempaque !== true) {
        base = { ...g };
      }
    }

    const isReempaque = bultosSum <= 0;
    const unidadesTotales = piezasSum > 0 ? String(piezasSum) : "";
    let unidadesPorBulto = "";
    if (isReempaque) {
      unidadesPorBulto = unidadesTotales;
    } else if (piezasSum > 0 && bultosSum > 0) {
      unidadesPorBulto =
        piezasSum % bultosSum === 0
          ? String(piezasSum / bultosSum)
          : "48";
    }

    const hasPeso = pesos.length > 0;
    const pesoRounded = hasPeso ? sumPesoKgExact(pesos) : 0;
    const pesoTotalKg = hasPeso
      ? preserveDocumentNumber(
          Number.isInteger(pesoRounded)
            ? String(pesoRounded)
            : pesoRounded.toFixed(2),
        )
      : "";

    out.push({
      ...base,
      referencia: String(base.referencia ?? group[0]!.referencia ?? "").trim(),
      bultos: String(bultosSum),
      reempaque: isReempaque,
      unidadesTotales,
      unidadesPorBulto,
      pesoTotalKg: isReempaque && !hasPeso ? "" : pesoTotalKg,
      pesoPorBulto:
        !isReempaque && bultosSum > 0 && hasPeso
          ? formatWeightPrecise(pesoRounded / bultosSum)
          : isReempaque
            ? ""
            : base.pesoPorBulto ?? "",
    });
  }

  return out.concat(noRef);
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
    // Diferir shared-CTNS + consolidate: el cliente concatena continuaciones y finaliza una vez.
    const lines = postProcessAldeGptTerraLines(linesRaw, { deferFinalize: true });
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
