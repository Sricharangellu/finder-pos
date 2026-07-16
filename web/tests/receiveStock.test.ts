import { describe, it, expect } from "vitest";
import {
  buildReceiveLines,
  computeTotal,
  type ReceiveEntry,
} from "@/app/(protected)/inventory/receive-stock/_components/receiveStockTypes";

function entry(over: Partial<ReceiveEntry>): ReceiveEntry {
  return { lineId: "l1", cases: "1", unitsPerCase: "1", totalQty: 1, expiryDate: "", locationId: "", ...over };
}

describe("buildReceiveLines", () => {
  it("carries desk-entered expiry (as epoch ms) and location through to the payload", () => {
    const lines = buildReceiveLines([
      entry({ lineId: "l1", totalQty: 12, expiryDate: "2027-06-30", locationId: "loc_a" }),
    ]);
    expect(lines).toEqual([
      { lineId: "l1", qty: 12, expiryDate: new Date("2027-06-30").getTime(), locationId: "loc_a" },
    ]);
  });

  it("omits expiry and location when the operator left them blank (no null noise)", () => {
    const lines = buildReceiveLines([entry({ lineId: "l2", totalQty: 5, expiryDate: "", locationId: "" })]);
    expect(lines).toEqual([{ lineId: "l2", qty: 5 }]);
    expect(lines[0]).not.toHaveProperty("expiryDate");
    expect(lines[0]).not.toHaveProperty("locationId");
  });

  it("drops lines with zero quantity", () => {
    const lines = buildReceiveLines([
      entry({ lineId: "l1", totalQty: 0, locationId: "loc_x" }),
      entry({ lineId: "l2", totalQty: 3 }),
    ]);
    expect(lines.map((l) => l.lineId)).toEqual(["l2"]);
  });

  it("ignores an unparseable expiry date rather than sending NaN", () => {
    const lines = buildReceiveLines([entry({ lineId: "l1", totalQty: 4, expiryDate: "not-a-date" })]);
    expect(lines[0]).not.toHaveProperty("expiryDate");
  });
});

describe("computeTotal", () => {
  it("multiplies cases by units-per-case", () => {
    expect(computeTotal("3", "12")).toBe(36);
  });
  it("returns 0 for non-positive or invalid input", () => {
    expect(computeTotal("0", "12")).toBe(0);
    expect(computeTotal("x", "12")).toBe(0);
  });
});
