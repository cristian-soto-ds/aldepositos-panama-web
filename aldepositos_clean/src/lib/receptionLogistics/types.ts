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
