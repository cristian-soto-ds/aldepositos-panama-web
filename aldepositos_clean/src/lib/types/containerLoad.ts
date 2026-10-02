/**
 * Cargue de contenedor (relación de cargue): lista ordenada de RA.
 * Posición 1 = primero en cargar (va al fondo) → se inventaría primero.
 */
export type ContainerLoadItem = {
  position: number;
  ra: string;
  cliente?: string;
  proveedor?: string;
  marca?: string;
  expedidor?: string;
  seguimiento?: string;
  bultos?: number;
  cbm?: number;
  peso?: number;
  notas?: string;
  /** Admin: el RA no se inventaría (p. ej. solo tiene RA, sin OR); cuenta como listo. */
  noInventoryRequired?: boolean;
  noInventoryReason?: string;
  noInventoryMarkedBy?: string;
};

export type ContainerLoadStatus = "open" | "closed";

export type ContainerLoad = {
  id: string;
  name: string;
  status: ContainerLoadStatus;
  sourceFileName: string | null;
  items: ContainerLoadItem[];
  /** Orden de trabajo entre cargues (1 = se hace primero). */
  sortOrder: number;
  createdByEmail: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};
