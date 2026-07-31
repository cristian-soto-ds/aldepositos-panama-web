import { describe, expect, it } from "vitest";
import {
  buildPalletClaimsForRa,
  findNextFreePallet,
  isPalletClaimedByOther,
  claimForPallet,
} from "@/lib/palletLocks";
import type { WorkPresenceEntry } from "@/lib/panelPresence";

function entry(
  partial: Partial<WorkPresenceEntry> &
    Pick<WorkPresenceEntry, "userKey" | "userLabel" | "ra">,
): WorkPresenceEntry {
  return {
    tabId: partial.tabId ?? `tab-${partial.userKey}`,
    userKey: partial.userKey,
    userLabel: partial.userLabel,
    avatarUrl: null,
    ra: partial.ra,
    module: partial.module ?? "quick",
    activePallet: partial.activePallet ?? null,
    updatedAt: Date.now(),
  };
}

describe("palletLocks", () => {
  it("buildPalletClaimsForRa maps inventariador activePallet", () => {
    const claims = buildPalletClaimsForRa(
      [
        entry({
          userKey: "jahir@aldepositos.com",
          userLabel: "Jahir Jimenez",
          ra: "TIGRE-70",
          activePallet: 1,
        }),
        entry({
          userKey: "claudio@aldepositos.com",
          userLabel: "Claudio Gutierrez",
          ra: "TIGRE-70",
          activePallet: 2,
        }),
      ],
      "tigre-70",
    );
    expect(claimForPallet(claims, 1)?.userLabel).toMatch(/Jahir/i);
    expect(claimForPallet(claims, 2)?.userKey).toBe("claudio@aldepositos.com");
  });

  it("isPalletClaimedByOther ignores own claim", () => {
    const claims = buildPalletClaimsForRa(
      [
        entry({
          userKey: "raul@aldepositos.com",
          userLabel: "Raul Lezcano",
          ra: "RA1",
          activePallet: 3,
        }),
      ],
      "RA1",
    );
    expect(isPalletClaimedByOther(claims, 3, "raul@aldepositos.com")).toBe(false);
    expect(isPalletClaimedByOther(claims, 3, "jahir@aldepositos.com")).toBe(true);
  });

  it("findNextFreePallet skips occupied and returns max+1 when full", () => {
    const claims = buildPalletClaimsForRa(
      [
        entry({
          userKey: "jahir@aldepositos.com",
          userLabel: "Jahir Jimenez",
          ra: "RA1",
          activePallet: 1,
        }),
        entry({
          userKey: "claudio@aldepositos.com",
          userLabel: "Claudio Gutierrez",
          ra: "RA1",
          activePallet: 2,
        }),
      ],
      "RA1",
    );
    expect(
      findNextFreePallet([1, 2], claims, "raul@aldepositos.com"),
    ).toBe(3);
    expect(
      findNextFreePallet([1, 2, 3], claims, "jahir@aldepositos.com"),
    ).toBe(1);
  });
});
