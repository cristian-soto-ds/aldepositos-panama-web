/**
 * Orden de recolección: captura previa al RA en almacén (líneas tipo detallado).
 */
export type CollectionOrderLine = {
  id: string;
  referencia?: string;
  descripcion?: string;
  bultos?: string | number;
  unidadesPorBulto?: string | number;
  pesoPorBulto?: string | number;
  /** Peso de una sola pieza (kg); columna PESO del CSV Magaya */
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
  notes?: string;
  lines: CollectionOrderLine[];
  status: CollectionOrderStatus;
  /** RA(s) a los que ya se enviaron medidas */
  linkedRaNumbers?: string[];
  createdAt: string;
  updatedAt: string;
};
