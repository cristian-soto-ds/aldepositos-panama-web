/**
 * Importación de órdenes de recolección desde documento HTM / HTML (Magaya «CARGA POR LLEGAR»).
 * Campos: Número, Nombre Expedidor, Nombre Consignatario, Piezas, Peso (kg), Volumen (m³), Nombre Proveedor
 */

import type { CollectionOrder, CollectionOrderLine } from "@/lib/types/collectionOrder";

export type ParsedOrHtmRow = {
  numero: string;
  expedidor: string;
  cliente: string;
  proveedor: string;
  piezas: number;
  pesoKg: number;
  volumenM3: number;
  fechaEntrega?: string;
};

export type ParseCollectionOrdersHtmResult = {
  orders: ParsedOrHtmRow[];
  clienteGlobal?: string;
  error?: string;
};

type FieldKey =
  | "numero"
  | "expedidor"
  | "cliente"
  | "proveedor"
  | "piezas"
  | "peso"
  | "volumen"
  | "fecha";

/** Sin alias cortos tipo «no» / «or» — evitan confundir «Nombre …» con «Número». */
const FIELD_ALIASES: Record<FieldKey, string[]> = {
  numero: ["numero", "número", "n°", "nº", "no.", "nro.", "nro"],
  expedidor: ["nombre expedidor", "expedidor"],
  cliente: [
    "nombre consignatario",
    "consignatario",
    "cliente / consignatario",
    "cliente consignatario",
  ],
  proveedor: ["nombre proveedor", "proveedor"],
  piezas: ["piezas", "bultos", "cantidad"],
  peso: ["peso (kg)", "peso kg", "peso total (kg)", "peso total", "peso"],
  volumen: [
    "volumen (m³)",
    "volumen (m3)",
    "volumen m3",
    "volumen total (m³)",
    "volumen total",
    "volumen",
    "cbm",
  ],
  fecha: ["fecha de entrega", "fecha entrega", "fecha"],
};

