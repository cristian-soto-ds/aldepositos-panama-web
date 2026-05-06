import type {
  CollectionGeminiApiResponse,
  CollectionGeminiLine,
} from "@/lib/collectionOrderGeminiSchema";

function normalizeParsedShape(candidate: unknown): CollectionGeminiApiResponse | null {
  if (!candidate || typeof candidate !== "object") return null;
  const o = candidate as Record<string, unknown>;
  const linesRaw = o.lines;
  const replyRaw = o.reply;
  if (!Array.isArray(linesRaw)) return null;
  const reply =
    typeof replyRaw === "string"
      ? replyRaw
      : replyRaw === null || replyRaw === undefined
        ? ""
        : String(replyRaw);
  return {
    reply,
    lines: linesRaw as CollectionGeminiLine[],
  };
}

/**
 * Quita ```json … ``` que a veces añade el modelo a pesar del schema.
 */
function stripMarkdownJsonFence(raw: string): string {
  let s = raw.trim();
  const full = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/im.exec(s);
  if (full) return full[1]?.trim() ?? s;

  const start = s.search(/```(?:json)?\s*\n?/i);
  if (start !== -1) {
    let inner = s.slice(start).replace(/^```(?:json)?\s*/i, "");
    const endFence = inner.lastIndexOf("```");
    if (endFence !== -1) inner = inner.slice(0, endFence);
    s = inner.trim();
  }
  return s.trim();
}

/**
 * Extrae el primer objeto `{ ... }` balanceado respecto a comillas JSON.
 */
function extractBalancedJsonObject(input: string): string | null {
  const start = input.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < input.length; i++) {
    const c = input[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }

    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        return input.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Repara algunos errores triviales antes de JSON.parse.
 */
function jsonLooseRepair(s: string): string {
  return s
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

/** Intenta parsear la respuesta del modelo hasta obtener reply + lines */
export function parseCollectionGeminiModelText(
  raw: string | undefined | null,
): { parsed: CollectionGeminiApiResponse; strategy: string } | null {
  if (raw == null || typeof raw !== "string") return null;

  const candidates = [
    jsonLooseRepair(raw),
    jsonLooseRepair(stripMarkdownJsonFence(raw)),
  ];

  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if (!c || seen.has(c)) return false;
    seen.add(c);
    return true;
  });

  for (const attempt of unique) {
    try {
      const shaped = normalizeParsedShape(JSON.parse(attempt));
      if (shaped) return { parsed: shaped, strategy: "direct" };
    } catch {
      /* next */
    }
  }

  const extracted = extractBalancedJsonObject(stripMarkdownJsonFence(raw));
  if (extracted) {
    try {
      const shaped = normalizeParsedShape(JSON.parse(extracted));
      if (shaped) return { parsed: shaped, strategy: "extract_object" };
    } catch {
      /* fail */
    }
  }

  return null;
}
