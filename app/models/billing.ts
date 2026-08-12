/**
 * Billing — the charge catalogue, per-visit charges, invoices, tariffs and the
 * payers behind them (T8.1, T8.2).
 *
 * Modelled from `components.schemas.{ChargeItem, Charge, Invoice, VisitBill,
 * Tariff, PriceQuote, InsuranceScheme}` and their write bodies.
 *
 * Three facts shape every screen in this module:
 *
 * 1. **The split is computed by the API, not the UI.** A {@link Charge} arrives
 *    already divided into `payerPortionPesewas`, `patientPortionPesewas` and
 *    `shortfallPesewas` against the visit's **frozen** payer snapshot. Nothing
 *    here re-derives the split from a scheme's rules — the screens render the
 *    API's arithmetic, and the local sums in {@link billTotals} exist only for
 *    the moment before an invoice has been issued.
 * 2. **The patient portion is the headline; the shortfall is finance's.**
 *    `patientPortionPesewas` is what the person at the counter must find before
 *    leaving. `shortfallPesewas` — how far the payer tariff falls below the
 *    clinic price — is absorbed by the clinic and belongs on finance screens,
 *    not on a bill a patient reads.
 * 3. **Waive ≠ cancel.** A waiver forgives a legitimate charge and is reported
 *    on; a cancellation removes a line raised in error. {@link canWaiveCharge}
 *    and {@link canCancelCharge} share one definition of "still open" so no
 *    screen invents its own.
 */

import type {
  ChargeCategory,
  ChargeSource,
  ChargeStatus,
  InvoiceStatus,
  PayerType,
} from "./enums";
import { PayerTypes } from "./enums";
import { sumPesewas } from "~/lib/money";
import type { IsoDate, IsoDateTime, ObjectId } from "./primitives";

/* -------------------------------------------------------------------------
   Catalogue (T8.1)
   ------------------------------------------------------------------------- */

/**
 * Anything the clinic can put on a bill.
 *
 * `isOnNhisList: false` is the usual co-payment trigger: an NHIS patient pays
 * for that item in full, and the screens should say so *before* it is ordered
 * rather than at the till.
 */
export type ChargeItem = {
  id: ObjectId;
  code: string;
  name: string;
  category: ChargeCategory;
  /** What one unit is — a consultation, a test, a night. */
  unit: string;
  /** The clinic's own cash price for one unit. */
  basePricePesewas: number;
  basePriceFormatted: string;
  /** G-DRG code NHIS reimburses this service under. */
  nhisGdrgCode?: string;
  nhisMedicineCode?: string;
  isOnNhisList: boolean;
  nhisTariffPesewas?: number;
  active: boolean;
};

/**
 * What one payer pays for one item, inside a date range.
 *
 * A tariff naming a specific scheme takes precedence over one covering the
 * whole payer type — see {@link compareTariffPrecedence}. Always display which
 * tariff was applied; never assume the current one, because a charge raised
 * last month was priced against last month's.
 */
export type Tariff = {
  id: ObjectId;
  chargeItemId: ObjectId;
  chargeItemName?: string;
  payerType: PayerType;
  /** `null` covers the whole payer type; an id narrows it to one scheme. */
  schemeId: ObjectId | null;
  schemeName?: string;
  pricePesewas: number;
  priceFormatted: string;
  covered: boolean;
  effectiveFrom: IsoDateTime;
  /** `null` is open-ended. */
  effectiveTo: IsoDateTime | null;
  note?: string;
};

/* -------------------------------------------------------------------------
   Charges & invoices (T8.1)
   ------------------------------------------------------------------------- */

/**
 * One priced line on a visit, already split by payer.
 *
 * `coverageNote` is plain words, written to be readable to the patient —
 * render it verbatim rather than composing an explanation from the flags.
 */
export type Charge = {
  id: ObjectId;
  visitId: ObjectId;
  patientId: ObjectId;
  /** Absent until the line lands on an invoice. */
  invoiceId?: ObjectId;
  /** Absent on lines priced without a catalogue item. */
  chargeItemId?: ObjectId;
  description: string;
  category: ChargeCategory;
  quantity: number;
  unitPricePesewas: number;
  grossPesewas: number;
  grossFormatted: string;
  /** The visit's frozen payer — never the folder's current profile. */
  payerType: PayerType;
  schemeName?: string;
  coveredByPayer: boolean;
  /** Plain-words reason, readable to the patient. */
  coverageNote?: string;
  payerPortionPesewas: number;
  patientPortionPesewas: number;
  patientPortionFormatted: string;
  /** How far the payer tariff falls below the clinic price — absorbed by the clinic. */
  shortfallPesewas: number;
  status: ChargeStatus;
  sourceType: ChargeSource;
  raisedAt: IsoDateTime;
  waivedReason?: string;
};

