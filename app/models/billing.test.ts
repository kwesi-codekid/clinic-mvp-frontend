import { describe, expect, it } from "vitest";

import {
  billTotals,
  canCancelCharge,
  canWaiveCharge,
  chargeStatusTone,
  compareTariffPrecedence,
  describeTariffScope,
  invoiceStatusTone,
  isChargeCounted,
  isManualCharge,
  isTariffInForce,
  schemeCoverageSummary,
  type Charge,
  type InsuranceScheme,
  type Tariff,
} from "./billing";
import type { ChargeStatus } from "./enums";
import type { ObjectId } from "./primitives";

/* -------------------------------------------------------------------------
   Fixtures
   ------------------------------------------------------------------------- */

const oid = (suffix: string) =>
  (suffix.padStart(24, "0") as unknown) as ObjectId;

function charge(overrides: Partial<Charge> = {}): Charge {
  return {
    id: oid("1"),
    visitId: oid("2"),
    patientId: oid("3"),
    description: "General consultation",
    category: "consultation",
    quantity: 1,
    unitPricePesewas: 5000,
    grossPesewas: 5000,
    grossFormatted: "GHS 50.00",
    payerType: "nhis",
    coveredByPayer: true,
    payerPortionPesewas: 3000,
    patientPortionPesewas: 2000,
    patientPortionFormatted: "GHS 20.00",
    shortfallPesewas: 500,
    status: "pending",
    sourceType: "consultation",
    raisedAt: "2026-08-12T09:00:00Z",
    ...overrides,
  };
}

function tariff(overrides: Partial<Tariff> = {}): Tariff {
  return {
    id: oid("a"),
    chargeItemId: oid("b"),
    payerType: "nhis",
    schemeId: null,
    pricePesewas: 3000,
    priceFormatted: "GHS 30.00",
    covered: true,
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: null,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
   Charge lifecycle
   ------------------------------------------------------------------------- */

describe("canWaiveCharge / canCancelCharge", () => {
  it.each<[ChargeStatus, boolean]>([
    ["pending", true],
    ["billed", true],
    ["paid", false],
    ["waived", false],
    ["cancelled", false],
  ])("a %s charge → %s", (status, expected) => {
    expect(canWaiveCharge({ status })).toBe(expected);
    expect(canCancelCharge({ status })).toBe(expected);
  });
});

describe("isManualCharge", () => {
  it("only manual lines look editable", () => {
    expect(isManualCharge(charge({ sourceType: "manual" }))).toBe(true);
    expect(isManualCharge(charge({ sourceType: "lab_order" }))).toBe(false);
  });
});

describe("billTotals", () => {
  it("totals the counted lines", () => {
    const totals = billTotals([
      charge({ grossPesewas: 5000, payerPortionPesewas: 3000, patientPortionPesewas: 2000, shortfallPesewas: 0 }),
      charge({ grossPesewas: 1000, payerPortionPesewas: 0, patientPortionPesewas: 1000, shortfallPesewas: 200 }),
    ]);

    expect(totals).toEqual({
      grossPesewas: 6000,
      payerPortionPesewas: 3000,
      patientPortionPesewas: 3000,
      shortfallPesewas: 200,
    });
  });

  it("skips waived and cancelled lines — forgiven money is not owed", () => {
    const totals = billTotals([
      charge({ grossPesewas: 5000, patientPortionPesewas: 5000 }),
      charge({ status: "waived", grossPesewas: 9000, patientPortionPesewas: 9000 }),
      charge({ status: "cancelled", grossPesewas: 7000, patientPortionPesewas: 7000 }),
    ]);

    expect(totals.grossPesewas).toBe(5000);
    expect(totals.patientPortionPesewas).toBe(5000);
  });

  it("still counts paid lines — the bill reports what was billed, not what is left", () => {
    expect(isChargeCounted(charge({ status: "paid" }))).toBe(true);
    expect(billTotals([charge({ status: "paid", grossPesewas: 400 })]).grossPesewas).toBe(400);
  });

  it("handles an empty bill", () => {
    expect(billTotals([]).grossPesewas).toBe(0);
  });
});

describe("status tones", () => {
  it("keeps grey for closed outcomes and green for settled", () => {
    expect(chargeStatusTone("paid")).toBe("positive");
    expect(chargeStatusTone("waived")).toBe("muted");
    expect(chargeStatusTone("cancelled")).toBe("muted");
    expect(chargeStatusTone("pending")).toBe("warning");
    expect(chargeStatusTone("billed")).toBe("warning");

    expect(invoiceStatusTone("paid")).toBe("positive");
    expect(invoiceStatusTone("void")).toBe("muted");
    expect(invoiceStatusTone("open")).toBe("warning");
    expect(invoiceStatusTone("partly_paid")).toBe("warning");
  });
});

/* -------------------------------------------------------------------------
   Tariffs
   ------------------------------------------------------------------------- */

describe("isTariffInForce", () => {
  const from = Date.parse("2026-01-01T00:00:00Z");

  it("is not in force before it starts", () => {
    expect(isTariffInForce(tariff(), from - 1)).toBe(false);
    expect(isTariffInForce(tariff(), from)).toBe(true);
  });

  it("an open-ended tariff never lapses", () => {
    expect(isTariffInForce(tariff({ effectiveTo: null }), Date.parse("2099-01-01T00:00:00Z"))).toBe(
      true,
    );
  });

  it("a bounded tariff lapses after its end, inclusive of the end itself", () => {
    const bounded = tariff({ effectiveTo: "2026-06-30T23:59:59Z" });
    expect(isTariffInForce(bounded, Date.parse("2026-06-30T23:59:59Z"))).toBe(true);
    expect(isTariffInForce(bounded, Date.parse("2026-07-01T00:00:00Z"))).toBe(false);
  });
});

describe("compareTariffPrecedence", () => {
  it("puts a scheme-specific tariff ahead of a payer-wide one", () => {
    const wide = tariff({ effectiveFrom: "2026-06-01T00:00:00Z" });
    const specific = tariff({ schemeId: oid("c"), effectiveFrom: "2026-01-01T00:00:00Z" });

    expect([wide, specific].sort(compareTariffPrecedence)[0]).toBe(specific);
  });

  it("orders equals newest-first", () => {
    const older = tariff({ effectiveFrom: "2026-01-01T00:00:00Z" });
    const newer = tariff({ effectiveFrom: "2026-06-01T00:00:00Z" });

    expect([older, newer].sort(compareTariffPrecedence)[0]).toBe(newer);
  });
});

describe("describeTariffScope", () => {
  it("names the scheme when there is one", () => {
    expect(
      describeTariffScope(tariff({ schemeId: oid("c"), schemeName: "Acme Health" })),
    ).toBe("Acme Health");
  });

  it("describes the whole payer type when there is not", () => {
    expect(describeTariffScope(tariff({ payerType: "nhis" }))).toBe("All NHIS");
  });
});

/* -------------------------------------------------------------------------
   Schemes
   ------------------------------------------------------------------------- */

describe("schemeCoverageSummary", () => {
  const covers = (overrides: Partial<InsuranceScheme>) => ({
    coversConsultation: false,
    coversLab: false,
    coversDrugs: false,
    coversProcedures: false,
    coversAdmission: false,
    ...overrides,
  });

  it("lists what the contract covers, in a stable order", () => {
    expect(
      schemeCoverageSummary(covers({ coversConsultation: true, coversDrugs: true })),
    ).toEqual(["Consultation", "Drugs"]);
  });

  it("returns an empty list for a contract that covers nothing", () => {
    expect(schemeCoverageSummary(covers({}))).toEqual([]);
  });
});
