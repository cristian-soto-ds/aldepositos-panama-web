import { supabase } from "@/lib/supabase";

/**
 * Catálogo maestro `public.reference_catalog` (Supabase).
 * Los formularios usan `referencia`, `l`/`w`/`h`, etc.; `buildMeasurePatchFromCatalog` traduce.
 */
export type ReferenceCatalogItem = {
  numero_parte: string;
  numero_parte_normalizado: string;
  descripcion: string | null;
  piezas: number | null;
  longitud_cm: number | null;
  altura_cm: number | null;
  ancho_cm: number | null;
  peso_por_pieza_kg: number | null;
  volumen_m3: number | null;
  unidad: string | null;
};

type ReferenceCatalogRow = {
  numero_parte: string;
  numero_parte_normalizado: string;
  descripcion: string | null;
  piezas: number | null;
  longitud_cm: string | number | null;
  altura_cm: string | number | null;
  ancho_cm: string | number | null;
  peso_por_pieza_kg: string | number | null;
  volumen_m3: string | number | null;
  unidad: string | null;
};

export function normalizePartNumber(value: string | null | undefined): string {
  if (value == null) return "";
  return String(value).trim().toUpperCase();
}

function parseNumeric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function formatCatalogNumber(value: number | null): string {
  if (value === null) return "";
  return String(value);
}

function mapRow(row: ReferenceCatalogRow): ReferenceCatalogItem {
  return {
    numero_parte: row.numero_parte,
    numero_parte_normalizado: row.numero_parte_normalizado,
    descripcion: row.descripcion,
    piezas: row.piezas,
    longitud_cm: parseNumeric(row.longitud_cm),
    altura_cm: parseNumeric(row.altura_cm),
    ancho_cm: parseNumeric(row.ancho_cm),
    peso_por_pieza_kg: parseNumeric(row.peso_por_pieza_kg),
    volumen_m3: parseNumeric(row.volumen_m3),
    unidad: row.unidad,
  };
}

/**
 * Busca por `numero_parte_normalizado`. Errores → null (sin lanzar).
 */
export async function getReferenceCatalogItem(
  numeroParte: string,
): Promise<ReferenceCatalogItem | null> {
  const key = normalizePartNumber(numeroParte);
  if (!key) return null;

  try {
    const { data, error } = await supabase
      .from("reference_catalog")
      .select(
        "numero_parte, numero_parte_normalizado, descripcion, piezas, longitud_cm, altura_cm, ancho_cm, peso_por_pieza_kg, volumen_m3, unidad",
      )
      .eq("numero_parte_normalizado", key)
      .maybeSingle();

    if (error) {
      console.warn("[reference_catalog] getReferenceCatalogItem:", error.message);
      return null;
    }
    if (!data) return null;
    return mapRow(data as ReferenceCatalogRow);
  } catch (e) {
    console.warn("[reference_catalog] getReferenceCatalogItem:", e);
    return null;
  }
}

/**
 * Evita insertar duplicados por clave normalizada.
 * `excludeId`: al editar, ignorar la fila actual.
 */
export async function referenceCatalogNormalizedExists(
  numeroParteNormalizado: string,
  options?: { excludeId?: string },
): Promise<boolean> {
  const key = normalizePartNumber(numeroParteNormalizado);
  if (!key) return false;

  try {
    let q = supabase
      .from("reference_catalog")
      .select("id")
      .eq("numero_parte_normalizado", key);
    const ex = options?.excludeId;
    if (ex) q = q.neq("id", ex);
    const { data, error } = await q.maybeSingle();

    if (error) {
      console.warn(
        "[reference_catalog] referenceCatalogNormalizedExists:",
        error.message,
      );
      return false;
    }
    return data != null;
  } catch (e) {
    console.warn("[reference_catalog] referenceCatalogNormalizedExists:", e);
    return false;
  }
}

/** Fila completa desde la base (módulo de administración). */
export type ReferenceCatalogRecord = ReferenceCatalogItem & {
  id: string;
  created_at: string;
  updated_at: string;
};

