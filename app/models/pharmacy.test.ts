import { describe, expect, it } from "vitest";

import type { Frequency, PrescriptionItemStatus } from "./enums";
import type { Product } from "./inventory";
import type { Allergy } from "./patient";
import {
  allergyMatches,
  comparePrescriptions,
  dispensableNow,
  estimateQuantity,
  isActiveItem,
  isSettled,
  prescriptionProgress,
  type Prescription,
  type PrescriptionItem,
} from "./pharmacy";
import type { ObjectId } from "./primitives";

/* -------------------------------------------------------------------------
   Fixtures
   ------------------------------------------------------------------------- */

let nextId = 0;

function oid(): ObjectId {
  return `65f2000000000000000000${String(nextId++).padStart(2, "0")}` as ObjectId;
}

function item(
  overrides: Partial<PrescriptionItem> & { status: PrescriptionItemStatus },
): PrescriptionItem {
  return {
    id: oid(),
    productId: oid(),
    drugName: "Amoxicillin 500mg",
    dose: "1 capsule",
    frequency: "tds",
    frequencyLabel: "Three times daily",
    durationDays: 5,
    route: "oral",
    directions: "1 capsule three times daily for 5 days",
    quantityPrescribed: 15,
    quantityDispensed: 0,
    quantityOutstanding: 15,
    dispenses: [],
    ...overrides,
  };
}

