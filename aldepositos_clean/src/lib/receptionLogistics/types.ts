import type { ReceptionStatusId } from "@/lib/receptionLogistics/config";

/** Camión / orden de recepción en el tablero. */
export type ReceptionTruck = {
  id: string;
  plate: string;
  provider: string;
  client: string;
  ra: string;
  expectedBultos: number;
  driverName?: string;
  notes?: string;
  status: ReceptionStatusId;
  sortOrder: number;
  warehouseReceiptNumber?: string;
  rampAssignedAt?: string;
  /** Rampa (o carretillado) donde se atendió; se conserva aunque pase a Completado. */
  rampUsed?: ReceptionStatusId;
  /** Momento en que se marcó Completado (real, no se altera por ediciones posteriores). */
  completedAt?: string;
  /** Vinculada a una orden de recolección (vista recepcionista). */
  collectionOrderId?: string;
  source?: "collection_order" | "import";
  createdAt: string;
  updatedAt: string;
};

export type ReceptionQueueSnapshot = {
  trucks: ReceptionTruck[];
  updatedAt: string;
};
