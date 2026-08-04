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
 * código único del expedidor + RA del pedido.
 * Ej: EXP-AAA-0003 + 64368 → EXP-AAA-0003-64368
 */
export function buildOrderBarcode(shipperBarcode: string, ra: string): string {
  const exp = String(shipperBarcode ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\-]/g, "");
  const raPart =
    String(ra ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9\-]/g, "") || "SINRA";
  if (!exp) {
    throw new Error("Se necesita el código del expedidor para generar el pedido");
  }
  return `${exp}-${raPart}`;
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
    id: "corto",
    label: "Corto",
    example: "64368-001",
    hint: "Solo RA + número de bulto (mejor en etiquetas chicas)",
  },
  {
    id: "completo",
    label: "Completo EXP",
    example: "EXP-AAA-0003-64368-001/018",
    hint: "Pedido EXP + bulto / total",
  },
  {
    id: "expedidor_ra_bulto",
    label: "Expedidor + RA + bulto",
    example: "EXP-AAA-0003-64368-001",
    hint: "Código de expedidor, RA y número de bulto",
  },
];

export const DEFAULT_PACKAGE_BARCODE_FORMAT: PackageBarcodeFormat = "corto";

const PACKAGE_FORMAT_STORAGE_KEY = "aldepositos.packageBarcodeFormat";

export function isPackageBarcodeFormat(v: unknown): v is PackageBarcodeFormat {
  return (
    v === "corto" || v === "completo" || v === "expedidor_ra_bulto"
  );
}

export function loadPackageBarcodeFormat(): PackageBarcodeFormat {
  if (typeof window === "undefined") return DEFAULT_PACKAGE_BARCODE_FORMAT;
  try {
    const raw = window.localStorage.getItem(PACKAGE_FORMAT_STORAGE_KEY);
    if (isPackageBarcodeFormat(raw)) return raw;
  } catch {
    /* ignore */
  }
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
  /** Total de bultos (requerido para formato completo). */
  total?: number;
  /** Código de pedido EXP-…-RA (preferido). */
  orderBarcode?: string | null;
  /** Código de expedidor EXP-… (si no hay orderBarcode). */
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

function resolveOrderBarcodeForPackage(input: PackageBarcodeInput): string | null {
  const order = String(input.orderBarcode ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (order.startsWith("EXP-")) return order;
  const shipper = String(input.shipperBarcode ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (shipper.startsWith("EXP-")) {
    return buildOrderBarcode(shipper, input.ra);
  }
  return null;
}

/** Extrae el RA (último segmento) de un código de pedido EXP-…-RA. */
export function raFromOrderBarcode(orderBarcode: string): string | null {
  const s = String(orderBarcode ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!s.startsWith("EXP-")) return null;
  const parts = s.split("-").filter(Boolean);
  if (parts.length < 3) return null;
  const ra = parts[parts.length - 1]!;
  if (!/^[A-Z0-9]+$/.test(ra)) return null;
  return ra;
}

/**
 * Arma el código de un bulto según el formato elegido.
 * - corto: `64368-001`
 * - completo: `EXP-AAA-0003-64368-001/018`
 * - expedidor_ra_bulto: `EXP-AAA-0003-64368-001`
 */
export function buildPackageBarcode(
  input: PackageBarcodeInput,
  format: PackageBarcodeFormat = "corto",
): string {
  const raPart = normalizeRaForPackageBarcode(input.ra);
  const seqPart = padSeq(input.seq);

  if (format === "corto") {
    return `${raPart}-${seqPart}`;
  }

  const order =
    resolveOrderBarcodeForPackage({ ...input, ra: raPart }) ??
    buildOrderBarcode("EXP-SINEXP-0000", raPart);

  if (format === "completo") {
    const totalPart = padTotal(input.total ?? input.seq);
    return `${order}-${seqPart}/${totalPart}`;
  }

  return `${order}-${seqPart}`;
}

/**
 * Interpreta cualquier formato de bulto soportado.
 * Rechaza códigos de pedido/expedidor sin número de bulto.
 */
export function parsePackageBarcode(raw: string): ParsedPackageBarcode | null {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!s) return null;

  // completo: EXP-…-RA-001/018
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

  // expedidor + RA + bulto: EXP-…-RA-001
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

  // corto: 64368-001
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
  format: PackageBarcodeFormat = "corto",
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
