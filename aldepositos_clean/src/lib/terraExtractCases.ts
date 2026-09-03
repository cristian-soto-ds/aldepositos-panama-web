import { supabase } from "@/lib/supabase";
import type { AldeGptTerraLine } from "@/lib/aldeGptTerraDocumentExtract";
import {
  buildOkLearningNote,
  insertTerraLearningNote,
} from "@/lib/terraLearningNotes";

export const TERRA_EXTRACT_CASES_TABLE = "terra_extract_cases";
export const TERRA_EXTRACT_CASES_BUCKET = "terra-extract-cases";

export type TerraExtractCaseStatus = "ok" | "failed" | "resolved";

export type TerraExtractCase = {
  id: string;
  user_id: string;
  collection_order_id: string | null;
  order_numero: string | null;
  proveedor: string | null;
  cliente: string | null;
  model: string;
  extract_mode: string;
  status: TerraExtractCaseStatus;
  note: string;
  lines_snapshot: AldeGptTerraLine[] | unknown;
  file_names: string[];
  storage_paths: string[];
  learning_note_id: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type CreateTerraExtractCaseInput = {
  collectionOrderId?: string | null;
  orderNumero?: string | null;
  proveedor?: string | null;
  cliente?: string | null;
  model?: string;
  extractMode?: string;
  status: TerraExtractCaseStatus;
  note?: string;
  linesSnapshot?: AldeGptTerraLine[] | unknown[];
  files?: File[];
  fileNames?: string[];
  /** Si true (status ok), crea regla de aprendizaje automática. */
  createLearningNote?: boolean;
};

const MAX_FILE_BYTES = 40 * 1024 * 1024;
const ACCEPT_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

function sanitizeFilename(name: string): string {
  const base = (name || "documento").replace(/[^\w.\-()+ ]+/g, "_").slice(0, 160);
  const lastDot = base.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === base.length - 1) return base || "documento";
  return `${base.slice(0, lastDot)}${base.slice(lastDot).toLowerCase()}`;
}

