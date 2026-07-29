/**
 * Repara texto latino mal codificado (UTF-8 leído como Latin-1 / Windows-1252,
 * o con U+FFFD `` cuando se perdió una ñ/acento).
 * Pensado para marca, proveedor, cliente y campos Magaya/HTM.
 */

const REPLACEMENT = "\uFFFD";

/** Secuencias típicas de UTF-8 interpretado como Latin-1. */
const MOJIBAKE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["Ã¡", "á"],
  ["Ã©", "é"],
  ["Ã­", "í"],
  ["Ã³", "ó"],
  ["Ãº", "ú"],
  ["Ã±", "ñ"],
  ["Ã‘", "Ñ"],
  ["Ã", "Á"],
  ["Ã‰", "É"],
  ["Ã", "Í"],
  ["Ã“", "Ó"],
  ["Ãš", "Ú"],
  ["Ã¼", "ü"],
  ["Ãœ", "Ü"],
  ["Â¿", "¿"],
  ["Â¡", "¡"],
  ["Âº", "º"],
  ["Âª", "ª"],
  ["â€™", "'"],
  ["â€œ", '"'],
  ["â€", '"'],
  ["â€“", "–"],
  ["â€”", "—"],
  ["ï¿½", REPLACEMENT],
];

type CaseForms = { upper: string; lower: string; title: string };

/** Patrones frecuentes donde `` era casi seguro «ñ» (marcas / español almacén). */
const NN_CONTEXT_FIXES: ReadonlyArray<{ re: RegExp; forms: CaseForms }> = [
  { re: /\bNI\uFFFDOS\b/gi, forms: { upper: "NIÑOS", lower: "niños", title: "Niños" } },
  { re: /\bNI\uFFFDAS\b/gi, forms: { upper: "NIÑAS", lower: "niñas", title: "Niñas" } },
  { re: /\bA\uFFFDO\b/gi, forms: { upper: "AÑO", lower: "año", title: "Año" } },
  { re: /\bA\uFFFDOS\b/gi, forms: { upper: "AÑOS", lower: "años", title: "Años" } },
  {
    re: /\bSE\uFFFDOR\b/gi,
    forms: { upper: "SEÑOR", lower: "señor", title: "Señor" },
  },
  {
    re: /\bSE\uFFFDORA\b/gi,
    forms: { upper: "SEÑORA", lower: "señora", title: "Señora" },
  },
  {
    re: /\bCOMPA\uFFFDA\b/gi,
    forms: { upper: "COMPAÑÍA", lower: "compañía", title: "Compañía" },
  },
  {
    re: /\bCOMPA\uFFFD[IÍií]A\b/gi,
    forms: { upper: "COMPAÑÍA", lower: "compañía", title: "Compañía" },
  },
  {
    re: /\bESPA\uFFFDA\b/gi,
    forms: { upper: "ESPAÑA", lower: "españa", title: "España" },
  },
  {
    re: /\bESPA\uFFFDOL\b/gi,
    forms: { upper: "ESPAÑOL", lower: "español", title: "Español" },
  },
  {
    re: /\bESPA\uFFFDOLA\b/gi,
    forms: { upper: "ESPAÑOLA", lower: "española", title: "Española" },
  },
];

function looksLikeMojibake(s: string): boolean {
  return /Ã[\u0080-\u00FF]|Â[\u0080-\u00FF]|â€|ï¿½/.test(s);
}

/**
 * Reinterpreta code units Latin-1 (0–255) como UTF-8.
 * Corrige p. ej. "NIÃ±OS" → "NIÑOS".
 */
function reinterpretLatin1AsUtf8(s: string): string | null {
  if (!looksLikeMojibake(s)) return null;
  try {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c > 255) return null;
      bytes[i] = c;
    }
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!decoded || decoded.includes(REPLACEMENT)) return null;
    return decoded;
  } catch {
    return null;
  }
}

function applyMojibakePairs(s: string): string {
  let out = s;
  for (const [bad, good] of MOJIBAKE_PAIRS) {
    if (out.includes(bad)) out = out.split(bad).join(good);
  }
  return out;
}

function matchCase(sample: string, forms: CaseForms): string {
  if (sample === sample.toUpperCase()) return forms.upper;
  if (sample === sample.toLowerCase()) return forms.lower;
  return forms.title;
}

function applySpanishReplacementHeuristics(s: string): string {
  if (!s.includes(REPLACEMENT)) return s;
  let out = s;

  for (const fix of NN_CONTEXT_FIXES) {
    out = out.replace(fix.re, (m) => matchCase(m, fix.forms));
  }

  // Heurística: letra + � + vocal → ñ (ej. CA�A, NI�O suelto).
  out = out.replace(
    /([A-Za-zÁÉÍÓÚÜáéíóúüÑñ])\uFFFD([AEIOUÁÉÍÓÚaeiouáéíóú])/g,
    (_full, a: string, b: string) => {
      const nn =
        a === a.toUpperCase() && b === b.toUpperCase() ? "Ñ" : "ñ";
      return `${a}${nn}${b}`;
    },
  );

  // Residuos de ``: no mostrar el rombo.
  out = out.split(REPLACEMENT).join("");
  return out;
}

/** En marcas en MAYÚSCULAS, `ñ` entre mayúsculas → `Ñ` (NIñOS → NIÑOS). */
function promoteNnInUppercaseContext(s: string): string {
  return s
    .replace(/([A-ZÁÉÍÓÚÜ])ñ([A-ZÁÉÍÓÚÜ])/g, "$1Ñ$2")
    .replace(/([A-ZÁÉÍÓÚÜ])ñ(?=\s|$|[—\-.,;:/])/g, "$1Ñ")
    .replace(/(?<=\s|^|[—\-])ñ([A-ZÁÉÍÓÚÜ])/g, "Ñ$1");
}

/**
 * Normaliza un string de UI/importación: mojibake + heurísticas de ñ.
 * Idempotente: texto ya correcto no cambia.
 */
export function repairLatinText(raw: unknown): string {
  const s = String(raw ?? "");
  if (!s) return "";

  let out = s;
  const reinterpreted = reinterpretLatin1AsUtf8(out);
  if (reinterpreted) out = reinterpreted;
  out = applyMojibakePairs(out);
  out = applySpanishReplacementHeuristics(out);
  out = promoteNnInUppercaseContext(out);
  return out;
}

/** Elige la decodificación con menos `` y más letras españolas típicas. */
export function pickBestDecodedText(candidates: string[]): string {
  if (candidates.length === 0) return "";
  let best = repairLatinText(candidates[0]!);
  let bestScore = -Infinity;
  for (const c of candidates) {
    const repaired = repairLatinText(c);
    const replacements = (repaired.match(/\uFFFD/g) ?? []).length;
    const spanish = (repaired.match(/[áéíóúñÁÉÍÓÚÑ¿¡]/g) ?? []).length;
    const score = spanish * 3 - replacements * 10;
    if (score > bestScore) {
      bestScore = score;
      best = repaired;
    }
  }
  return best;
}

/**
 * Lee un archivo de texto (HTM Magaya, etc.) probando UTF-8 y Windows-1252.
 */
export async function readTextFileRepairingEncoding(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  let cp1252 = utf8;
  try {
    cp1252 = new TextDecoder("windows-1252").decode(buf);
  } catch {
    /* keep utf8 */
  }
  return pickBestDecodedText([utf8, cp1252]);
}
