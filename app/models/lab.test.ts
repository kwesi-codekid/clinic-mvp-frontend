import { describe, expect, it } from "vitest";

import type { LabOrderStatus, Priority } from "./enums";
import {
  compareLabOrders,
  formatReferenceRange,
  itemsAtStage,
  orderProgress,
  rangeForPatient,
  specimensToCollect,
  type Analyte,
  type LabOrder,
  type LabOrderItem,
} from "./lab";
import type { ObjectId } from "./primitives";

/* -------------------------------------------------------------------------
   Fixtures
   ------------------------------------------------------------------------- */

let nextId = 0;

function oid(): ObjectId {
  return `65f1000000000000000000${String(nextId++).padStart(2, "0")}` as ObjectId;
}

function analyte(ranges: Analyte["ranges"]): Analyte {
  return { code: "HB", name: "Haemoglobin", resultType: "numeric", unit: "g/dL", ranges };
}

function item(
  overrides: Partial<LabOrderItem> & { status: LabOrderStatus },
): LabOrderItem {
  const id = oid();
  return {
    id,
    testId: id,
    testCode: "FBC",
    testName: "Full blood count",
    specimenType: "blood_edta",
    results: [],
    turnaroundTargetMinutes: 60,
    overdue: false,
    hasAbnormal: false,
    hasCritical: false,
    ...overrides,
  };
}

function order(
  overrides: {
    priority?: Priority;
    /** Minutes past a fixed origin, so bench order is explicit. */
    at?: number;
    items?: LabOrderItem[];
  } = {},
): LabOrder {
  const { priority = "routine", at = 0, items = [] } = overrides;
  const id = oid();
  return {
    id,
    accessionNumber: `LAB-${id.slice(-4)}`,
    visitId: id,
    patientId: id,
    status: "ordered",
    priority,
    items,
    orderedAt: new Date(Date.UTC(2026, 7, 12, 8, at)).toISOString(),
  };
}

/* -------------------------------------------------------------------------
   Reference-range resolution
   ------------------------------------------------------------------------- */

describe("rangeForPatient", () => {
  it("prefers the most narrowly-drawn matching range", () => {
    // Haemoglobin: differs by sex and age, exactly the spec's own example.
    const hb = analyte([
      { low: 11, high: 16 },
      { sex: "female", low: 12, high: 15.5 },
      { sex: "female", minAgeYears: 0, maxAgeYears: 12, low: 11.5, high: 14 },
    ]);

    expect(rangeForPatient(hb, "female", 30)).toEqual({ sex: "female", low: 12, high: 15.5 });
    expect(rangeForPatient(hb, "female", 6)).toEqual({
      sex: "female",
      minAgeYears: 0,
      maxAgeYears: 12,
      low: 11.5,
      high: 14,
    });
    // No male-specific range: the unqualified one applies.
    expect(rangeForPatient(hb, "male", 30)).toEqual({ low: 11, high: 16 });
  });

  it("skips age-narrowed ranges when the age is unknown", () => {
    const a = analyte([
      { minAgeYears: 18, low: 3.5, high: 5.1 },
      { low: 3, high: 6 },
    ]);
    // An estimated-age folder with no years must not be graded as an adult.
    expect(rangeForPatient(a, "male", undefined)).toEqual({ low: 3, high: 6 });
  });

  it("returns undefined when nothing matches", () => {
    const a = analyte([{ sex: "female", low: 12, high: 15.5 }]);
    expect(rangeForPatient(a, "male", 40)).toBeUndefined();
  });
});

describe("formatReferenceRange", () => {
  it("renders the numeric forms with the unit", () => {
    expect(formatReferenceRange({ low: 3.5, high: 5.1 }, "mmol/L")).toBe("3.5–5.1 mmol/L");
    expect(formatReferenceRange({ low: 60 }, "%")).toBe("≥ 60 %");
    expect(formatReferenceRange({ high: 5.5 }, "mmol/L")).toBe("≤ 5.5 mmol/L");
  });

  it("prefers the prose form and survives having nothing to say", () => {
    expect(formatReferenceRange({ normalText: "Negative", low: 0 })).toBe("Negative");
    expect(formatReferenceRange({ note: "fasting" })).toBeUndefined();
    expect(formatReferenceRange(undefined)).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------
   Bench ordering and progress
   ------------------------------------------------------------------------- */

describe("compareLabOrders", () => {
  it("sorts by priority, then by who has waited longest", () => {
    const routineEarly = order({ priority: "routine", at: 0 });
    const urgentLate = order({ priority: "urgent", at: 30 });
    const emergency = order({ priority: "emergency", at: 45 });
    const routineLate = order({ priority: "routine", at: 15 });

    const sorted = [routineLate, urgentLate, emergency, routineEarly].sort(compareLabOrders);
    expect(sorted).toEqual([emergency, urgentLate, routineEarly, routineLate]);
  });
});

describe("orderProgress", () => {
  it("counts verified items and drops rejected ones from the denominator", () => {
    const o = order({
      items: [
        item({ status: "verified" }),
        item({ status: "resulted" }),
        item({ status: "rejected" }),
        item({ status: "verified" }),
      ],
    });
    // The rejected item will never verify — reporting 2 of 4 would read as
    // unfinished work when the bench has nothing left to do on it.
    expect(orderProgress(o)).toEqual({ verified: 2, total: 3 });
  });
});

describe("itemsAtStage", () => {
  it("splits an order into the bench's three stages", () => {
    const pending = item({ status: "ordered" });
    const onBench = item({ status: "collected" });
    const awaiting = item({ status: "resulted" });
    const o = order({ items: [pending, onBench, awaiting, item({ status: "verified" })] });

    expect(itemsAtStage(o, "ordered")).toEqual([pending]);
    expect(itemsAtStage(o, "collected")).toEqual([onBench]);
    expect(itemsAtStage(o, "resulted")).toEqual([awaiting]);
  });
});

describe("specimensToCollect", () => {
  it("deduplicates tubes and ignores tests that need no specimen", () => {
    const items = [
      item({ status: "ordered", specimenType: "blood_edta" }),
      item({ status: "ordered", specimenType: "blood_edta" }),
      item({ status: "ordered", specimenType: "urine" }),
      item({ status: "ordered", specimenType: "none" }),
    ];
    // One EDTA tube covers both blood tests.
    expect(specimensToCollect(items)).toEqual(["blood_edta", "urine"]);
  });
});