function prescription(items: PrescriptionItem[], at = 0): Prescription {
  return {
    id: oid(),
    visitId: oid(),
    patientId: oid(),
    status: "pending",
    items,
    prescribedAt: new Date(Date.UTC(2026, 7, 12, 9, at)).toISOString(),
  };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: oid(),
    code: "AMOX500",
    genericName: "Amoxicillin",
    label: "Amoxicillin 500mg (Amoxil)",
    brandName: "Amoxil",
    dosageForm: "capsule",
    category: "drug",
    unitOfIssue: "capsule",
    packSize: 100,
    reorderLevel: 200,
    isControlled: false,
    isOnNhisList: true,
    active: true,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
   Quantity derivation
   ------------------------------------------------------------------------- */

describe("estimateQuantity", () => {
  it("multiplies units, daily doses and days", () => {
    expect(estimateQuantity({ doseUnits: 1, frequency: "tds", durationDays: 5 })).toBe(15);
    expect(estimateQuantity({ doseUnits: 2, frequency: "bd", durationDays: 7 })).toBe(28);
  });

  it("defaults to one unit per dose", () => {
    expect(estimateQuantity({ frequency: "od", durationDays: 3 })).toBe(3);
  });

  it("counts an hourly frequency by its doses, not by the clock", () => {
    expect(estimateQuantity({ doseUnits: 1, frequency: "q6h", durationDays: 2 })).toBe(8);
  });

  it("survives the floating point in a weekly course", () => {
    // 3 * (1/7) * 14 is 5.999999999999999 before rounding.
    expect(estimateQuantity({ doseUnits: 3, frequency: "weekly", durationDays: 14 })).toBe(6);
  });

  it("rounds up — half a tablet cannot be counted into a bag", () => {
    expect(estimateQuantity({ doseUnits: 0.5, frequency: "od", durationDays: 3 })).toBe(2);
  });

  it("gives a stat dose once, whatever the duration says", () => {
    expect(estimateQuantity({ doseUnits: 2, frequency: "stat", durationDays: 5 })).toBe(2);
  });

  it("refuses to guess where the instruction implies no quantity", () => {
    expect(estimateQuantity({ frequency: "prn", durationDays: 30 })).toBeUndefined();
    expect(estimateQuantity({ frequency: "tds", durationDays: 0 })).toBeUndefined();
    expect(estimateQuantity({ doseUnits: 0, frequency: "tds", durationDays: 5 })).toBeUndefined();
  });

  it("has a rate for every frequency but the two that have none", () => {
    const frequencies: Frequency[] = [
      "od",
      "bd",
      "tds",
      "qid",
      "nocte",
      "mane",
      "q4h",
      "q6h",
      "q8h",
      "q12h",
      "weekly",
    ];
    for (const frequency of frequencies) {
      expect(estimateQuantity({ frequency, durationDays: 7 })).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------
   Allergies
   ------------------------------------------------------------------------- */

describe("allergyMatches", () => {
  const allergies: Allergy[] = [
    { substance: "Penicillin", reaction: "rash" },
    { substance: "Sulfa drugs" },
  ];

  it("matches the generic name", () => {
    expect(allergyMatches([{ substance: "Amoxicillin" }], product())).toHaveLength(1);
  });

  it("matches the brand name", () => {
    expect(allergyMatches([{ substance: "Amoxil" }], product())).toHaveLength(1);
  });

  it("matches a word of a multi-word substance", () => {
    const cotrimoxazole = product({
      genericName: "Sulfamethoxazole + Trimethoprim",
      label: "Sulfamethoxazole 400mg",
      brandName: undefined,
    });
    expect(allergyMatches(allergies, cotrimoxazole).map((a) => a.substance)).toEqual([
      "Sulfa drugs",
    ]);
  });

  it("ignores case and punctuation", () => {
    expect(
      allergyMatches([{ substance: "  amoxicillin.  " }], product()),
    ).toHaveLength(1);
  });

  it("does not fire on a short word shared with half the shelf", () => {
    const oil = product({
      genericName: "Cod liver oil",
      label: "Cod liver oil 100ml",
      brandName: undefined,
    });
    expect(allergyMatches([{ substance: "Tea tree oil" }], oil)).toHaveLength(0);
  });

  it("knows nothing about drug classes — a penicillin relative is missed", () => {
    // Documented behaviour, not an oversight: this is why the screen shows the
    // whole allergy list rather than only the matches.
    expect(allergyMatches(allergies, product())).toHaveLength(0);
  });

  it("returns nothing for an empty folder", () => {
    expect(allergyMatches([], product())).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
   Derived views
   ------------------------------------------------------------------------- */

describe("prescriptionProgress", () => {
  it("counts dispensed and outstanding, and drops cancelled lines", () => {
    const script = prescription([
      item({ status: "dispensed", quantityDispensed: 15, quantityOutstanding: 0 }),
      item({ status: "partially_dispensed", quantityDispensed: 5, quantityOutstanding: 10 }),
      item({ status: "pending" }),
      item({ status: "cancelled" }),
    ]);

    expect(prescriptionProgress(script)).toEqual({
      dispensed: 1,
      outstanding: 2,
      closed: 1,
      total: 3,
    });
  });

  it("counts an out-of-stock and a substituted line as closed, not dispensed", () => {
    const script = prescription([
      item({ status: "out_of_stock" }),
      item({ status: "substituted" }),
    ]);

    expect(prescriptionProgress(script)).toEqual({
      dispensed: 0,
      outstanding: 0,
      closed: 2,
      total: 2,
    });
    expect(isSettled(script)).toBe(true);
  });
});

describe("isActiveItem", () => {
  it("is true only while something is still owed", () => {
    expect(isActiveItem(item({ status: "pending" }))).toBe(true);
    expect(isActiveItem(item({ status: "partially_dispensed" }))).toBe(true);
    expect(isActiveItem(item({ status: "dispensed" }))).toBe(false);
    expect(isActiveItem(item({ status: "out_of_stock" }))).toBe(false);
  });
});

describe("dispensableNow", () => {
  it("is capped by the shelf", () => {
    expect(
      dispensableNow(item({ status: "pending", quantityOutstanding: 15, stockOnHand: 6 })),
    ).toBe(6);
  });

  it("is capped by what is owed", () => {
    expect(
      dispensableNow(item({ status: "pending", quantityOutstanding: 15, stockOnHand: 90 })),
    ).toBe(15);
  });

  it("distinguishes an unchecked shelf from an empty one", () => {
    expect(dispensableNow(item({ status: "pending" }))).toBeUndefined();
    expect(
      dispensableNow(item({ status: "pending", stockOnHand: 0 })),
    ).toBe(0);
  });
});

describe("comparePrescriptions", () => {
  it("puts the longest wait first", () => {
    const early = prescription([], 0);
    const late = prescription([], 30);
    expect([late, early].sort(comparePrescriptions)).toEqual([early, late]);
  });
});
