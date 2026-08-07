/**
 * Adapta Task / payload de tasks al modelo Control de Carga (RA completas).
 */

import type { Task } from "@/lib/types/task";
import {
  clientDisplayName,
  resolveCanonicalWarehouseClient,
  resolveCanonicalWarehouseClientFromPayload,
} from "@/lib/warehouse/client-resolver";
import {
  PENDING_SHIPPER_LABEL,
  type WarehouseClientRow,
  type WarehouseRAView,
} from "@/lib/warehouse/types";

function asNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function asText(v: unknown): string {
  return String(v ?? "").trim();
}

function isEmptyLabel(v: string): boolean {
  const t = v.trim();
  return !t || t.toUpperCase() === "N/A" || t === "—";
}

export function isCompletedInventoryStatus(status: unknown): boolean {
  return asText(status).toLowerCase() === "completed";
}

export function mapTaskToWarehouseRA(
  task: Task | Record<string, unknown>,
  clients: WarehouseClientRow[],
): WarehouseRAView {
  const p = task as Record<string, unknown>;
  const mainClient = asText(p.mainClient ?? p.cliente ?? "");
  const clientCode =
    resolveCanonicalWarehouseClient(mainClient, clients) ??
    resolveCanonicalWarehouseClientFromPayload(p, clients);

  const shipperRaw = asText(p.subClient ?? p.expedidor ?? "");
  const shipper = isEmptyLabel(shipperRaw) ? PENDING_SHIPPER_LABEL : shipperRaw;

  const provider = asText(p.provider ?? p.proveedor ?? "");
  const orderRef = asText(p.brand ?? p.marca ?? "");
  const ra = asText(p.ra ?? "");
  const expectedBultos = Math.max(
    0,
    Math.round(asNum(p.expectedBultos ?? p.originalExpectedBultos)),
  );
  const currentBultos = Math.max(0, Math.round(asNum(p.currentBultos)));
  const weight = asNum(p.capturedWeight ?? p.expectedWeight);
  const cbm = asNum(p.expectedCbm);
  const status = asText(p.status) || "pending";

  return {
    taskId: asText(p.id),
    ra,
    clientCode,
    clientRaw: mainClient,
    clientDisplay: clientDisplayName(clientCode, clients),
    provider: isEmptyLabel(provider) ? "" : provider,
    shipper,
    orderRef: isEmptyLabel(orderRef) ? "" : orderRef,
    expectedBultos,
    currentBultos,
    weight,
    cbm,
    status,
    recognized: clientCode != null && isCompletedInventoryStatus(status),
  };
}

/**
 * Código de pedido para etiqueta/Xellent:
 * marca (REF) + RA concatenados.
 * Ej: 424/AAA + 64353 → 424/AAA64353
 */
export function normalizeMarcaForBarcode(orderRef: string): string {
  return String(orderRef ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9/\-]/g, "");
}

export function buildOrderBarcode(orderRef: string, ra: string): string {
  const marca = normalizeMarcaForBarcode(orderRef);
  const raPart = normalizeRaForPackageBarcode(ra);
  if (!marca) {
    throw new Error("Se necesita la marca (REF) para generar el código del pedido");
  }
  return `${marca}${raPart}`;
}

/** Normaliza el RA para códigos de bulto (solo A-Z0-9). */
export function normalizeRaForPackageBarcode(ra: string): string {
  return (
    String(ra ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "") || "SINRA"
  );
}

/** Formatos de código por bulto físico. */
export type PackageBarcodeFormat =
  | "marca_ra_bulto"
  | "corto"
  | "completo"
  | "expedidor_ra_bulto";

export const PACKAGE_BARCODE_FORMAT_OPTIONS: ReadonlyArray<{
  id: PackageBarcodeFormat;
  label: string;
  example: string;
  hint: string;
}> = [
  {
    id: "marca_ra_bulto",
    label: "Marca + RA + bulto",
    example: "424/AAA64353-1",
    hint: "Marca y RA juntos, luego el consecutivo de bulto",
  },
];