/** A visit bill, split between payer and patient. */
export type Invoice = {
  id: ObjectId;
  invoiceNumber: string;
  visitId: ObjectId;
  patientId: ObjectId;
  payerType: PayerType;
  schemeName?: string;
  subtotalPesewas: number;
  /** Expected reimbursement from the scheme or NHIS. */
  payerTotalPesewas: number;
  /** What the patient settles before leaving. */
  patientTotalPesewas: number;
  shortfallPesewas: number;
  paidPesewas: number;
  balancePesewas: number;
  subtotalFormatted: string;
  payerTotalFormatted: string;
  patientTotalFormatted: string;
  balanceFormatted: string;
  status: InvoiceStatus;
  issuedAt: IsoDateTime;
  settledAt?: IsoDateTime;
};

/**
 * The whole bill for one visit.
 *
 * `invoice` is `null` until the API has issued one — a visit that has only
 * just accrued its first charges is a normal case, not an error, and the
 * screen totals the pending lines itself via {@link billTotals} until then.
 */
export type VisitBill = {
  invoice: Invoice | null;
  charges: Charge[];
};

/**
 * What an item would cost this patient before it is ordered.
 *
 * Priced against the visit's frozen payer without charging anything — the
 * counter's honest answer to "how much will this be?".
 */
export type PriceQuote = {
  chargeItem: ChargeItem;
  quantity: number;
  unitPricePesewas: number;
  grossPesewas: number;
  coveredByPayer: boolean;
  coverageNote?: string;
  payerPortionPesewas: number;
  patientPortionPesewas: number;
  patientPortionFormatted: string;
  shortfallPesewas: number;
};

/* -------------------------------------------------------------------------
   Insurance schemes (T8.2)
   ------------------------------------------------------------------------- */

/**
 * A payer the clinic bills — NHIS, a private scheme, or a corporate account.
 *
 * Each brings its own price list (its {@link Tariff}s) and exclusions. The
 * `covers*` flags and `copayPercent` describe the contract in broad strokes;
 * the price of any particular item is still the tariff's to answer.
 */
export type InsuranceScheme = {
  id: ObjectId;
  name: string;
  shortName?: string;
  code: string;
  payerType: PayerType;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  /** Percentage of a covered bill the patient still pays. */
  copayPercent: number;
  coversConsultation: boolean;
  coversLab: boolean;
  coversDrugs: boolean;
  coversProcedures: boolean;
  coversAdmission: boolean;
  /** Bills above this need the scheme's sign-off before treatment. */
  preAuthThresholdPesewas?: number;
  exclusions: string[];
  creditLimitPesewas?: number;
  paymentTermsDays: number;
  active: boolean;
};

/* -------------------------------------------------------------------------
   Write models
   ------------------------------------------------------------------------- */

/** Body of `POST /billing/charge-items`. Admin only. */
export type CreateChargeItem = {
  code: string;
  name: string;
  category: ChargeCategory;
  unit?: string;
  basePricePesewas: number;
  nhisGdrgCode?: string;
  nhisMedicineCode?: string;
  isOnNhisList?: boolean;
  nhisTariffPesewas?: number;
};

/** Body of `PATCH /billing/charge-items/{id}` — only what changed. Admin only. */
export type UpdateChargeItem = Partial<CreateChargeItem> & {
  active?: boolean;
};

/** Body of `POST /billing/tariffs`. Requires admin or claims. */
export type CreateTariff = {
  chargeItemId: ObjectId;
  payerType: PayerType;
  /** Omit (or `null`) to cover the whole payer type. */
  schemeId?: ObjectId | null;
  pricePesewas: number;
  covered?: boolean;
  /** `YYYY-MM-DD`; the API defaults to today. */
  effectiveFrom?: IsoDate;
  effectiveTo?: IsoDate | null;
  note?: string;
};

/**
 * Body of `POST /billing/visits/{id}/charges` — a manual charge.
 *
 * The price is deliberately absent: the API prices the item against the
 * visit's payer and the tariffs in force. `description` only overrides the
 * item's own name.
 */
export type AddCharge = {
  chargeItemId: ObjectId;
  /** Defaults to 1. */
  quantity?: number;
  description?: string;
};

/** Body of `POST /billing/charges/{id}/waive`. The reason is the audit trail. */
export type WaiveCharge = {
  reason: string;
};

/** Body of `POST /schemes`. Requires admin or claims. */
export type CreateInsuranceScheme = {
  name: string;
  shortName?: string;
  code: string;
  payerType: PayerType;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  copayPercent?: number;
  coversConsultation?: boolean;
  coversLab?: boolean;
  coversDrugs?: boolean;
  coversProcedures?: boolean;
  coversAdmission?: boolean;
  preAuthThresholdPesewas?: number;
  exclusions?: string[];
  creditLimitPesewas?: number;
  paymentTermsDays?: number;
};

/** Body of `PATCH /schemes/{id}` — only what changed. */
export type UpdateInsuranceScheme = Partial<CreateInsuranceScheme> & {
  active?: boolean;
};

/* -------------------------------------------------------------------------
   Derived views — charges
   ------------------------------------------------------------------------- */

