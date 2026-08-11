import { describe, expect, it } from "vitest";

import { formatPesewas, money, sumPesewas, toPesewas, tryToPesewas } from "./money";

describe("formatPesewas", () => {
  it("renders pesewas as cedis and pesewas", () => {
    expect(formatPesewas(1235)).toBe("GHS 12.35");
    expect(formatPesewas(0)).toBe("GHS 0.00");
    expect(formatPesewas(5)).toBe("GHS 0.05");
    expect(formatPesewas(100)).toBe("GHS 1.00");
  });

  it("groups thousands", () => {
    expect(formatPesewas(123456789)).toBe("GHS 1,234,567.89");
    expect(formatPesewas(123456789, { grouping: false })).toBe("GHS 1234567.89");
  });

  it("handles negatives, for waivers and till variance", () => {
    expect(formatPesewas(-1235)).toBe("GHS -12.35");
    expect(formatPesewas(-50, { symbol: "none" })).toBe("-0.50");
    expect(formatPesewas(-1235, { symbol: "₵" })).toBe("-₵12.35");
  });

  it("supports the cedi sign and a bare amount", () => {
    expect(formatPesewas(1235, { symbol: "₵" })).toBe("₵12.35");
    expect(formatPesewas(1235, { symbol: "none" })).toBe("12.35");
  });

  it("refuses fractional pesewas", () => {
    expect(() => formatPesewas(12.5)).toThrow(TypeError);
  });
});

describe("toPesewas", () => {
  it("reads plain and decorated cedis strings", () => {
    expect(toPesewas("12.35")).toBe(1235);
    expect(toPesewas("GHS 12.35")).toBe(1235);
    expect(toPesewas("ghs 12.35")).toBe(1235);
    expect(toPesewas("₵12.35")).toBe(1235);
    expect(toPesewas(" 1,234.50 ")).toBe(123450);
  });

  it("pads a single decimal place", () => {
    expect(toPesewas("12.3")).toBe(1230);
    expect(toPesewas("12")).toBe(1200);
  });

  it("reads numbers without floating-point drift", () => {
    expect(toPesewas(12.35)).toBe(1235);
    expect(toPesewas(0.1)).toBe(10);
    expect(toPesewas(1e6)).toBe(100_000_000);
  });

  it("keeps the sign", () => {
    expect(toPesewas("-12.35")).toBe(-1235);
  });

  it("rejects input it cannot read exactly", () => {
    expect(() => toPesewas("12.345")).toThrow(TypeError);
    expect(() => toPesewas("twelve")).toThrow(TypeError);
    expect(() => toPesewas("")).toThrow(TypeError);
    expect(() => toPesewas("12.35 GHS")).toThrow(TypeError);
    expect(() => toPesewas(Number.NaN)).toThrow(TypeError);
  });
});

describe("round trip", () => {
  it("holds for GHS 12.35 ↔ 1235", () => {
    expect(toPesewas("12.35")).toBe(1235);
    expect(formatPesewas(1235, { symbol: "none" })).toBe("12.35");
    expect(toPesewas(formatPesewas(1235))).toBe(1235);
  });

  it("holds across a spread of amounts", () => {
    const amounts = [0, 1, 5, 99, 100, 1235, 50_000, 123_456_789, -1235];
    for (const pesewas of amounts) {
      expect(toPesewas(formatPesewas(pesewas))).toBe(pesewas);
    }
  });
});

describe("tryToPesewas", () => {
  it("returns null for empty or unreadable input", () => {
    expect(tryToPesewas("")).toBeNull();
    expect(tryToPesewas("   ")).toBeNull();
    expect(tryToPesewas(null)).toBeNull();
    expect(tryToPesewas(undefined)).toBeNull();
    expect(tryToPesewas("abc")).toBeNull();
  });

  it("parses what it can", () => {
    expect(tryToPesewas("12.35")).toBe(1235);
    expect(tryToPesewas(0)).toBe(0);
  });
});

describe("sumPesewas", () => {
  it("adds integers exactly", () => {
    expect(sumPesewas([1035, 200, 15])).toBe(1250);
    expect(sumPesewas([])).toBe(0);
  });

  it("adds Money objects and raw pesewas together", () => {
    const charges = [
      { pesewas: 1035, formatted: "GHS 10.35" },
      { pesewas: 200, formatted: "GHS 2.00" },
    ];
    expect(sumPesewas([...charges, 15])).toBe(1250);
  });

  it("subtracts through negatives", () => {
    expect(sumPesewas([5000, -1235])).toBe(3765);
  });

  it("does not drift where floats would", () => {
    // 0.1 + 0.2 in cedis is the classic float failure; in pesewas it is exact.
    expect(sumPesewas(Array.from({ length: 10 }, () => 10))).toBe(100);
    expect(formatPesewas(sumPesewas([10, 20]))).toBe("GHS 0.30");
  });

  it("refuses fractional pesewas", () => {
    expect(() => sumPesewas([100, 0.5])).toThrow(TypeError);
  });
});

describe("money", () => {
  it("builds the API's Money shape for locally computed totals", () => {
    expect(money(1235)).toEqual({ pesewas: 1235, formatted: "GHS 12.35" });
    expect(money(sumPesewas([1035, 200]))).toEqual({
      pesewas: 1235,
      formatted: "GHS 12.35",
    });
  });
});
