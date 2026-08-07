import { describe, expect, it } from "vitest";
import {
  defaultWarehouseClientSeeds,
  normalizeWarehouseClientText,
  resolveCanonicalWarehouseClient,
} from "@/lib/warehouse/client-resolver";
import {
  isCompletedInventoryStatus,
  mapTaskToWarehouseRA,
  buildOrderBarcode,
  buildPackageBarcode,
  buildPackageBarcodeList,
  parsePackageBarcode,
} from "@/lib/warehouse/task-adapter";

describe("client-resolver", () => {
  const clients = defaultWarehouseClientSeeds();

  it("normaliza acentos y espacios", () => {
    expect(normalizeWarehouseClientText("  ááa  ")).toBe("AAA");
  });

  it("resuelve AAA exacto", () => {
    expect(resolveCanonicalWarehouseClient("AAA", clients)).toBe("AAA");
  });

  it("resuelve IMPOMEX DE COLOMBIA LTDA exacto", () => {
    expect(
      resolveCanonicalWarehouseClient("IMPOMEX DE COLOMBIA LTDA", clients),
    ).toBe("IMPOMEX");
    expect(resolveCanonicalWarehouseClient("IMPOMEX", clients)).toBe("IMPOMEX");
  });

  it("no usa substring peligroso", () => {
    expect(resolveCanonicalWarehouseClient("XJH Y", clients)).toBeNull();
    expect(resolveCanonicalWarehouseClient("IMPOMEX SA", clients)).toBeNull();
  });
});

describe("task-adapter", () => {
  const clients = defaultWarehouseClientSeeds();

  it("solo reconoce completed + cliente canónico", () => {
    const completed = mapTaskToWarehouseRA(
      {
        id: "t1",
        ra: "64197",
        mainClient: "AAA",
        provider: "PROV SA",
        subClient: "N/A",
        brand: "REF-1",
        expectedBultos: 40,
        currentBultos: 40,
        expectedWeight: 100,
        expectedCbm: 1.2,
        status: "completed",
      },
      clients,
    );
    expect(completed.recognized).toBe(true);
    expect(completed.shipper).toBe("PENDIENTE DE ASIGNAR");
    expect(completed.clientDisplay).toBe("AAA");

    const pending = mapTaskToWarehouseRA(
      {
        id: "t2",
        ra: "1",
        mainClient: "AAA",
        status: "pending",
      },
      clients,
    );
    expect(pending.recognized).toBe(false);
    expect(isCompletedInventoryStatus("completed")).toBe(true);
  });

  it("mezcla marca + RA", () => {
    expect(buildOrderBarcode("424/AAA", "64353")).toBe("424/AAA64353");
  });

  it("arma y parsea Marca+RA-bulto y formatos legados", () => {
    expect(
      buildPackageBarcode(
        { ra: "64353", seq: 1, orderRef: "424/AAA" },
        "marca_ra_bulto",
      ),
    ).toBe("424/AAA64353-1");
    expect(
      buildPackageBarcode(
        {
          ra: "64353",
          seq: 12,
          orderBarcode: "424/AAA64353",
        },
        "marca_ra_bulto",
      ),
    ).toBe("424/AAA64353-12");

    expect(buildPackageBarcode({ ra: "64368", seq: 1 }, "corto")).toBe(
      "64368-001",
    );
    expect(buildPackageBarcode({ ra: "64368", seq: 30 }, "corto")).toBe(
      "64368-030",
    );
    expect(
      buildPackageBarcode(
        {
          ra: "64368",
          seq: 1,
          total: 18,
          orderBarcode: "EXP-AAA-0003-64368",
        },
        "completo",
      ),
    ).toBe("EXP-AAA-0003-64368-001/018");
    expect(
      buildPackageBarcode(
        {
          ra: "64368",
          seq: 1,
          orderBarcode: "EXP-AAA-0003-64368",
        },
        "expedidor_ra_bulto",
      ),
    ).toBe("EXP-AAA-0003-64368-001");

    expect(parsePackageBarcode("424/AAA64353-1")).toMatchObject({
      ra: "64353",
      seq: 1,
      format: "marca_ra_bulto",
    });
    expect(parsePackageBarcode("64368-001")).toMatchObject({
      ra: "64368",
      seq: 1,
      format: "corto",
    });
    expect(parsePackageBarcode("EXP-AAA-0003-64368-001/018")).toMatchObject({
      ra: "64368",
      seq: 1,
      total: 18,
      format: "completo",
    });
    expect(parsePackageBarcode("EXP-IMPOMEX-0001-64368-001")).toMatchObject({
      ra: "64368",
      seq: 1,
      format: "expedidor_ra_bulto",
    });
    expect(parsePackageBarcode("EXP-IMPOMEX-0001-64368")).toBeNull();
    expect(parsePackageBarcode("basura")).toBeNull();
    expect(
      buildPackageBarcodeList(
        { ra: "64353", orderRef: "424/AAA" },
        3,
        "marca_ra_bulto",
      ),
    ).toEqual(["424/AAA64353-1", "424/AAA64353-2", "424/AAA64353-3"]);
  });
});
