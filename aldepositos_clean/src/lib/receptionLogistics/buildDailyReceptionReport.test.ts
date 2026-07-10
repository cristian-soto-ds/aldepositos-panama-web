import { describe, expect, it } from "vitest";
import { RECEPTION_STATUS } from "@/lib/receptionLogistics/config";
import { buildDailyReceptionReport } from "@/lib/receptionLogistics/buildDailyReceptionReport";
import {
  panamaMidnightUtc,
  type ReceptionReportFilter,
} from "@/lib/receptionLogistics/receptionReportFilter";
import type { ReceptionTruck } from "@/lib/receptionLogistics/types";

function makeTruck(overrides: Partial<ReceptionTruck> = {}): ReceptionTruck {
  return {
    id: "or-co-test-1",
    plate: "OR #2719",
    provider: "Proveedor",
    client: "Cliente",
    ra: "RA-1",
    expectedBultos: 6,
    status: RECEPTION_STATUS.COMPLETADO,
    sortOrder: 1_700_000_000_000,
    source: "collection_order",
    collectionOrderId: "test-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function isoOnPanamaDay(y: number, m: number, d: number, hour = 10): string {
  return new Date(panamaMidnightUtc(y, m, d).getTime() + hour * 3_600_000).toISOString();
}

function dayFilter(
  y: number,
  m: number,
  d: number,
  overrides: Partial<ReceptionReportFilter> = {},
): ReceptionReportFilter {
  const day = panamaMidnightUtc(y, m, d);
  return {
    from: day,
    to: day,
    dateField: "arrival",
    statusScope: "all",
    ...overrides,
  };
}

describe("buildDailyReceptionReport", () => {
  it("excluye OR con llegada de ayer del filtro de hoy", () => {
    const trucks = [
      makeTruck({ createdAt: isoOnPanamaDay(2026, 7, 5) }),
      makeTruck({
        id: "or-co-test-2",
        plate: "OR #2720",
        createdAt: isoOnPanamaDay(2026, 7, 6),
      }),
    ];

    const { rows } = buildDailyReceptionReport(trucks, dayFilter(2026, 7, 6));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.orNumero).toBe("2720");
  });

  it("excluye OR completada ayer del filtro de hoy por criterio completado", () => {
    const trucks = [
      makeTruck({
        createdAt: isoOnPanamaDay(2026, 7, 5),
        completedAt: isoOnPanamaDay(2026, 7, 5, 14),
        status: RECEPTION_STATUS.COMPLETADO,
      }),
      makeTruck({
        id: "or-co-test-2",
        plate: "OR #2720",
        createdAt: isoOnPanamaDay(2026, 7, 6, 8),
        completedAt: isoOnPanamaDay(2026, 7, 6, 11),
        status: RECEPTION_STATUS.COMPLETADO,
      }),
    ];

    const { rows } = buildDailyReceptionReport(
      trucks,
      dayFilter(2026, 7, 6, { dateField: "completed" }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.orNumero).toBe("2720");
  });

  it("incluye OR en ambos extremos de un rango multi-día", () => {
    const trucks = [
      makeTruck({ createdAt: isoOnPanamaDay(2026, 7, 4) }),
      makeTruck({
        id: "or-co-test-2",
        plate: "OR #2720",
        createdAt: isoOnPanamaDay(2026, 7, 6),
      }),
    ];

    const { rows } = buildDailyReceptionReport(trucks, {
      from: panamaMidnightUtc(2026, 7, 4),
      to: panamaMidnightUtc(2026, 7, 6),
      dateField: "arrival",
      statusScope: "all",
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.orNumero)).toEqual(["2719", "2720"]);
  });

  it("completed_only excluye OR aún en fila", () => {
    const trucks = [
      makeTruck({
        status: RECEPTION_STATUS.EN_FILA,
        createdAt: isoOnPanamaDay(2026, 7, 6),
      }),
      makeTruck({
        id: "or-co-test-2",
        plate: "OR #2720",
        status: RECEPTION_STATUS.COMPLETADO,
        createdAt: isoOnPanamaDay(2026, 7, 6, 9),
        completedAt: isoOnPanamaDay(2026, 7, 6, 12),
      }),
    ];

    const { rows } = buildDailyReceptionReport(
      trucks,
      dayFilter(2026, 7, 6, { statusScope: "completed_only" }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.orNumero).toBe("2720");
  });

  it("ignora camiones que no son OR de recolección", () => {
    const trucks = [
      makeTruck({
        createdAt: isoOnPanamaDay(2026, 7, 6),
        source: "import",
        collectionOrderId: undefined,
        id: "manual-import-1",
        plate: "ABC-001",
      }),
      makeTruck({
        id: "manual-2",
        plate: "ABC-123",
        collectionOrderId: undefined,
        source: "import",
        createdAt: isoOnPanamaDay(2026, 7, 6),
      }),
    ];

    const { rows } = buildDailyReceptionReport(trucks, dayFilter(2026, 7, 6));

    expect(rows).toHaveLength(0);
  });
});
