import { describe, expect, it } from "vitest";
import {
  getQuickRowMissingFields,
  isQuickRowComplete,
} from "@/lib/quickInventoryTypes";

describe("isQuickRowComplete", () => {
  it("exige peso además de medidas en modo normal", () => {
    expect(
      isQuickRowComplete({
        id: "1",
        referencia: "REF-1",
        bultos: 1,
        l: 10,
        w: 20,
        h: 30,
      }),
    ).toBe(false);

    expect(
      isQuickRowComplete({
        id: "1",
        referencia: "REF-1",
        bultos: 1,
        l: 10,
        w: 20,
        h: 30,
        weight: 5,
      }),
    ).toBe(true);
  });

  it("en paletizado acepta peso de paleta", () => {
    expect(
      isQuickRowComplete({
        id: "1",
        referencia: "REF-1",
        bultos: 1,
        l: 10,
        w: 20,
        h: 30,
        pallet: 1,
      }),
    ).toBe(false);

    expect(
      isQuickRowComplete({
        id: "1",
        referencia: "REF-1",
        bultos: 1,
        l: 10,
        w: 20,
        h: 30,
        pallet: 1,
        palletWeight: 40,
      }),
    ).toBe(true);
  });

  it("reempaque solo pide referencia", () => {
    expect(
      isQuickRowComplete({ id: "1", referencia: "R", reempaque: true }),
    ).toBe(true);
  });

  it("getQuickRowMissingFields incluye peso", () => {
    expect(
      getQuickRowMissingFields({
        id: "1",
        referencia: "REF-1",
        bultos: 1,
        l: 10,
        w: 20,
        h: 30,
      }),
    ).toEqual(["peso"]);
  });
});