export const DEFAULT_PACKAGE_BARCODE_FORMAT: PackageBarcodeFormat =
  "marca_ra_bulto";

const PACKAGE_FORMAT_STORAGE_KEY = "aldepositos.packageBarcodeFormat";

export function isPackageBarcodeFormat(v: unknown): v is PackageBarcodeFormat {
  return (
    v === "marca_ra_bulto" ||
    v === "corto" ||
    v === "completo" ||
    v === "expedidor_ra_bulto"
  );
}

export function loadPackageBarcodeFormat(): PackageBarcodeFormat {
  // Formato único vigente: Marca+RA-consecutivo.
  return DEFAULT_PACKAGE_BARCODE_FORMAT;
}

export function savePackageBarcodeFormat(format: PackageBarcodeFormat): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PACKAGE_FORMAT_STORAGE_KEY, format);
  } catch {
    /* ignore */
  }
}

export type PackageBarcodeInput = {
  ra: string;
  seq: number;
  /** Total de bultos (requerido para formato completo legado). */
  total?: number;
  /** Código de pedido Marca+RA (preferido). */
  orderBarcode?: string | null;
  /** Marca / REF del pedido (si aún no hay orderBarcode). */
  orderRef?: string | null;
  /** Código de expedidor EXP-… (solo formatos legados). */
  shipperBarcode?: string | null;
};

export type ParsedPackageBarcode = {
  ra: string;
  seq: number;
  total?: number;
  format: PackageBarcodeFormat;
  barcode: string;
};

function padSeq(seq: number): string {
  return String(Math.max(1, Math.floor(Number(seq) || 1))).padStart(3, "0");
}

function padTotal(total: number): string {
  return String(Math.max(1, Math.floor(Number(total) || 1))).padStart(3, "0");
}

function seqPart(seq: number, padded: boolean): string {
  const n = Math.max(1, Math.floor(Number(seq) || 1));
  return padded ? String(n).padStart(3, "0") : String(n);
}

