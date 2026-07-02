import type { ReceptionStatusId } from "@/lib/receptionLogistics/config";
import { RECEPTION_STATUS } from "@/lib/receptionLogistics/config";

/** Rampas que pueden marcarse ocupadas por retiro de mercancía. */
export type RampOccupancyRampId = typeof RECEPTION_STATUS.RAMPA_1 | typeof RECEPTION_STATUS.RAMPA_2;

export const RAMP_OCCUPANCY_RAMPS: RampOccupancyRampId[] = [
  RECEPTION_STATUS.RAMPA_1,
  RECEPTION_STATUS.RAMPA_2,
];

export type RampOccupancyReason = "retiro";

export type RampOccupancyEntry = {
  occupied: boolean;
  reason: RampOccupancyReason | null;
  updatedAt: string | null;
};

export type RampOccupancyState = {
  RAMPA_1: RampOccupancyEntry;
  RAMPA_2: RampOccupancyEntry;
  updatedAt: string;
};

export const RAMP_OCCUPANCY_STORAGE_KEY = "aldepositos-ramp-occupancy-v1";

export const RAMP_OCCUPANCY_META_ID = "meta-ramp-occupancy";

export const RAMP_OCCUPANCY_COPY = {
  sectionTitle: "Estado de rampas",
  sectionHint:
    "Marcá cuando un camión está retirando mercancía (no entregando). Así los proveedores ven en TV por qué la rampa parece libre.",
  ramp1Label: "Rampa 1",
  ramp2Label: "Rampa 2",
  free: "Libre",
  occupiedRetiro: "Ocupada — retiro",
  occupiedRetiroLong: "Ocupada — retiro de mercancía",
  tvBannerTitle: "Rampa ocupada",
  tvBannerBody: "Camión retirando mercancía de bodega",
  operatorBadge: "Retiro en curso",
} as const;

export function emptyRampEntry(): RampOccupancyEntry {
  return { occupied: false, reason: null, updatedAt: null };
}

export function defaultRampOccupancyState(): RampOccupancyState {
  const now = new Date().toISOString();
  return {
    RAMPA_1: emptyRampEntry(),
    RAMPA_2: emptyRampEntry(),
    updatedAt: now,
  };
}

export function isRampOccupancyRampId(
  status: ReceptionStatusId,
): status is RampOccupancyRampId {
  return status === RECEPTION_STATUS.RAMPA_1 || status === RECEPTION_STATUS.RAMPA_2;
}

export function rampOccupancyLabel(entry: RampOccupancyEntry): string {
  if (!entry.occupied) return RAMP_OCCUPANCY_COPY.free;
  if (entry.reason === "retiro") return RAMP_OCCUPANCY_COPY.occupiedRetiro;
  return RAMP_OCCUPANCY_COPY.occupiedRetiro;
}
