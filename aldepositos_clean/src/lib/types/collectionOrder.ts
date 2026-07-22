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
  /**
   * Piezas totales de factura (Tot und). Si está definido, manda sobre bultos×und/bulto
   * (p. ej. und decorativo 48 con tot 311 cuando no divide exacto).
   */
  unidadesTotales?: string | number;
  /**
   * Peso total de factura (kg). Si está definido, manda sobre bultos×peso/b
   * (el peso tot no se recalcula ni se altera respecto a la factura).
   */
  pesoTotalKg?: string | number;
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
  /**
   * Si true, la línea es reempaque: no cubicá / no pesa.
   * Al pasar al RA se conserva la marca para inventariado.
   */
  reempaque?: boolean;
};

export type CollectionOrderStatus = "draft" | "sent";

export type CollectionOrder = {
  id: string;
  /** Número operativo visible de la orden de recolección */
  numero?: string;
  /** Cliente / consignatario */
  cliente: string;
  proveedor: string;
  /**
   * Marca / Nº de seguimiento (columna Magaya «Número de seguimiento»).
   * Se usa como marca al pasar al RA.
   */
  marca?: string;
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
  /**
   * Marcada manualmente como «sin inventario» (p. ej. ya se procesó fuera del flujo RA).
   * También aplican clientes/proveedores de la lista fija en collectionOrderListTabs.
   */
  sinInventario?: boolean;
  createdAt: string;
  updatedAt: string;
};