/** Still open: money is expected against it and it can still be forgiven. */
export function isChargeOpen(charge: Pick<Charge, "status">): boolean {
  return charge.status === "pending" || charge.status === "billed";
}

/**
 * Whether the waive action should be offered.
 *
 * Only an open line can be forgiven: a paid one needs the payment reversed
 * first, and a waived or cancelled one is already closed.
 */
export function canWaiveCharge(charge: Pick<Charge, "status">): boolean {
  return isChargeOpen(charge);
}

/**
 * Whether the cancel action should be offered. Same gate as waiving — the
 * difference between the two is *why*, not *when*.
 */
export function canCancelCharge(charge: Pick<Charge, "status">): boolean {
  return isChargeOpen(charge);
}

/** The only lines that should ever look editable — see {@link ChargeSources}. */
export function isManualCharge(charge: Pick<Charge, "sourceType">): boolean {
  return charge.sourceType === "manual";
}

/** Waived and cancelled lines stop counting toward anyone's total. */
export function isChargeCounted(charge: Pick<Charge, "status">): boolean {
  return charge.status !== "waived" && charge.status !== "cancelled";
}

export type BillTotals = {
  grossPesewas: number;
  payerPortionPesewas: number;
  patientPortionPesewas: number;
  shortfallPesewas: number;
};

/**
 * Local totals over the counted lines, for the moment before an invoice
 * exists. Once `VisitBill.invoice` is present **its** totals are the record —
 * these must never be shown beside it as a second opinion.
 */
export function billTotals(charges: readonly Charge[]): BillTotals {
  const counted = charges.filter(isChargeCounted);
  return {
    grossPesewas: sumPesewas(counted.map((charge) => charge.grossPesewas)),
    payerPortionPesewas: sumPesewas(counted.map((charge) => charge.payerPortionPesewas)),
    patientPortionPesewas: sumPesewas(counted.map((charge) => charge.patientPortionPesewas)),
    shortfallPesewas: sumPesewas(counted.map((charge) => charge.shortfallPesewas)),
  };
}

/** Pill tone for a charge status. Grey is a closed outcome, not a failure. */
export function chargeStatusTone(
  status: ChargeStatus,
): "positive" | "warning" | "muted" {
  if (status === "paid") return "positive";
  if (status === "waived" || status === "cancelled") return "muted";
  return "warning";
}

/** Pill tone for an invoice status. */
export function invoiceStatusTone(
  status: InvoiceStatus,
): "positive" | "warning" | "muted" {
  if (status === "paid") return "positive";
  if (status === "void") return "muted";
  return "warning";
}

/* -------------------------------------------------------------------------
   Derived views — tariffs
   ------------------------------------------------------------------------- */

/**
 * Whether a tariff applies at `atMs` (epoch milliseconds — pass one shared
 * value when checking a list, so rows cannot disagree about "now").
 * An open-ended tariff (`effectiveTo: null`) never lapses.
 */
export function isTariffInForce(
  tariff: Pick<Tariff, "effectiveFrom" | "effectiveTo">,
  atMs: number,
): boolean {
  if (atMs < Date.parse(tariff.effectiveFrom)) return false;
  return tariff.effectiveTo === null || atMs <= Date.parse(tariff.effectiveTo);
}

/**
 * Sorts a list of one item's tariffs so the row the API would apply comes
 * first: scheme-specific before payer-wide, then newest `effectiveFrom` first.
 * (Which rows are *in force* is {@link isTariffInForce}'s question — this only
 * orders precedence within the applicable set.)
 */
export function compareTariffPrecedence(a: Tariff, b: Tariff): number {
  const aSpecific = a.schemeId !== null ? 0 : 1;
  const bSpecific = b.schemeId !== null ? 0 : 1;
  if (aSpecific !== bSpecific) return aSpecific - bSpecific;
  return Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom);
}

/** `Acme Health` for a scheme tariff, `All NHIS` for a payer-wide one. */
export function describeTariffScope(
  tariff: Pick<Tariff, "payerType" | "schemeId" | "schemeName">,
): string {
  if (tariff.schemeId !== null) {
    return tariff.schemeName ?? "One scheme";
  }
  return `All ${PayerTypes.label(tariff.payerType)}`;
}

/* -------------------------------------------------------------------------
   Derived views — schemes
   ------------------------------------------------------------------------- */

/**
 * What a scheme's contract covers, as display labels — `["Consultation",
 * "Lab", "Drugs"]`. Empty means the contract covers nothing by category,
 * which a screen should say in words rather than render as a blank.
 */
export function schemeCoverageSummary(
  scheme: Pick<
    InsuranceScheme,
    "coversConsultation" | "coversLab" | "coversDrugs" | "coversProcedures" | "coversAdmission"
  >,
): string[] {
  const covered: string[] = [];
  if (scheme.coversConsultation) covered.push("Consultation");
  if (scheme.coversLab) covered.push("Lab");
  if (scheme.coversDrugs) covered.push("Drugs");
  if (scheme.coversProcedures) covered.push("Procedures");
  if (scheme.coversAdmission) covered.push("Admission");
  return covered;
}
