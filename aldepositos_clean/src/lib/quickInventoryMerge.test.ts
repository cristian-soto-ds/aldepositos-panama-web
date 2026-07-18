import { describe, expect, it } from "vitest";
import {
  allocatePalletNumber,
  groupRowsByPallet,
  mergeConcurrentQuickRows,
  quickRowsCaptureContainedIn,
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

  it("propaga borrado remoto: deja de mostrar la fila eliminada por otro", () => {
    const baseline = [
      row("1", { referencia: "A", bultos: "1" }),
      row("2", { referencia: "B", bultos: "1" }),
      row("3", { referencia: "C", bultos: "1" }),
    ];
    const local = [
      row("1", { referencia: "A", bultos: "1", l: "10" }),
      row("2", { referencia: "B", bultos: "1" }),
      row("3", { referencia: "C", bultos: "1" }),
    ];
    // El otro inventariador borró la fila 2.
    const remote = [
      row("1", { referencia: "A", bultos: "1" }),
      row("3", { referencia: "C", bultos: "1", weight: "2" }),
    ];

    const merged = mergeConcurrentQuickRows(baseline, local, remote);
    expect(merged.map((r) => r.id)).toEqual(["1", "3"]);
    expect(merged[0]).toMatchObject({ l: "10.00" });
    expect(merged[1]).toMatchObject({ weight: "2.00" });
  });

  it("propaga borrado local aunque el remoto aún traiga la fila", () => {
    const baseline = [row("1"), row("2")];
    const local = [row("1", { l: "5" })];
    const remote = [row("1"), row("2", { l: "8" })];

    const merged = mergeConcurrentQuickRows(baseline, local, remote);
    expect(merged.map((r) => r.id)).toEqual(["1"]);
    expect(merged[0]).toMatchObject({ l: "5.00" });
  });

  it("no interpreta un remoto vacío como borrar todas las filas", () => {
    const baseline = [row("1"), row("2")];
    const local = [row("1", { l: "1" }), row("2", { l: "2" })];
    const merged = mergeConcurrentQuickRows(baseline, local, []);
    expect(merged).toHaveLength(2);
  });

  it("con baseline atrasado, deletedIds propaga borrado de fila solo-en-vivo", () => {
    // La fila "live-only" llegó por canal en vivo y nunca entró al baseline BD.
    const baseline = [row("1", { referencia: "A", bultos: "1" })];
    const local = [
      row("1", { referencia: "A", bultos: "1", l: "10" }),
      row("live-only", { referencia: "X", bultos: "1" }),
    ];
    const remote = [row("1", { referencia: "A", bultos: "1" })];

    const merged = mergeConcurrentQuickRows(baseline, local, remote, {
      deletedIds: ["live-only"],
    });
    expect(merged.map((r) => r.id)).toEqual(["1"]);
    expect(merged[0]).toMatchObject({ l: "10.00" });
  });

  it("sin deletedIds, conserva alta local vacía no presente en remoto", () => {
    const baseline = [row("1", { referencia: "A", bultos: "1" })];
    const local = [
      row("1", { referencia: "A", bultos: "1" }),
      row("local-shell", { referencia: "L", bultos: "1" }),
    ];
    const remote = [row("1", { referencia: "A", bultos: "1" })];

    const merged = mergeConcurrentQuickRows(baseline, local, remote);
    expect(merged.map((r) => r.id)).toEqual(["1", "local-shell"]);
  });

  it("protectIds evita que un eco atrasado borre una paleta recién creada", () => {
    const baseline = [
      row("1", { referencia: "A", bultos: "1", pallet: 1 }),
      row("p2", { referencia: "B", bultos: "1", pallet: 2 }),
    ];
    const local = [
      row("1", { referencia: "A", bultos: "1", pallet: 1, l: "8" }),
      row("p2", { referencia: "B", bultos: "1", pallet: 2 }),
    ];
    // Eco de BD anterior a la creación de paleta 2.
    const remote = [row("1", { referencia: "A", bultos: "1", pallet: 1 })];

    const merged = mergeConcurrentQuickRows(baseline, local, remote, {
      protectIds: ["p2"],
    });
    expect(merged.map((r) => r.id)).toEqual(["1", "p2"]);
    expect(merged[1]).toMatchObject({ pallet: 2 });
  });

  it("agrupa filas nuevas de P1 junto a su paleta (no al final tras P2/P3)", () => {
    const baseline = [
      row("p1a", { pallet: 1, bultos: "1" }),
      row("p2a", { pallet: 2, bultos: "1" }),
      row("p3a", { pallet: 3, bultos: "1" }),
    ];
    const local = [
      ...baseline,
      row("p1b", { pallet: 1, bultos: "1", l: "10" }),
    ];
    const remote = baseline;

    const merged = mergeConcurrentQuickRows(baseline, local, remote);
    expect(merged.map((r) => r.id)).toEqual(["p1a", "p1b", "p2a", "p3a"]);
    expect(merged.map((r) => r.pallet)).toEqual([1, 1, 2, 3]);
  });

  it("une largo local y ancho remoto en la misma fila (tres inventariadores)", () => {
    const baseline = [row("1", { referencia: "A", bultos: "1" })];
    const local = [row("1", { referencia: "A", bultos: "1", l: "10.60" })];
    const remote = [row("1", { referencia: "A", bultos: "1", w: "10.60" })];

    const merged = mergeConcurrentQuickRows(baseline, local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ l: "10.60", w: "10.60" });
  });

  it("no borra una medida local cuando el remoto llega sin ese campo (save parcial)", () => {
    const baseline = [
      row("1", { referencia: "A", bultos: "1", l: "10.60", w: "10.60" }),
    ];
    const local = [
      row("1", { referencia: "A", bultos: "1", l: "10.60", w: "10.60" }),
    ];
    // Otro inventariador guardó solo el alto; su payload no trae L/W.
    const remote = [row("1", { referencia: "A", bultos: "1", h: "8.00" })];

    const merged = mergeConcurrentQuickRows(baseline, local, remote);
    expect(merged[0]).toMatchObject({
      l: "10.60",
      w: "10.60",
      h: "8.00",
    });
  });

  it("detecta cuando un save concurrente perdió medidas (containment)", () => {
    const written = [
      row("1", { l: "10", w: "20" }),
      row("2", { l: "30" }),
    ];
    const incomplete = [row("1", { l: "10" }), row("2", { l: "30" })];
    expect(quickRowsCaptureContainedIn(written, incomplete)).toBe(false);
    expect(
      quickRowsCaptureContainedIn(written, [
        row("1", { l: "10", w: "20" }),
        row("2", { l: "30", h: "5" }),
      ]),
    ).toBe(true);
  });
});

describe("groupRowsByPallet", () => {
  it("reordena [P1,P2,P3,P1] a [P1,P1,P2,P3]", () => {
    const rows = [
      row("a", { pallet: 1 }),
      row("b", { pallet: 2 }),
      row("c", { pallet: 3 }),
      row("d", { pallet: 1 }),
    ];
    expect(groupRowsByPallet(rows).map((r) => r.id)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });
});

describe("allocatePalletNumber", () => {
  it("sugiere max+1", () => {
    expect(
      allocatePalletNumber([
        row("a", { pallet: 1 }),
        row("b", { pallet: 2 }),
      ]),
    ).toBe(3);
  });

  it("si el preferido está ocupado, usa el siguiente libre", () => {
    expect(
      allocatePalletNumber(
        [row("a", { pallet: 1 }), row("b", { pallet: 2 })],
        2,
      ),
    ).toBe(3);
  });
});
