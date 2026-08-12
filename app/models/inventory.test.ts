import { describe, expect, it } from "vitest";

import {
  batchValuePesewas,
  compareLowStock,
  expiryTone,
  formatExpiry,
  formatSignedQuantity,
  isDispensable,
  isOutwardMovement,
  nextBatchOut,
  shortfallRatio,
  type LowStockItem,
  type StockBatch,
  type StockMovement,
} from "./inventory";
import type { ObjectId } from "./primitives";

/* -------------------------------------------------------------------------
   Fixtures
   ------------------------------------------------------------------------- */

let nextId = 0;

function oid(): ObjectId {
  return `65f3000000000000000000${String(nextId++).padStart(2, "0")}` as ObjectId;
}

function batch(overrides: Partial<StockBatch> = {}): StockBatch {
  const daysToExpiry = overrides.daysToExpiry ?? 180;
  return {
    id: oid(),
    productId: oid(),
    batchNumber: "B-1",
    expiryDate: "2027-01-31",
    daysToExpiry,
    expired: daysToExpiry < 0,
    quantityReceived: 100,
    quantityRemaining: 100,
    costPricePesewas: 25,
    receivedAt: "2026-01-31T09:00:00.000Z",
    ...overrides,
  };
}

function movement(quantity: number): StockMovement {
  return {
    id: oid(),
    productId: oid(),
    type: quantity < 0 ? "dispense" : "receipt",
    quantity,
    balanceAfter: 100 + quantity,
    at: "2026-08-12T09:00:00.000Z",
  };
}

function lowStock(overrides: Partial<LowStockItem> = {}): LowStockItem {
  return {
    productId: oid(),
    name: "Paracetamol 500mg",
    onHand: 50,
    reorderLevel: 100,
    unitOfIssue: "tablet",
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
   The signed ledger
   ------------------------------------------------------------------------- */

describe("formatSignedQuantity", () => {
  it("keeps the sign on both directions", () => {
    expect(formatSignedQuantity(40)).toBe("+40");
    // A true minus sign, not a hyphen — see the model note.
    expect(formatSignedQuantity(-12)).toBe("−12");
  });

  it("renders a zero movement as an addition rather than dropping the sign", () => {
    expect(formatSignedQuantity(0)).toBe("+0");
  });
});

describe("isOutwardMovement", () => {
  it("reads the sign, not the type", () => {
    expect(isOutwardMovement(movement(-5))).toBe(true);
    expect(isOutwardMovement(movement(5))).toBe(false);
    // An adjustment can go either way; the sign is the authority.
    expect(isOutwardMovement({ ...movement(-5), type: "adjustment" })).toBe(true);
  });
});

/* -------------------------------------------------------------------------
   Expiry
   ------------------------------------------------------------------------- */

describe("expiryTone", () => {
  it("shouts once the stock cannot be given to anyone", () => {
    expect(expiryTone(-1)).toBe("critical");
    expect(expiryTone(30, true)).toBe("critical");
  });

  it("warns inside the reporting horizon and stays quiet beyond it", () => {
    expect(expiryTone(0)).toBe("warning");
    expect(expiryTone(90)).toBe("warning");
    expect(expiryTone(91)).toBe("positive");
  });
});

describe("formatExpiry", () => {
  it("names each stage in the words a storekeeper uses", () => {
    expect(formatExpiry(-3)).toBe("Expired");
    expect(formatExpiry(0)).toBe("Expires today");
    expect(formatExpiry(12)).toBe("12 days left");
    expect(formatExpiry(180)).toBe("6 months left");
  });

  it("trusts the API's flag over its own arithmetic", () => {
    expect(formatExpiry(5, true)).toBe("Expired");
  });
});

/* -------------------------------------------------------------------------
   First expiry, first out
   ------------------------------------------------------------------------- */

describe("nextBatchOut", () => {
  it("takes the first batch that can actually be dispensed", () => {
    const expired = batch({ daysToExpiry: -10 });
    const empty = batch({ daysToExpiry: 20, quantityRemaining: 0 });
    const usable = batch({ daysToExpiry: 60 });

    // The API returns batches in expiry order; this is a find, not a sort.
    expect(nextBatchOut([expired, empty, usable])).toBe(usable);
  });

  it("is undefined when every batch is empty or expired", () => {
    expect(nextBatchOut([batch({ daysToExpiry: -1 })])).toBeUndefined();
    expect(nextBatchOut([])).toBeUndefined();
  });
});

describe("isDispensable", () => {
  it("needs stock and a date", () => {
    expect(isDispensable(batch())).toBe(true);
    expect(isDispensable(batch({ quantityRemaining: 0 }))).toBe(false);
    expect(isDispensable(batch({ daysToExpiry: -1 }))).toBe(false);
  });
});

describe("batchValuePesewas", () => {
  it("values what is left, not what arrived", () => {
    expect(batchValuePesewas(batch({ quantityRemaining: 40, costPricePesewas: 25 }))).toBe(
      1000,
    );
  });

  it("rounds a fractional remainder to whole pesewas", () => {
    // Money must stay an integer count of pesewas — see `~/lib/money`.
    expect(
      batchValuePesewas(batch({ quantityRemaining: 0.5, costPricePesewas: 25 })),
    ).toBe(13);
  });
});

/* -------------------------------------------------------------------------
   The buying list
   ------------------------------------------------------------------------- */

describe("shortfallRatio", () => {
  it("is zero at the line and one on an empty shelf", () => {
    expect(shortfallRatio(lowStock({ onHand: 100, reorderLevel: 100 }))).toBe(0);
    expect(shortfallRatio(lowStock({ onHand: 0, reorderLevel: 100 }))).toBe(1);
    expect(shortfallRatio(lowStock({ onHand: 25, reorderLevel: 100 }))).toBe(0.75);
  });

  it("never reports worse than empty when stock has overshot the level", () => {
    expect(shortfallRatio(lowStock({ onHand: 150, reorderLevel: 100 }))).toBe(0);
  });

  it("handles a product with no reorder level set", () => {
    expect(shortfallRatio(lowStock({ onHand: 0, reorderLevel: 0 }))).toBe(1);
    expect(shortfallRatio(lowStock({ onHand: 5, reorderLevel: 0 }))).toBe(0);
  });
});

describe("compareLowStock", () => {
  it("puts the emptiest shelf first, whatever it is called", () => {
    const nearlyOut = lowStock({ name: "Zinc", onHand: 5, reorderLevel: 100 });
    const halfway = lowStock({ name: "Amoxicillin", onHand: 50, reorderLevel: 100 });

    expect([halfway, nearlyOut].sort(compareLowStock).map((item) => item.name)).toEqual([
      "Zinc",
      "Amoxicillin",
    ]);
  });

  it("falls back to the name when two are equally short", () => {
    const a = lowStock({ name: "Amoxicillin", onHand: 50, reorderLevel: 100 });
    const z = lowStock({ name: "Zinc", onHand: 25, reorderLevel: 50 });

    expect([z, a].sort(compareLowStock).map((item) => item.name)).toEqual([
      "Amoxicillin",
      "Zinc",
    ]);
  });
});
