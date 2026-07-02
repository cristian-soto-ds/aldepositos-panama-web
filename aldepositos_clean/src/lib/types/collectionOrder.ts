/**
 * Orden de recolección: captura previa al RA en almacén (líneas tipo detallado).
 */
import type { ReceptionStatusId } from "@/lib/receptionLogistics/config";

export type CollectionOrderLine = {
  id: string;
  referencia?: string;
  descripcion?: string;
  bultos?: string | number;
  unidadesPorBulto?: string | number;
  pesoPorBulto?: string | number;
  /** Peso de una pieza (kg); en CSV Magaya la columna PESO usa pesoPorBulto (igual que CSV Descargar). */
  pesoPiezaKg?: string | number;
  l?: string | number;
  w?: string | number;
  h?: string | number;
  volumenM3?: string | number;
  unidad?: string;
  /** Columna MODELO (Magaya): marca/modelo resuelto, ej. CONCEPTS */
  magayaModelo?: string;
  paisOrigen?: string;
  tejido?: string;
  talla?: string;
  forro?: string;
  genero?: string;
  /** Columna R Magaya: composición legible */
  composicion?: string;
};

export type CollectionOrderStatus = "draft" | "sent";

export type CollectionOrder = {
  id: string;
  /** Número operativo visible de la orden de recolección */
  numero?: string;
  /** Cliente / consignatario */
  cliente: string;
  proveedor: string;
  /** Nombre del expedidor (documento Magaya / HTM). */
  expedidor?: string;
  /** Fecha de entrega indicada en el documento origen. */
  fechaEntrega?: string;
  notes?: string;
  /**
   * Totales del documento (HTM / Magaya) — editables en el encabezado de la orden.
   * Se comparan contra la suma de las líneas con referencia.
   */
  expectedBultos?: number;
  expectedPesoKg?: number;
  expectedCbm?: number;
  lines: CollectionOrderLine[];
  status: CollectionOrderStatus;
  /** Estado en recepción (fila / rampa / completado) — vista recepcionista. */
  receptionStatus?: ReceptionStatusId;
  /** RA(s) a los que ya se enviaron medidas */
  linkedRaNumbers?: string[];
  createdAt: string;
  updatedAt: string;
};
