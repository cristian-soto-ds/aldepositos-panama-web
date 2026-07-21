import { describe, expect, it } from "vitest";
import {
  computeReportData,
  reportLineTotalCbm,
  sumReportCubicajeM3,
} from "@/lib/reportTotals";
import { formatCubicaje2 } from "@/lib/measureDecimals";
import type { Task } from "@/lib/types/task";

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "1",
    ra: "63900",
    mainClient: "DINORA",
    provider: "",
    subClient: "",
    brand: "",
    expectedBultos: 201,
    originalExpectedBultos: 201,
    expectedCbm: 9.99,
    expectedWeight: 9999,
    notes: "",
    currentBultos: 201,
    status: "completed",
    measureData: [],
    weightMode: "per_bundle",
    manualTotalWeight: 0,
    referenceMode: "with",
    type: "quick",
    ...overrides,
  };
}

describe("report cubicaje totals", () => {
  it("el KPI Volumen total coincide con la suma de Total CBM por fila", () => {
    const rows = [
      { id: "1", referencia: "A", bultos: "10", l: "100", w: "50", h: "40", weight: "5" },
      { id: "2", referencia: "B", bultos: "5", l: "80", w: "40", h: "30", weight: "2" },
      { id: "3", referencia: "C", bultos: "2", l: "20", w: "20", h: "20", weight: "1" },
      // Sin dims ni volumenM3, la fila no aporta CBM (igual que la columna).
      { id: "4", referencia: "D", bultos: "1", weight: "1" },
    ];
    const task = baseTask({ measureData: rows });
    const { totals, measureRows } = computeReportData(task);

    const sumLines = measureRows.reduce(
      (acc, row) => acc + reportLineTotalCbm(row),
      0,
    );
    expect(totals.cbm).toBe(formatCubicaje2(sumReportCubicajeM3(measureRows)));
    expect(totals.cbm).toBe(formatCubicaje2(sumLines));
    expect(reportLineTotalCbm(rows[3]!)).toBe(0);
    // expectedCbm del RA no debe usarse en el KPI.
    expect(totals.cbm).not.toBe("9.99");
  });

  it("usa volumenM3 de línea si no hay L×W×H (misma cifra en KPI y Total CBM)", () => {
    const rows = [
      { id: "1", referencia: "A", bultos: "2", volumenM3: "1.25" },
      { id: "2", referencia: "B", bultos: "1", l: "100", w: "100", h: "100", weight: "1" },
    ];
    const task = baseTask({ measureData: rows });
    const { totals, measureRows } = computeReportData(task);
    const sumLines = measureRows.reduce(
      (acc, row) => acc + reportLineTotalCbm(row),
      0,
    );
    expect(totals.cbm).toBe(formatCubicaje2(sumLines));
    expect(reportLineTotalCbm(rows[0]!)).toBe(1.25);
  });

  it("reempaque no suma cubicaje", () => {
    const rows = [
      {
        id: "1",
        referencia: "R",
        bultos: "10",
        l: "100",
        w: "100",
        h: "100",
        reempaque: true,
      },
      { id: "2", referencia: "A", bultos: "1", l: "100", w: "100", h: "100", weight: "1" },
    ];
    const { totals } = computeReportData(baseTask({ measureData: rows }));
    expect(totals.cbm).toBe(formatCubicaje2(reportLineTotalCbm(rows[1]!)));
  });
});