function normLabel(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cellText(el: Element | null | undefined): string {
  if (!el) return "";
  return (el.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNum(raw: string): number {
  const cleaned = raw
    .replace(/\u00a0/g, " ")
    .replace(/[^\d,.\-]/g, "")
    .replace(/\.(?=.*\.)/g, "")
    .replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Mejor coincidencia por alias más largo (evita «no» dentro de «nombre»). */
function matchField(label: string): FieldKey | null {
  const n = normLabel(label);
  if (!n) return null;

  let bestKey: FieldKey | null = null;
  let bestLen = 0;

  for (const key of Object.keys(FIELD_ALIASES) as FieldKey[]) {
    for (const alias of FIELD_ALIASES[key]) {
      const a = normLabel(alias);
      if (!a) continue;
      if (n === a) return key;
      if (n.includes(a) && a.length > bestLen) {
        bestKey = key;
        bestLen = a.length;
      }
    }
  }
  return bestKey;
}

/** Número de OR Magaya: típicamente 3–6 dígitos (ej. 2677). */
export function isValidOrNumero(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  return /^\d{1,10}$/.test(s);
}

/** Clave normalizada para comparar números OR (evita duplicados al importar HTM). */
export function normalizeOrNumero(numero: string | undefined): string {
  return String(numero ?? "").trim().toLowerCase();
}

/**
 * Filtra órdenes HTM que ya existen (por número OR) o repetidas en el mismo lote.
 * Solo devuelve las que deben crearse.
 */
export function filterNewHtmCollectionOrders(
  incoming: CollectionOrder[],
  existing: CollectionOrder[],
): { toCreate: CollectionOrder[]; skippedNumeros: string[] } {
  const seen = new Set<string>();
  for (const o of existing) {
    const n = normalizeOrNumero(o.numero);
    if (n) seen.add(n);
  }

  const toCreate: CollectionOrder[] = [];
  const skippedNumeros: string[] = [];

  for (const o of incoming) {
    const n = normalizeOrNumero(o.numero);
    if (n && seen.has(n)) {
      skippedNumeros.push(String(o.numero ?? "").trim() || n);
      continue;
    }
    if (n) seen.add(n);
    toCreate.push(o);
  }

  return { toCreate, skippedNumeros };
}

/**
 * Plan de importación HTM comparando contra las órdenes existentes:
 * - toCreate: órdenes nuevas (número OR no existe todavía).
 * - toUpdate: órdenes que ya existen pero cuyo documento trae cambios
 *   (proveedor, cliente, expedidor, fecha, bultos, peso o cubicaje).
 *   Se conservan las líneas, estado, RAs vinculados e id del operador.
 * - unchangedNumeros: existentes sin cambios respecto al documento.
 */
export type HtmImportPlan = {
  toCreate: CollectionOrder[];
  toUpdate: CollectionOrder[];
  unchangedNumeros: string[];
};

function docStr(v: unknown): string {
  return String(v ?? "").trim();
}

function docNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Fusiona los totales/encabezado del documento sobre una orden existente.
 * Solo aplica campos que el documento realmente provee (no borra datos con vacíos).
 */
function mergeHtmDocumentIntoExisting(
  existing: CollectionOrder,
  incoming: CollectionOrder,
): { merged: CollectionOrder; changed: boolean } {
  const merged: CollectionOrder = { ...existing };
  let changed = false;

  const proveedor = docStr(incoming.proveedor);
  if (proveedor && proveedor !== docStr(existing.proveedor)) {
    merged.proveedor = proveedor;
    changed = true;
  }
  const cliente = docStr(incoming.cliente);
  if (cliente && cliente !== docStr(existing.cliente)) {
    merged.cliente = cliente;
    changed = true;
  }
  const expedidor = docStr(incoming.expedidor);
  if (expedidor && expedidor !== docStr(existing.expedidor)) {
    merged.expedidor = expedidor;
    changed = true;
  }
  const fechaEntrega = docStr(incoming.fechaEntrega);
  if (fechaEntrega && fechaEntrega !== docStr(existing.fechaEntrega)) {
    merged.fechaEntrega = fechaEntrega;
    changed = true;
  }

  const bultos = docNum(incoming.expectedBultos);
  if (bultos !== undefined && bultos !== docNum(existing.expectedBultos)) {
    merged.expectedBultos = bultos;
    changed = true;
  }
  const peso = docNum(incoming.expectedPesoKg);
  if (peso !== undefined && peso !== docNum(existing.expectedPesoKg)) {
    merged.expectedPesoKg = peso;
    changed = true;
  }
  const cbm = docNum(incoming.expectedCbm);
  if (cbm !== undefined && cbm !== docNum(existing.expectedCbm)) {
    merged.expectedCbm = cbm;
    changed = true;
  }

  if (changed) merged.updatedAt = new Date().toISOString();
  return { merged, changed };
}

export function classifyHtmCollectionOrders(
  incoming: CollectionOrder[],
  existing: CollectionOrder[],
): HtmImportPlan {
  const existingByNumero = new Map<string, CollectionOrder>();
  for (const o of existing) {
    const n = normalizeOrNumero(o.numero);
    if (n) existingByNumero.set(n, o);
  }

  const seenIncoming = new Set<string>();
  const toCreate: CollectionOrder[] = [];
  const toUpdate: CollectionOrder[] = [];
  const unchangedNumeros: string[] = [];

  for (const o of incoming) {
    const n = normalizeOrNumero(o.numero);
    if (n && seenIncoming.has(n)) continue;
    if (n) seenIncoming.add(n);

    const existingOrder = n ? existingByNumero.get(n) : undefined;
    if (!existingOrder) {
      toCreate.push(o);
      continue;
    }

    const { merged, changed } = mergeHtmDocumentIntoExisting(existingOrder, o);
    if (changed) toUpdate.push(merged);
    else unchangedNumeros.push(String(o.numero ?? "").trim() || n);
  }

  return { toCreate, toUpdate, unchangedNumeros };
}

function isGroupHeaderText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const n = normLabel(t);
  if (n === "total" || n === "totales" || n.startsWith("total ")) return true;
  if (/\(\d+\)\s*$/.test(t) && !/^\d+$/.test(t)) return true;
  return false;
}

function isSkippableDataRow(cells: string[]): boolean {
  const nonEmpty = cells.filter((c) => c.trim().length > 0);
  if (nonEmpty.length === 0) return true;
  if (nonEmpty.length === 1 && isGroupHeaderText(nonEmpty[0]!)) return true;
  if (nonEmpty.some((c) => isGroupHeaderText(c))) return true;
  const first = normLabel(cells[0] ?? "");
  if (first === "total" || first === "totales") return true;
  return false;
}

function buildColMap(headerCells: string[]): Partial<Record<FieldKey, number>> {
  const map: Partial<Record<FieldKey, number>> = {};
  headerCells.forEach((label, idx) => {
    const field = matchField(label);
    if (field !== null && map[field] === undefined) {
      map[field] = idx;
    }
  });
  return map;
}

function rowFromMappedCells(
  cells: string[],
  colMap: Partial<Record<FieldKey, number>>,
  clienteFallback: string,
): ParsedOrHtmRow | null {
  const get = (key: FieldKey) => {
    const idx = colMap[key];
    if (idx === undefined || idx < 0) return "";
    return cells[idx] ?? "";
  };

  const numero = get("numero").trim();
  if (!isValidOrNumero(numero)) return null;

  const expedidor = get("expedidor").trim();
  const cliente = get("cliente").trim() || clienteFallback;
  const proveedor = get("proveedor").trim();
  const piezas = parseNum(get("piezas"));
  const pesoKg = parseNum(get("peso"));
  const volumenM3 = parseNum(get("volumen"));
  const fechaEntrega = get("fecha").trim();

  return {
    numero,
    expedidor,
    cliente,
    proveedor,
    piezas,
    pesoKg,
    volumenM3,
    fechaEntrega: fechaEntrega || undefined,
  };
}

/**
 * Reporte Magaya «CARGA POR LLEGAR»:
 * Estado | Número | Fecha | Expedidor | Consignatario | Piezas | Peso | Volumen | Proveedor
 */
function parseMagayaCargaPorLlegarTable(table: HTMLTableElement): ParsedOrHtmRow[] {
  const rows = Array.from(table.querySelectorAll("tr"));
  if (rows.length < 2) return [];

  let headerIdx = -1;
  let colMap: Partial<Record<FieldKey, number>> = {};

  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = Array.from(rows[i]!.querySelectorAll("th, td")).map((c) => cellText(c));
    const map = buildColMap(cells);
    if (map.numero !== undefined && (map.cliente !== undefined || map.proveedor !== undefined)) {
      headerIdx = i;
      colMap = map;
      break;
    }
  }

  if (headerIdx < 0) return [];

  let currentCliente = "";
  const out: ParsedOrHtmRow[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = Array.from(rows[i]!.querySelectorAll("th, td")).map((c) => cellText(c));
    if (isSkippableDataRow(cells)) {
      const groupCell = cells.find((c) => isGroupHeaderText(c));
      if (groupCell) {
        currentCliente = groupCell.replace(/\s*\(\d+\)\s*$/, "").trim();
      } else if (cells.length <= 2) {
        const t = cells.filter(Boolean).join(" ").trim();
        if (isGroupHeaderText(t)) {
          currentCliente = t.replace(/\s*\(\d+\)\s*$/, "").trim();
        }
      }
      continue;
    }

    const parsed = rowFromMappedCells(cells, colMap, currentCliente);
    if (parsed) out.push(parsed);
  }

  return out;
}

/** Índices fijos Magaya si los encabezados no se detectan bien. */
function rowFromMagayaFixedColumns(
  cells: string[],
  clienteFallback: string,
): ParsedOrHtmRow | null {
  if (cells.length < 6) return null;
  const numero = String(cells[1] ?? "").trim();
  if (!isValidOrNumero(numero)) return null;

  return {
    numero,
    expedidor: String(cells[3] ?? "").trim(),
    cliente: String(cells[4] ?? "").trim() || clienteFallback,
    piezas: parseNum(String(cells[5] ?? "")),
    pesoKg: parseNum(String(cells[6] ?? "")),
    volumenM3: parseNum(String(cells[7] ?? "")),
    proveedor: String(cells[8] ?? "").trim(),
    fechaEntrega: String(cells[2] ?? "").trim() || undefined,
  };
}

function parseMagayaFixedColumnTable(table: HTMLTableElement): ParsedOrHtmRow[] {
  const rows = Array.from(table.querySelectorAll("tr"));
  let currentCliente = "";
  const out: ParsedOrHtmRow[] = [];

  for (const tr of rows) {
    const cells = Array.from(tr.querySelectorAll("th, td")).map((c) => cellText(c));
    if (isSkippableDataRow(cells)) {
      const groupCell = cells.find((c) => isGroupHeaderText(c));
      if (groupCell) {
        currentCliente = groupCell.replace(/\s*\(\d+\)\s*$/, "").trim();
      }
      continue;
    }
    const parsed = rowFromMagayaFixedColumns(cells, currentCliente);
    if (parsed) out.push(parsed);
  }
  return out;
}

function dedupeOrders(rows: ParsedOrHtmRow[]): ParsedOrHtmRow[] {
  const seen = new Set<string>();
  const out: ParsedOrHtmRow[] = [];
  for (const row of rows) {
    if (!isValidOrNumero(row.numero)) continue;
    const key = row.numero.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function parseCollectionOrdersFromHtm(html: string): ParseCollectionOrdersHtmResult {
  const trimmed = html.trim();
  if (!trimmed) {
    return { orders: [], error: "El archivo está vacío." };
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(trimmed, "text/html");
  } catch {
    return { orders: [], error: "No se pudo leer el HTML." };
  }

  const bodyText = normLabel(doc.body?.textContent ?? "");
  const isMagayaCarga =
    bodyText.includes("carga por llegar") || bodyText.includes("powered by magaya");

  const collected: ParsedOrHtmRow[] = [];

  for (const table of Array.from(doc.querySelectorAll("table"))) {
    const fromHeaders = parseMagayaCargaPorLlegarTable(table);
    if (fromHeaders.length > 0) {
      collected.push(...fromHeaders);
      continue;
    }
    if (isMagayaCarga) {
      collected.push(...parseMagayaFixedColumnTable(table));
    }
  }

  const orders = dedupeOrders(collected);
  if (orders.length === 0) {
    return {
      orders: [],
      error:
        "No se encontraron órdenes válidas. El HTM debe tener la columna «Número» con dígitos (ej. 2677) y las demás columnas del reporte Magaya.",
    };
  }

  return { orders };
}

const generateId = () => Math.random().toString(36).slice(2, 11);

function emptyLine(): CollectionOrderLine {
  return {
    id: generateId(),
    referencia: "",
    descripcion: "",
    bultos: "",
    unidadesPorBulto: "",
    pesoPorBulto: "",
    pesoPiezaKg: "",
    l: "",
    w: "",
    h: "",
    volumenM3: "",
    unidad: "",
    magayaModelo: "",
    paisOrigen: "",
    tejido: "",
    talla: "",
    forro: "",
    genero: "",
    composicion: "",
  };
}

/**
 * Convierte filas HTM en órdenes de recolección.
 * Solo encabezado y totales documento — las referencias las carga el operador.
 */
export function collectionOrdersFromHtmRows(
  rows: ParsedOrHtmRow[],
  clienteGlobal?: string,
): CollectionOrder[] {
  const now = new Date().toISOString();

  return rows.map((row) => {
    const bultos = Math.max(0, Math.round(row.piezas));

    return {
      id: generateId(),
      numero: row.numero.trim(),
      cliente: row.cliente.trim() || String(clienteGlobal ?? "").trim(),
      proveedor: row.proveedor.trim(),
      expedidor: row.expedidor.trim() || undefined,
      fechaEntrega: row.fechaEntrega?.trim() || undefined,
      expectedBultos: bultos > 0 ? bultos : undefined,
      expectedPesoKg: row.pesoKg > 0 ? row.pesoKg : undefined,
      expectedCbm: row.volumenM3 > 0 ? row.volumenM3 : undefined,
      notes: "",
      lines: [emptyLine()],
      status: "draft" as const,
      linkedRaNumbers: [],
      createdAt: now,
      updatedAt: now,
    };
  });
}