type ReferenceCatalogDbRow = ReferenceCatalogRow & {
  id: string;
  created_at: string;
  updated_at: string;
};

function mapDbRow(row: ReferenceCatalogDbRow): ReferenceCatalogRecord {
  const base = mapRow(row);
  return {
    ...base,
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function ilikeSearchPattern(raw: string): string | null {
  const t = raw
    .trim()
    .replace(/%/g, "")
    .replace(/_/g, "")
    .replace(/,/g, "");
  if (!t) return null;
  return `%${t}%`;
}

export async function fetchReferenceCatalogPage(opts: {
  search: string;
  page: number;
  pageSize: number;
}): Promise<{ rows: ReferenceCatalogRecord[]; total: number }> {
  const pageSize = Math.min(Math.max(opts.pageSize, 5), 200);
  const page = Math.max(opts.page, 0);
  const from = page * pageSize;
  const to = from + pageSize - 1;

  try {
    let query = supabase
      .from("reference_catalog")
      .select("*", { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(from, to);

    const pattern = ilikeSearchPattern(opts.search);
    if (pattern) {
      const q = `"${pattern.replace(/"/g, '""')}"`;
      query = query.or(
        `numero_parte.ilike.${q},numero_parte_normalizado.ilike.${q},descripcion.ilike.${q}`,
      );
    }

    const { data, error, count } = await query;

    if (error) {
      console.warn("[reference_catalog] fetchReferenceCatalogPage:", error.message);
      return { rows: [], total: 0 };
    }

    const rows = (data ?? []).map((r) => mapDbRow(r as ReferenceCatalogDbRow));
    return { rows, total: count ?? rows.length };
  } catch (e) {
    console.warn("[reference_catalog] fetchReferenceCatalogPage:", e);
    return { rows: [], total: 0 };
  }
}

export type ReferenceCatalogSaveInput = {
  numero_parte: string;
  descripcion: string;
  piezas: string;
  longitud_cm: string;
  altura_cm: string;
  ancho_cm: string;
  peso_por_pieza_kg: string;
  volumen_m3: string;
  unidad: string;
};

function parseOptionalInt(s: string): number | null {
  const t = String(s ?? "").trim();
  if (!t) return null;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalFloat(s: string): number | null {
  const t = String(s ?? "").trim().replace(",", ".");
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function toInsertPayload(input: ReferenceCatalogSaveInput) {
  const norm = normalizePartNumber(input.numero_parte);
  return {
    numero_parte: String(input.numero_parte ?? "").trim(),
    numero_parte_normalizado: norm,
    descripcion: input.descripcion.trim() || null,
    piezas: parseOptionalInt(input.piezas),
    longitud_cm: parseOptionalFloat(input.longitud_cm),
    altura_cm: parseOptionalFloat(input.altura_cm),
    ancho_cm: parseOptionalFloat(input.ancho_cm),
    peso_por_pieza_kg: parseOptionalFloat(input.peso_por_pieza_kg),
    volumen_m3: parseOptionalFloat(input.volumen_m3),
    unidad: input.unidad.trim() || null,
  };
}

export type ReferenceCatalogSaveResult =
  | { ok: true }
  | { ok: false; message: string };

export async function insertReferenceCatalogRow(
  input: ReferenceCatalogSaveInput,
): Promise<ReferenceCatalogSaveResult> {
  const payload = toInsertPayload(input);
  if (!payload.numero_parte_normalizado) {
    return { ok: false, message: "El número de parte es obligatorio." };
  }

  const dup = await referenceCatalogNormalizedExists(
    payload.numero_parte_normalizado,
  );
  if (dup) {
    return {
      ok: false,
      message: "Ya existe una referencia con esa clave normalizada.",
    };
  }

  try {
    const { error } = await supabase.from("reference_catalog").insert(payload);
    if (error) {
      console.warn("[reference_catalog] insert:", error.message);
      if (error.code === "23505") {
        return {
          ok: false,
          message: "Ya existe una referencia con esa clave normalizada.",
        };
      }
      return { ok: false, message: error.message || "No se pudo guardar." };
    }
    return { ok: true };
  } catch (e) {
    console.warn("[reference_catalog] insert:", e);
    return { ok: false, message: "Error de red o servidor." };
  }
}

export async function updateReferenceCatalogRow(
  id: string,
  input: ReferenceCatalogSaveInput,
): Promise<ReferenceCatalogSaveResult> {
  const payload = toInsertPayload(input);
  if (!payload.numero_parte_normalizado) {
    return { ok: false, message: "El número de parte es obligatorio." };
  }

  const dup = await referenceCatalogNormalizedExists(
    payload.numero_parte_normalizado,
    { excludeId: id },
  );
  if (dup) {
    return {
      ok: false,
      message: "Otra fila ya usa esa clave normalizada.",
    };
  }

  try {
    const { error } = await supabase
      .from("reference_catalog")
      .update({
        ...payload,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      console.warn("[reference_catalog] update:", error.message);
      if (error.code === "23505") {
        return {
          ok: false,
          message: "Otra fila ya usa esa clave normalizada.",
        };
      }
      return { ok: false, message: error.message || "No se pudo actualizar." };
    }
    return { ok: true };
  } catch (e) {
    console.warn("[reference_catalog] update:", e);
    return { ok: false, message: "Error de red o servidor." };
  }
}

export async function deleteReferenceCatalogRow(
  id: string,
): Promise<ReferenceCatalogSaveResult> {
  try {
    const { error } = await supabase.from("reference_catalog").delete().eq("id", id);
    if (error) {
      console.warn("[reference_catalog] delete:", error.message);
      return { ok: false, message: error.message || "No se pudo eliminar." };
    }
    return { ok: true };
  } catch (e) {
    console.warn("[reference_catalog] delete:", e);
    return { ok: false, message: "Error de red o servidor." };
  }
}

export function referenceRecordToForm(r: ReferenceCatalogRecord): ReferenceCatalogSaveInput {
  return {
    numero_parte: r.numero_parte,
    descripcion: r.descripcion ?? "",
    piezas: r.piezas != null ? String(r.piezas) : "",
    longitud_cm: r.longitud_cm != null ? String(r.longitud_cm) : "",
    altura_cm: r.altura_cm != null ? String(r.altura_cm) : "",
    ancho_cm: r.ancho_cm != null ? String(r.ancho_cm) : "",
    peso_por_pieza_kg:
      r.peso_por_pieza_kg != null ? String(r.peso_por_pieza_kg) : "",
    volumen_m3: r.volumen_m3 != null ? String(r.volumen_m3) : "",
    unidad: r.unidad ?? "",
  };
}

export const REFERENCE_CATALOG_EMPTY_FORM: ReferenceCatalogSaveInput = {
  numero_parte: "",
  descripcion: "",
  piezas: "",
  longitud_cm: "",
  altura_cm: "",
  ancho_cm: "",
  peso_por_pieza_kg: "",
  volumen_m3: "",
  unidad: "",
};

export type InventoryCatalogModule = "quick" | "airway" | "detailed";

/**
 * Parche para fusionar en una fila: longitud→l, ancho→w, altura→h.
 */
export function buildMeasurePatchFromCatalog(
  moduleType: InventoryCatalogModule,
  item: ReferenceCatalogItem,
): Record<string, string> {
  const descripcion = item.descripcion ?? "";
  const unidad = item.unidad ?? "";
  const volumenM3 = formatCatalogNumber(item.volumen_m3);

  const base: Record<string, string> = {
    referencia: item.numero_parte,
    descripcion,
    l: formatCatalogNumber(item.longitud_cm),
    w: formatCatalogNumber(item.ancho_cm),
    h: formatCatalogNumber(item.altura_cm),
    volumenM3,
    unidad,
  };

  if (moduleType === "detailed") {
    const patch: Record<string, string> = {
      ...base,
      pesoPorBulto: formatCatalogNumber(item.peso_por_pieza_kg),
    };
    if (item.piezas != null) {
      patch.unidadesPorBulto = String(item.piezas);
    }
    return patch;
  }

  return {
    ...base,
    weight: formatCatalogNumber(item.peso_por_pieza_kg),
  };
}
