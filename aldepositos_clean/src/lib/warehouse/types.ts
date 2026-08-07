/**
 * Tipos del módulo Control de Carga (códigos expedidor + RA).
 */

export type CanonicalWarehouseClient = "AAA" | "JH" | "IMPOMEX";

export const CANONICAL_WAREHOUSE_CLIENTS: CanonicalWarehouseClient[] = [
  "AAA",
  "JH",
  "IMPOMEX",
];

/** Etiqueta de UI para IMPOMEX. */
export const CLIENT_DISPLAY_NAMES: Record<CanonicalWarehouseClient, string> = {
  AAA: "AAA",
  JH: "JH",
  IMPOMEX: "IMPOMEX DE COLOMBIA LTDA",
};

export type WarehouseClientRow = {
  code: CanonicalWarehouseClient | string;
  display_name: string;
  aliases: string[] | unknown;
  active: boolean;
};

export type WarehouseShipper = {
  id: string;
  client_code: string;
  group_id: string | null;
  barcode_code: string;
  official_name: string;
  normalized_name: string;
  supplier: string | null;
  aliases: string[] | unknown;
  active: boolean;
};

export type WarehouseRaCode = {
  id: string;
  task_id: string;
  ra: string;
  client_code: string;
  shipper_id: string | null;
  barcode_code: string;
  provider: string | null;
  order_ref: string | null;
  shipper_label: string | null;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

/** RA completada adaptada desde tasks (solo lectura de payload). */
export type WarehouseRAView = {
  taskId: string;
  ra: string;
  clientCode: CanonicalWarehouseClient | null;
  clientRaw: string;
  clientDisplay: string;
  provider: string;
  shipper: string;
  orderRef: string;
  expectedBultos: number;
  currentBultos: number;
  weight: number;
  cbm: number;
  status: string;
  recognized: boolean;
  /** Código RA ya generado en BD, si existe. */
  raBarcode?: string | null;
  shipperId?: string | null;
};

export const PENDING_SHIPPER_LABEL = "PENDIENTE DE ASIGNAR";

/** Sesión de pistoleo carga/descarga. */
export type LoadSessionKind = "carga" | "descarga";
export type LoadSessionStatus = "abierta" | "cerrada";

/**
 * Datos logísticos del contenedor (mismo shape que Entrega de carga / dispatchInfo).
 * Se persiste en `warehouse_load_sessions.container_info` (migración 021).
 */
export type LoadSessionContainerInfo = {
  type: string;
  consignment: string;
  number: string;
  bl: string;
  seal1: string;
  seal2: string;
  responsible: string;
  date: string;
  tare?: number;
};

export type WarehouseLoadSession = {
  id: string;
  kind: LoadSessionKind;
  container_number: string;
  notes: string;
  status: LoadSessionStatus;
  created_by: string | null;
  created_at: string;
  closed_at: string | null;
  updated_at?: string;
  /** Carga cerrada y señalada como lista para pistolear en Descarga. */
  ready_for_descarga?: boolean;
  /** Si es descarga, apunta a la sesión de carga de origen. */
  source_carga_session_id?: string | null;
  /** Metadatos logísticos del contenedor (tipo, sellos, BL, etc.). */
  container_info?: LoadSessionContainerInfo | Record<string, unknown> | null;
};

export type WarehouseLoadSessionRa = {
  id: string;
  session_id: string;
  task_id: string;
  ra: string;
  order_barcode: string | null;
  expected_bultos: number;
  client_display: string | null;
  shipper_label: string | null;
  provider: string | null;
  order_ref: string | null;
  created_at?: string;
};

export type WarehousePackageScan = {
  id: string;
  session_id: string;
  ra: string;
  package_seq: number;
  package_barcode: string;
  scanned_at: string;
  scanned_by_label: string | null;
};

export type LoadSessionRaProgress = {
  ra: string;
  taskId: string;
  orderBarcode: string | null;
  expectedBultos: number;
  scannedBultos: number;
  missingSeqs: number[];
  clientDisplay: string | null;
  shipperLabel: string | null;
  provider: string | null;
  orderRef: string | null;
};

export type PackageScanResultCode =
  | "ok"
  | "duplicate"
  | "invalid"
  | "ra_not_in_session"
  | "seq_out_of_range"
  | "session_closed";

export type PackageScanResult = {
  code: PackageScanResultCode;
  message: string;
  ra?: string;
  seq?: number;
  barcode?: string;
};
