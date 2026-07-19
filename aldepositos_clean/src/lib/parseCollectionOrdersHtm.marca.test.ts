import { describe, expect, it } from "vitest";
import {
  collectionOrdersFromHtmRows,
  parseHtmRowsFromCellMatrix,
} from "@/lib/parseCollectionOrdersHtm";

describe("HTM número de seguimiento → marca", () => {
  it("lee la columna Número de seguimiento y la guarda como marca", () => {
    const rows = parseHtmRowsFromCellMatrix(
      [
        "Número",
        "Nombre Expedidor",
        "Nombre Consignatario",
        "Piezas",
        "Peso (kg)",
        "Volumen (m³)",
        "Nombre Proveedor",
        "Número de seguimiento",
      ],
      [
        [
          "3173",
          "EXP SA",
          "LOGI TRADING",
          "4",
          "10",
          "0.5",
          "PROV SA",
          "X10",
        ],
      ],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.marca).toBe("X10");
    expect(rows[0]!.cliente).toBe("LOGI TRADING");
    expect(rows[0]!.numero).toBe("3173");

    const orders = collectionOrdersFromHtmRows(rows);
    expect(orders[0]!.marca).toBe("X10");
  });

  it("no confunde Número de seguimiento con el Número de la OR", () => {
    const rows = parseHtmRowsFromCellMatrix(
      [
        "Número",
        "Número de seguimiento",
        "Nombre Consignatario",
        "Piezas",
        "Nombre Proveedor",
      ],
      [["2708", "ROCA LOGISTIC S.A", "Cliente A", "2", "Prov B"]],
    );

    expect(rows[0]!.numero).toBe("2708");
    expect(rows[0]!.marca).toBe("ROCA LOGISTIC S.A");
  });
});
