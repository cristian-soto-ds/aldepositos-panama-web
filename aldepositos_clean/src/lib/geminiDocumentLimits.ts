/** Límites compartidos cliente/servidor para PDFs y documentos extensos con Alde.IA. */

import { countPdfPagesInText } from "@/lib/geminiPdfPageText";

export const PDF_TEXT_MIN_CHARS = 320;

/** Texto máximo razonable; el servidor parte en fragmentos sin perder el final del documento. */
export const PDF_TEXT_MAX_CHARS = 1_200_000;

/** PDF binario / imagen (multipart). Gemini acepta más; 15 MB cubre proformas pesadas. */
export const MAX_BINARY_UPLOAD_BYTES = 15 * 1024 * 1024;

export const DEFAULT_CHUNK_SIZE = 38_000;
export const DEFAULT_CHUNK_OVERLAP = 2_400;
export const DEFAULT_CHUNK_MIN_SPLIT = 14_000;
export const DEFAULT_MAX_CHUNKS = 30;
export const MAX_CHUNKS_NORMAL = 30;
export const MAX_CHUNKS_LARGO = 40;
export const MAX_CHUNKS_EXTREMO = 50;
export const MAX_CHUNKS_CAP = 50;

/** Tiempo máximo del route handler (segundos). */
export const SERVER_MAX_DURATION_S = 300;

/** Tope del fetch en el navegador (alineado al servidor). */
export const CLIENT_MAX_TIMEOUT_MS = SERVER_MAX_DURATION_S * 1000 - 2_000;

export type ProcessingTier = "normal" | "largo" | "extremo";

export type GeminiChunkConfig = {
  chunkSize: number;
  overlap: number;
  minToSplit: number;
  maxChunks: number;
};

export type DocumentProcessingMeta = {
  tier: ProcessingTier;
  maxChunks: number;
  estimatedRows: number;
  /** false si GEMINI_PDF_MAX_CHUNKS fija el tope manualmente. */
  adaptive: boolean;
  /** Códigos de producto detectados en texto PDF tras reconciliar. */
  pdfCodesFound?: number;
  /** No. de Cartones del pie de factura (si aparece). */
  cartonesFooter?: number | null;
  /** Suma de bultos en líneas finales. */
  bultosSum?: number;
  /** Origen del texto PDF usado para reconciliación. */
  pdfTextSource?: "client" | "server" | "none";
  extractionIncomplete?: boolean;
  extractionIncompleteReason?: string;
  linesWithMissingFields?: number;
};

function clampMaxChunks(n: number): number {
  return Math.max(1, Math.min(MAX_CHUNKS_CAP, n));
}

/** chunkSize / overlap / minToSplit (+ maxChunks solo si hay override en env). */
export function readGeminiChunkBaseConfig(): Omit<GeminiChunkConfig, "maxChunks"> & {
  envMaxChunks: number | null;
} {
  const chunkSize = Math.max(
    8_000,
    Number(process.env.GEMINI_PDF_TEXT_CHUNK_CHARS?.trim()) || DEFAULT_CHUNK_SIZE,
  );
  const overlap = Math.max(
    200,
    Math.min(
      Math.floor(chunkSize / 3),
      Number(process.env.GEMINI_PDF_TEXT_CHUNK_OVERLAP?.trim()) || DEFAULT_CHUNK_OVERLAP,
    ),
  );
  const minToSplit = Math.max(
    4_000,
    Number(process.env.GEMINI_PDF_TEXT_CHUNK_MIN?.trim()) || DEFAULT_CHUNK_MIN_SPLIT,
  );
  const envRaw = process.env.GEMINI_PDF_MAX_CHUNKS?.trim();
  const envMaxChunks =
    envRaw && Number.isFinite(Number(envRaw)) ? clampMaxChunks(Number(envRaw)) : null;

  return { chunkSize, overlap, minToSplit, envMaxChunks };
}

export function readGeminiChunkConfig(maxChunksOverride?: number): GeminiChunkConfig {
  const base = readGeminiChunkBaseConfig();
  const maxChunks = clampMaxChunks(
    maxChunksOverride ?? base.envMaxChunks ?? DEFAULT_MAX_CHUNKS,
  );
  return {
    chunkSize: base.chunkSize,
    overlap: base.overlap,
    minToSplit: base.minToSplit,
    maxChunks,
  };
}

