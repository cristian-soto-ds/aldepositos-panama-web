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
    "Indicá si hay retiro de mercancía en una rampa. El cambio se ve al instante en la pantalla TV.",
  ramp1Label: "Rampa 1",
  ramp2Label: "Rampa 2",
  free: "Libre",
  occupiedRetiro: "Ocupada",
  occupiedRetiroLong: "Ocupada — retiro de mercancía",
  tvBannerTitle: "Rampa ocupada",
  tvBannerBody: "No disponible para descarga en este momento",
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

export type RampOccupancyReportLine = {
  label: string;
  value: string;
  occupied: boolean;
};

export function rampOccupancyReportLines(state: RampOccupancyState): {
  rampa1: RampOccupancyReportLine;
  rampa2: RampOccupancyReportLine;
} {
  const line = (rampLabel: string, entry: RampOccupancyEntry): RampOccupancyReportLine => {
    let value = rampOccupancyLabel(entry);
    if (entry.occupied && entry.updatedAt) {
      const d = new Date(entry.updatedAt);
      if (!Number.isNaN(d.getTime())) {
        const time = d.toLocaleTimeString("es-PA", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });
        value += ` (desde ${time})`;
      }
    }
    return { label: rampLabel, value, occupied: entry.occupied };
  };

  return {
    rampa1: line(RAMP_OCCUPANCY_COPY.ramp1Label, state.RAMPA_1),
    rampa2: line(RAMP_OCCUPANCY_COPY.ramp2Label, state.RAMPA_2),
  };
}
