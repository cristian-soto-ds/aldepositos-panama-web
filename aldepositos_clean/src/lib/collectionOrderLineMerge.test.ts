import { describe, expect, it } from "vitest";
import { mergeConcurrentCollectionLines } from "@/lib/collectionOrderLineMerge";
import type { CollectionOrderLine } from "@/lib/types/collectionOrder";

function line(
  id: string,
  fields: Partial<CollectionOrderLine> = {},
): CollectionOrderLine {
  return { id, referencia: fields.referencia ?? id, ...fields };
}

describe("mergeConcurrentCollectionLines", () => {
  it("conserva filas nuevas locales aunque el remoto aún no las tenga", () => {
    const baseline = [line("1"), line("2"), line("3")];
    const local = [
      line("1"),
      line("2"),
      line("3"),
      line("4"),
      line("5"),
      line("6"),
      line("7"),
      line("8"),
      line("9"),
      line("10"),
    ];
    const remote = [line("1"), line("2"), line("3")];

    const merged = mergeConcurrentCollectionLines(baseline, local, remote);
    expect(merged.map((l) => l.id)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
    ]);
  });

  it("añade filas nuevas remotas sin perder las locales", () => {
    const baseline = [line("1")];
    const local = [line("1", { referencia: "A" }), line("local-new")];
    const remote = [line("1", { referencia: "A" }), line("remote-new")];

    const merged = mergeConcurrentCollectionLines(baseline, local, remote);
    expect(merged.map((l) => l.id)).toEqual(["1", "local-new", "remote-new"]);
  });

  it("propaga borrado remoto", () => {
    const baseline = [line("1"), line("2"), line("3")];
    const local = [
      line("1", { referencia: "kept" }),
      line("2"),
      line("3"),
    ];
    const remote = [line("1"), line("3", { bultos: "2" })];

    const merged = mergeConcurrentCollectionLines(baseline, local, remote);
    expect(merged.map((l) => l.id)).toEqual(["1", "3"]);
    expect(merged[0]?.referencia).toBe("kept");
    expect(merged[1]?.bultos).toBe("2");
  });

  it("no interpreta remoto vacío como borrar todo", () => {
    const baseline = [line("1"), line("2")];
    const local = [line("1"), line("2")];
    const merged = mergeConcurrentCollectionLines(baseline, local, []);
    expect(merged).toHaveLength(2);
  });

  it("en el mismo campo prioriza local si ambos cambiaron", () => {
    const baseline = [line("1", { referencia: "" })];
    const local = [line("1", { referencia: "LOCAL" })];
    const remote = [line("1", { referencia: "REMOTE" })];
    const merged = mergeConcurrentCollectionLines(baseline, local, remote);
    expect(merged[0]?.referencia).toBe("LOCAL");
  });
});