/**
 * Heurística previa a Gemini: cuenta líneas que parecen filas de tabla/proforma.
 */
export function estimateDocumentRowCount(text: string): number {
  const lines = String(text ?? "").split(/\r?\n/);
  let count = 0;

  for (const line of lines) {
    const t = line.trim();
    if (t.length < 12) continue;
    if (
      /^(total|sub\s*total|totales|page|pagina|página|fecha|date|invoice|factura|proforma|packing|ship\s*to|bill\s*to)\b/i.test(
        t,
      )
    ) {
      continue;
    }

    const digitGroups = (t.match(/\d+/g) ?? []).length;
    const tabCols = t.split(/\t+/).filter(Boolean).length;
    const spacedCols = t.split(/\s{2,}/).filter(Boolean).length;
    const hasSkuish = /\b[BJ][-_]?[\w-]{4,}\b/i.test(t);

    if (digitGroups >= 2 || tabCols >= 3 || spacedCols >= 4 || (hasSkuish && digitGroups >= 1)) {
      count++;
    }
  }

  const skuHits = (String(text ?? "").match(/\b[BJ][-_][A-Z0-9]{3,}[A-Z0-9-]*\b/gi) ?? [])
    .length;
  const refHits = (String(text ?? "").match(/\bJN-\d{3,}/gi) ?? []).length;

  return Math.max(count, skuHits, refHits);
}

/** Fragmentos sin tope (solo para decidir perfil adaptativo). */
export function estimateRawChunkCount(
  textLength: number,
  config: Pick<GeminiChunkConfig, "chunkSize" | "overlap" | "minToSplit">,
): number {
  if (textLength < config.minToSplit) return 1;
  const step = Math.max(1, config.chunkSize - config.overlap);
  return Math.max(1, Math.ceil((textLength - config.overlap) / step));
}

/** Elige perfil normal (30) / largo (40) / extremo (50) según tamaño y filas estimadas. */
export function resolveAdaptiveMaxChunks(input: {
  textLength: number;
  fileSizeBytes?: number;
  estimatedRows?: number;
  chunkSize?: number;
  overlap?: number;
  minToSplit?: number;
}): { tier: ProcessingTier; maxChunks: number } {
  const chunkSize = input.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = input.overlap ?? DEFAULT_CHUNK_OVERLAP;
  const minToSplit = input.minToSplit ?? DEFAULT_CHUNK_MIN_SPLIT;
  const estimatedRows = input.estimatedRows ?? 0;
  const fileSizeBytes = input.fileSizeBytes ?? 0;

  const needed = estimateRawChunkCount(input.textLength, {
    chunkSize,
    overlap,
    minToSplit,
  });

  const isExtremo =
    needed > 35 ||
    input.textLength > 900_000 ||
    estimatedRows > 800 ||
    fileSizeBytes > 12 * 1024 * 1024;

  if (isExtremo) {
    return { tier: "extremo", maxChunks: MAX_CHUNKS_EXTREMO };
  }

  const isLargo =
    needed > 25 ||
    input.textLength > 400_000 ||
    estimatedRows > 400 ||
    fileSizeBytes > 8 * 1024 * 1024;

  if (isLargo) {
    return { tier: "largo", maxChunks: MAX_CHUNKS_LARGO };
  }

  return { tier: "normal", maxChunks: MAX_CHUNKS_NORMAL };
}

/** Config final para un documento concreto (respeta GEMINI_PDF_MAX_CHUNKS si está definido). */
export function resolveChunkConfigForDocument(input: {
  text: string;
  fileSizeBytes?: number;
}): { config: GeminiChunkConfig; meta: DocumentProcessingMeta } {
  const base = readGeminiChunkBaseConfig();
  const estimatedRows = estimateDocumentRowCount(input.text);
  const textLength = input.text.length;

  if (base.envMaxChunks != null) {
    return {
      config: {
        chunkSize: base.chunkSize,
        overlap: base.overlap,
        minToSplit: base.minToSplit,
        maxChunks: base.envMaxChunks,
      },
      meta: {
        tier:
          base.envMaxChunks >= MAX_CHUNKS_EXTREMO
            ? "extremo"
            : base.envMaxChunks >= MAX_CHUNKS_LARGO
              ? "largo"
              : "normal",
        maxChunks: base.envMaxChunks,
        estimatedRows,
        adaptive: false,
      },
    };
  }

  const { tier, maxChunks } = resolveAdaptiveMaxChunks({
    textLength,
    fileSizeBytes: input.fileSizeBytes,
    estimatedRows,
    chunkSize: base.chunkSize,
    overlap: base.overlap,
    minToSplit: base.minToSplit,
  });

  return {
    config: {
      chunkSize: base.chunkSize,
      overlap: base.overlap,
      minToSplit: base.minToSplit,
      maxChunks,
    },
    meta: {
      tier,
      maxChunks,
      estimatedRows,
      adaptive: true,
    },
  };
}

