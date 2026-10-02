import { describe, expect, it } from "vitest";
import type { CollectionOrder } from "@/lib/types/collectionOrder";
import {
  collectionOrderMatchesSearch,
  filterCollectionOrdersBySearch,
} from "@/lib/collectionOrderListSearch";

function order(partial: Partial<CollectionOrder>): CollectionOrder {
  return {
    id: partial.id ?? "id",
    cliente: "",
    proveedor: "",
    lines: [],
    status: "draft",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("collectionOrderMatchesSearch", () => {
  const or6135 = order({
    numero: "6135",
    proveedor: "KENNEDY STRUCTURES CORPORACION",
    cliente: "COCOPLUM / LUZ MILENA DIAZ",
    lines: [{ id: "l1", referencia: "KFC-1666S" }],
    linkedRaNumbers: ["RA-881"],
  });

  it("busca por número con o sin #", () => {
    expect(collectionOrderMatchesSearch(or6135, "6135")).toBe(true);
    expect(collectionOrderMatchesSearch(or6135, "#6135")).toBe(true);
    expect(collectionOrderMatchesSearch(or6135, "6134")).toBe(false);
  });

  it("busca proveedor y cliente sin importar mayúsculas ni tildes", () => {
    expect(collectionOrderMatchesSearch(or6135, "kennedy")).toBe(true);
    expect(collectionOrderMatchesSearch(or6135, "díaz")).toBe(true);
  });

  it("todas las palabras deben coincidir (en cualquier campo)", () => {
    expect(collectionOrderMatchesSearch(or6135, "kennedy cocoplum")).toBe(true);
    expect(collectionOrderMatchesSearch(or6135, "kennedy bash")).toBe(false);
  });

  it("busca por referencia y por RA", () => {
    expect(collectionOrderMatchesSearch(or6135, "kfc-1666")).toBe(true);
    expect(collectionOrderMatchesSearch(or6135, "ra-881")).toBe(true);
  });

  it("búsqueda vacía no filtra", () => {
    const list = [or6135, order({ id: "b", numero: "1" })];
    expect(filterCollectionOrdersBySearch(list, "  ")).toHaveLength(2);
    expect(filterCollectionOrdersBySearch(list, "6135")).toHaveLength(1);
  });
});