function resolveOrderBarcodeForPackage(input: PackageBarcodeInput): string | null {
  const order = String(input.orderBarcode ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (order) return order;
  const ref = String(input.orderRef ?? "").trim();
  if (ref) {
    try {
      return buildOrderBarcode(ref, input.ra);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Extrae el RA del código de pedido.
 * - Nuevo: Marca+RA → dígitos finales (424/AAA64353 → 64353)
 * - Legado: EXP-…-RA → último segmento
 */
export function raFromOrderBarcode(orderBarcode: string): string | null {
  const s = String(orderBarcode ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!s) return null;
  if (s.startsWith("EXP-")) {
    const parts = s.split("-").filter(Boolean);
    if (parts.length < 3) return null;
    const ra = parts[parts.length - 1]!;
    if (!/^[A-Z0-9]+$/.test(ra)) return null;
    return ra;
  }
  const m = /^(.*?)(\d{3,})$/.exec(s);
  if (!m) return null;
  const ra = m[2]!;
  if (!/^[A-Z0-9]+$/.test(ra)) return null;
  return ra;
}

/**
 * Arma el código de un bulto según el formato.
 * Vigente: `424/AAA64353-1` (Marca+RA-consecutivo).
 * Legados: corto / completo EXP / expedidor+RA+bulto.
 */
export function buildPackageBarcode(
  input: PackageBarcodeInput,
  format: PackageBarcodeFormat = DEFAULT_PACKAGE_BARCODE_FORMAT,
): string {
  const raPart = normalizeRaForPackageBarcode(input.ra);

  if (format === "corto") {
    return `${raPart}-${padSeq(input.seq)}`;
  }

  if (format === "marca_ra_bulto") {
    const order =
      resolveOrderBarcodeForPackage({ ...input, ra: raPart }) ??
      (() => {
        throw new Error(
          "Se necesita la marca (REF) o el código de pedido para etiquetas de bulto",
        );
      })();
    // Si el orderBarcode aún es legado EXP-, preferir armar desde orderRef.
    let orderCode = order;
    if (order.startsWith("EXP-") && input.orderRef?.trim()) {
      orderCode = buildOrderBarcode(input.orderRef, raPart);
    } else if (order.startsWith("EXP-")) {
      // Sin marca: no inventar; usar RA puro como último recurso no aplica —
      // exigir marca vía resolve ya falló si no había orderRef.
      throw new Error(
        "El código de pedido es legado (EXP). Regenerá el pedido con marca (REF).",
      );
    }
    return `${orderCode}-${seqPart(input.seq, false)}`;
  }

  const order =
    resolveOrderBarcodeForPackage({ ...input, ra: raPart }) ??
    `EXP-SINEXP-0000-${raPart}`;

  if (format === "completo") {
    const totalPart = padTotal(input.total ?? input.seq);
    return `${order}-${padSeq(input.seq)}/${totalPart}`;
  }

  return `${order}-${padSeq(input.seq)}`;
}

/**
 * Interpreta cualquier formato de bulto soportado (vigente + legados).
 * Rechaza códigos de pedido/expedidor sin número de bulto.
 */
export function parsePackageBarcode(raw: string): ParsedPackageBarcode | null {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!s) return null;

  // completo legado: EXP-…-RA-001/018
  const completo = /^(EXP-.+)-(\d{1,4})\/(\d{1,4})$/.exec(s);
  if (completo) {
    const order = completo[1]!;
    const ra = raFromOrderBarcode(order);
    const seq = parseInt(completo[2]!, 10);
    const total = parseInt(completo[3]!, 10);
    if (!ra || !Number.isFinite(seq) || seq < 1) return null;
    return {
      ra,
      seq,
      total: Number.isFinite(total) && total >= 1 ? total : undefined,
      format: "completo",
      barcode: s,
    };
  }

  // expedidor + RA + bulto legado: EXP-…-RA-001
  const withShipper = /^(EXP-.+)-(\d{1,4})$/.exec(s);
  if (withShipper) {
    const order = withShipper[1]!;
    const ra = raFromOrderBarcode(order);
    const seq = parseInt(withShipper[2]!, 10);
    if (!ra || !Number.isFinite(seq) || seq < 1) return null;
    return {
      ra,
      seq,
      format: "expedidor_ra_bulto",
      barcode: s,
    };
  }

  // Pedido o expedidor solo (sin bulto) → no válido para pistoleo
  if (s.startsWith("EXP-")) return null;

  // Marca+RA-consecutivo: 424/AAA64353-1 (marca con letra o /)
  const marcaRa = /^(.*[A-Z\/].*?)(\d{3,})-(\d{1,4})$/.exec(s);
  if (marcaRa) {
    const ra = marcaRa[2]!;
    const seq = parseInt(marcaRa[3]!, 10);
    if (!Number.isFinite(seq) || seq < 1) return null;
    return {
      ra,
      seq,
      format: "marca_ra_bulto",
      barcode: s,
    };
  }

  // corto legado: 64368-001
  const corto = /^([A-Z0-9]+)-(\d{1,4})$/.exec(s);
  if (!corto) return null;
  const seq = parseInt(corto[2]!, 10);
  if (!Number.isFinite(seq) || seq < 1) return null;
  return {
    ra: corto[1]!,
    seq,
    format: "corto",
    barcode: `${corto[1]}-${padSeq(seq)}`,
  };
}

/** Lista de códigos 1..N para imprimir etiquetas. */
export function buildPackageBarcodeList(
  input: Omit<PackageBarcodeInput, "seq"> | string,
  totalBultos: number,
  format: PackageBarcodeFormat = DEFAULT_PACKAGE_BARCODE_FORMAT,
): string[] {
  const total = Math.max(0, Math.floor(Number(totalBultos) || 0));
  const base: Omit<PackageBarcodeInput, "seq"> =
    typeof input === "string"
      ? { ra: input, total }
      : { ...input, total: input.total ?? total };
  const out: string[] = [];
  for (let i = 1; i <= total; i += 1) {
    out.push(buildPackageBarcode({ ...base, seq: i, total }, format));
  }
  return out;
}