/** Estima cuántos fragmentos procesará el servidor para un texto dado. */
export function estimateChunkCount(
  textLength: number,
  config: Pick<GeminiChunkConfig, "chunkSize" | "overlap" | "minToSplit" | "maxChunks">,
): number {
  if (textLength < config.minToSplit) return 1;
  const step = Math.max(1, config.chunkSize - config.overlap);
  const raw = Math.ceil((textLength - config.overlap) / step);
  return Math.min(config.maxChunks, Math.max(1, raw));
}

/** Estima caracteres de texto en un PDF a partir del peso del archivo (para timeouts). */
export function estimateTextLengthFromPdfBytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.min(PDF_TEXT_MAX_CHARS, Math.max(0, Math.round(bytes * 0.22)));
}

/** Timeout del cliente acorde al tamaño del documento (ms). */
export function geminiClientTimeoutMs(opts: {
  pdfText?: string;
  message?: string;
  hasBinaryFile?: boolean;
  isPdf?: boolean;
  fileSizeBytes?: number;
}): number {
  const fromPdfBytes =
    opts.isPdf && opts.fileSizeBytes
      ? estimateTextLengthFromPdfBytes(opts.fileSizeBytes)
      : 0;
  const text = opts.pdfText ?? opts.message ?? "";
  const len = Math.max(text.length, fromPdfBytes);

  const syntheticText =
    len > 0 && text.length < len ? "x".repeat(Math.min(len, 12_000)) : text.length > 0 ? text : " ";

  const { config } = resolveChunkConfigForDocument({
    text: syntheticText,
    fileSizeBytes: opts.fileSizeBytes,
  });
  const chunks = estimateChunkCount(len, config);

  const pageCount = countPdfPagesInText(text);
  if (pageCount > 1) {
    const pageBased = 90_000 + pageCount * 42_000;
    const charBased =
      chunks > 1 ? 90_000 + chunks * (config.maxChunks >= MAX_CHUNKS_EXTREMO ? 42_000 : 38_000) : 0;
    return Math.min(CLIENT_MAX_TIMEOUT_MS, Math.max(180_000, pageBased, charBased));
  }

  if (opts.hasBinaryFile && chunks <= 1) {
    const sizeMb = (opts.fileSizeBytes ?? 0) / (1024 * 1024);
    const base = opts.isPdf ? 240_000 : 180_000;
    const extra =
      sizeMb > 12 ? 55_000 : sizeMb > 8 ? 40_000 : sizeMb > 4 ? 25_000 : 0;
    return Math.min(CLIENT_MAX_TIMEOUT_MS, base + extra);
  }

  if (chunks <= 1) return Math.min(CLIENT_MAX_TIMEOUT_MS, 120_000);

  const perChunkMs = config.maxChunks >= MAX_CHUNKS_EXTREMO ? 42_000 : 38_000;
  const baseMs = 90_000;
  const estimated = baseMs + chunks * perChunkMs;
  return Math.min(CLIENT_MAX_TIMEOUT_MS, Math.max(180_000, estimated));
}

/** ¿Conviene fragmentar este documento aunque el texto sea corto? */
export function shouldChunkDocumentText(text: string, minToSplit: number): boolean {
  const t = String(text ?? "");
  if (t.length >= minToSplit) return true;
  if (countPdfPagesInText(t) > 1) return true;
  if (estimateDocumentRowCount(t) > 10) return true;
  return false;
}

/** Procesa items en lotes con concurrencia limitada. */
export async function mapInBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const size = Math.max(1, batchSize);
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const batchResults = await Promise.all(
      batch.map((item, j) => fn(item, i + j)),
    );
    out.push(...batchResults);
  }
  return out;
}
