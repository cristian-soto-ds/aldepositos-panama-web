import { describe, expect, it } from "vitest";
import {
  mergeConcurrentQuickRows,
  type QuickMeasureRow,
} from "@/lib/quickInventoryTypes";

function row(
  id: string,
  fields: Partial<QuickMeasureRow> = {},
): QuickMeasureRow {
  return { id, referencia: fields.referencia ?? id, bultos: "", ...fields };
}

describe("mergeConcurrentQuickRows", () => {
  it("conserva medidas de dos inventariadores en filas distintas", () => {
    const baseline = [
      row("1", { referencia: "A", bultos: "1" }),
      row("2", { referencia: "B", bultos: "1" }),
    ];
    const local = [
      row("1", { referencia: "A", bultos: "1", l: "10", w: "20", h: "30" }),
      row("2", { referencia: "B", bultos: "1" }),
    ];
    const remote = [
      row("1", { referencia: "A", bultos: "1" }),
      row("2", { referencia: "B", bultos: "1", l: "11", w: "22", h: "33", weight: "5" }),
    ];

    const merged = mergeConcurrentQuickRows(baseline, local, remote);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ id: "1", l: "10.00", w: "20.00", h: "30.00" });
    expect(merged[1]).toMatchObject({
      id: "2",
      l: "11.00",
      w: "22.00",
      h: "33.00",
      weight: "5.00",
    });
  });

  it("añade filas nuevas de ambos lados", () => {
    const baseline = [row("1", { referencia: "A", bultos: "2" })];
    const local = [
      row("1", { referencia: "A", bultos: "2" }),
      row("local-new", { referencia: "L", bultos: "1", l: "1", w: "2", h: "3" }),
    ];
    const remote = [
      row("1", { referencia: "A", bultos: "2" }),
      row("remote-new", { referencia: "R", bultos: "1", weight: "4" }),
    ];

    const merged = mergeConcurrentQuickRows(baseline, local, remote);
    expect(merged.map((r) => r.id)).toEqual(["1", "local-new", "remote-new"]);
  });

  it("respeta eliminaciones locales pendientes", () => {
    const baseline = [row("1"), row("2")];
    const local = [row("1", { l: "9" })];
    const remote = [row("1"), row("2", { l: "8" })];

    const merged = mergeConcurrentQuickRows(baseline, local, remote, {
      deletedIds: ["2"],
    });
    expect(merged.map((r) => r.id)).toEqual(["1"]);
    expect(merged[0]).toMatchObject({ l: "9.00" });
  });

  it("en el mismo campo prioriza el valor local si ambos cambiaron", () => {
    const baseline = [row("1", { l: "" })];
    const local = [row("1", { l: "10" })];
    const remote = [row("1", { l: "99" })];

    const merged = mergeConcurrentQuickRows(baseline, local, remote);
    expect(merged[0]?.l).toBe("10.00");
  });
});