function newCaseId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function listTerraExtractCases(opts?: {
  status?: TerraExtractCaseStatus | "all";
  limit?: number;
}): Promise<TerraExtractCase[]> {
  const limit = opts?.limit ?? 80;
  let q = supabase
    .from(TERRA_EXTRACT_CASES_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (opts?.status && opts.status !== "all") {
    q = q.eq("status", opts.status);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as TerraExtractCase[];
}

async function uploadCaseFiles(
  userId: string,
  caseId: string,
  files: File[],
): Promise<{ fileNames: string[]; storagePaths: string[] }> {
  const fileNames: string[] = [];
  const storagePaths: string[] = [];

  for (const file of files) {
    if (file.size <= 0) continue;
    if (file.size > MAX_FILE_BYTES) {
      throw new Error(
        `"${file.name}" supera ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB.`,
      );
    }
    const mime = (file.type || "").toLowerCase();
    if (mime && !ACCEPT_MIME.has(mime)) {
      throw new Error(
        `"${file.name}": tipo no permitido. Usa PDF, PNG, JPEG o WebP.`,
      );
    }
    const safe = sanitizeFilename(file.name);
    const path = `${userId}/${caseId}/${safe}`;
    const { error } = await supabase.storage
      .from(TERRA_EXTRACT_CASES_BUCKET)
      .upload(path, file, {
        contentType: mime || undefined,
        upsert: false,
      });
    if (error) throw error;
    fileNames.push(safe);
    storagePaths.push(path);
  }

  return { fileNames, storagePaths };
}

export async function createTerraExtractCase(
  input: CreateTerraExtractCaseInput,
): Promise<TerraExtractCase> {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) throw new Error("Sesión expirada. Vuelve a iniciar sesión.");

  const status = input.status;
  const note = String(input.note ?? "").trim().slice(0, 4000);
  if (status === "failed" && !note) {
    throw new Error("Indicá en la nota qué falló en la extracción.");
  }

  const caseId = newCaseId();
  const files = input.files ?? [];
  let fileNames = [...(input.fileNames ?? [])];
  let storagePaths: string[] = [];

  if (files.length > 0) {
    const uploaded = await uploadCaseFiles(user.id, caseId, files);
    fileNames = uploaded.fileNames;
    storagePaths = uploaded.storagePaths;
  }

  let learningNoteId: string | null = null;
  if (input.createLearningNote || status === "ok") {
    const body = buildOkLearningNote({
      orderNumero: input.orderNumero,
      proveedor: input.proveedor,
      cliente: input.cliente,
      lineCount: Array.isArray(input.linesSnapshot)
        ? input.linesSnapshot.length
        : 0,
    });
    try {
      const inserted = await insertTerraLearningNote(body);
      learningNoteId = inserted.id;
    } catch (e) {
      console.warn("[terra_extract_cases] No se pudo guardar regla:", e);
    }
  }

  const row = {
    id: caseId,
    user_id: user.id,
    collection_order_id: input.collectionOrderId ?? null,
    order_numero: input.orderNumero ?? null,
    proveedor: input.proveedor ?? null,
    cliente: input.cliente ?? null,
    model: input.model ?? "terra",
    extract_mode: input.extractMode ?? "full",
    status,
    note: note || (status === "ok" ? "Extracción verificada como correcta." : ""),
    lines_snapshot: input.linesSnapshot ?? [],
    file_names: fileNames,
    storage_paths: storagePaths,
    learning_note_id: learningNoteId,
    resolved_at: status === "resolved" ? new Date().toISOString() : null,
  };

  const { data, error } = await supabase
    .from(TERRA_EXTRACT_CASES_TABLE)
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as TerraExtractCase;
}

export async function resolveTerraExtractCase(input: {
  caseId: string;
  resolutionNote?: string;
  learningRule?: string;
}): Promise<TerraExtractCase> {
  let learningNoteId: string | null = null;
  const rule = String(input.learningRule ?? "").trim().slice(0, 2000);
  if (rule) {
    const inserted = await insertTerraLearningNote(rule);
    learningNoteId = inserted.id;
  }

  const patch: Record<string, unknown> = {
    status: "resolved",
    resolved_at: new Date().toISOString(),
  };
  if (learningNoteId) patch.learning_note_id = learningNoteId;

  const extra = String(input.resolutionNote ?? "").trim().slice(0, 2000);
  if (extra) {
    const { data: existing } = await supabase
      .from(TERRA_EXTRACT_CASES_TABLE)
      .select("note")
      .eq("id", input.caseId)
      .maybeSingle();
    const prev = String((existing as { note?: string } | null)?.note ?? "").trim();
    patch.note = prev
      ? `${prev}\n\n— Resuelto: ${extra}`.slice(0, 4000)
      : `Resuelto: ${extra}`.slice(0, 4000);
  }

  const { data, error } = await supabase
    .from(TERRA_EXTRACT_CASES_TABLE)
    .update(patch)
    .eq("id", input.caseId)
    .select("*")
    .single();
  if (error) throw error;
  return data as TerraExtractCase;
}

export async function getTerraExtractCaseSignedUrl(
  storagePath: string,
  expiresInSec = 3600,
): Promise<string> {
  const path = String(storagePath ?? "").trim();
  if (!path) throw new Error("Sin ruta de archivo.");
  const { data, error } = await supabase.storage
    .from(TERRA_EXTRACT_CASES_BUCKET)
    .createSignedUrl(path, expiresInSec);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("No se pudo generar el enlace.");
  return data.signedUrl;
}

export async function deleteTerraExtractCase(caseId: string): Promise<void> {
  const { data: row } = await supabase
    .from(TERRA_EXTRACT_CASES_TABLE)
    .select("storage_paths")
    .eq("id", caseId)
    .maybeSingle();

  const paths = ((row as { storage_paths?: string[] } | null)?.storage_paths ??
    []) as string[];
  if (paths.length > 0) {
    await supabase.storage.from(TERRA_EXTRACT_CASES_BUCKET).remove(paths);
  }

  const { error } = await supabase
    .from(TERRA_EXTRACT_CASES_TABLE)
    .delete()
    .eq("id", caseId);
  if (error) throw error;
}
