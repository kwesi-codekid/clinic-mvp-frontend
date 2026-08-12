/**
 * Billing tag — `/billing/*` and `/schemes` (T8.1, T8.2).
 *
 * The money side of a visit: the catalogue of what can be billed, the tariffs
 * that price it per payer, the charges a visit accrues, and the invoice that
 * rolls them up. Taking the money is Phase 9's `./payments`; claiming it back
 * from NHIS is Phase 10's `./claims`.
 *
 * Note what has no write here: **prices on a charge.** A charge is priced by
 * the API against the visit's frozen payer and the tariffs in force — the
 * client only ever names an item and a quantity. The one price-shaped read,
 * {@link getPriceQuote}, is deliberately a cheap `GET` so screens can call it
 * live while a clinician is still choosing.
 */

import type {
  AddCharge,
  Charge,
  ChargeItem,
  CreateChargeItem,
  CreateInsuranceScheme,
  CreateTariff,
  InsuranceScheme,
  Invoice,
  PriceQuote,
  Tariff,
  UpdateChargeItem,
  UpdateInsuranceScheme,
  VisitBill,
  WaiveCharge,
} from "~/models/billing";
import type { ChargeCategory, ChargeStatus, PayerType } from "~/models/enums";
import type { IsoDate, ObjectId, Paginated } from "~/models/primitives";
import { request, requestPage, type RequestOptions } from "./client";

/* -------------------------------------------------------------------------
   Charge catalogue
   ------------------------------------------------------------------------- */

/** Filters accepted by `GET /billing/charge-items`. */
export type ChargeItemQuery = {
  page?: number;
  /** 1–200; the API defaults to 25. */
  limit?: number;
  sort?: string;
  q?: string;
  category?: ChargeCategory;
  onNhisList?: boolean;
  active?: boolean;
};

/**
 * Everything the clinic can bill for, with its cash price and NHIS status.
 * Open to any signed-in staff member — ordering clinicians need prices too.
 */
export function listChargeItems(
  query: ChargeItemQuery,
  options: RequestOptions,
): Promise<Paginated<ChargeItem>> {
  return requestPage<ChargeItem>("/billing/charge-items", {
    ...options,
    query: { ...options.query, ...query },
  });
}

/** Add a charge item. Admin only. */
export function createChargeItem(
  input: CreateChargeItem,
  options: RequestOptions,
): Promise<ChargeItem> {
  return request<ChargeItem>("/billing/charge-items", {
    ...options,
    method: "POST",
    body: input,
  });
}

/** Update a charge item — only the changed fields. Admin only. */
export function updateChargeItem(
  id: ObjectId,
  input: UpdateChargeItem,
  options: RequestOptions,
): Promise<ChargeItem> {
  return request<ChargeItem>(`/billing/charge-items/${id}`, {
    ...options,
    method: "PATCH",
    body: input,
  });
}

/* -------------------------------------------------------------------------
   Tariffs
   ------------------------------------------------------------------------- */

/** Filters accepted by `GET /billing/tariffs`. */
export type TariffQuery = {
  chargeItemId?: ObjectId;
  schemeId?: ObjectId;
  /** 1–500; the API defaults to 100. */
  limit?: number;
};

/**
 * One item has as many prices as there are payers. Not paginated — the API
 * returns a plain list, capped by `limit`.
 */
export function listTariffs(query: TariffQuery, options: RequestOptions): Promise<Tariff[]> {
  return request<Tariff[]>("/billing/tariffs", {
    ...options,
    query: { ...options.query, ...query },
  });
}

/** Set a tariff. Requires admin or claims. */
export function createTariff(input: CreateTariff, options: RequestOptions): Promise<Tariff> {
  return request<Tariff>("/billing/tariffs", {
    ...options,
    method: "POST",
    body: input,
  });
}

/* -------------------------------------------------------------------------
   Quotes, bills and charges
   ------------------------------------------------------------------------- */

/**
 * Price an item against a visit's frozen payer **without charging anything**.
 *
 * A `GET` with query params on purpose: cheap and cacheable, so screens call
 * it live as an item is picked — cost transparency belongs before the order,
 * not on the way out.
 */
export function getPriceQuote(
  query: { visitId: ObjectId; chargeItemId: ObjectId; quantity?: number },
  options: RequestOptions,
): Promise<PriceQuote> {
  return request<PriceQuote>("/billing/quote", {
    ...options,
    query: { ...options.query, ...query },
  });
}

/** The invoice plus every line, already split between payer and patient. */
export function getVisitBill(visitId: ObjectId, options: RequestOptions): Promise<VisitBill> {
  return request<VisitBill>(`/billing/visits/${visitId}/bill`, options);
}

/**
 * Raise a manual charge on a visit. The API prices it — the body carries no
 * amount. Requires cashier, doctor, physician_assistant, nurse, pharmacy, lab
 * or admin.
 */
export function addCharge(
  visitId: ObjectId,
  input: AddCharge,
  options: RequestOptions,
): Promise<Charge> {
  return request<Charge>(`/billing/visits/${visitId}/charges`, {
    ...options,
    method: "POST",
    body: input,
  });
}

/** Filters accepted by `GET /billing/charges`. */
export type ChargeQuery = {
  page?: number;
  /** 1–200; the API defaults to 25. */
  limit?: number;
  visitId?: ObjectId;
  patientId?: ObjectId;
  status?: ChargeStatus;
  category?: ChargeCategory;
  from?: IsoDate;
  to?: IsoDate;
};

/** Charges across visits — the finance-side browse, not a visit's bill. */
export function listCharges(
  query: ChargeQuery,
  options: RequestOptions,
): Promise<Paginated<Charge>> {
  return requestPage<Charge>("/billing/charges", {
    ...options,
    query: { ...options.query, ...query },
  });
}

/**
 * Forgive a legitimate charge. The reason is written to the audit trail and
 * the waiver is reported on. Requires admin or cashier.
 */
export function waiveCharge(
  id: ObjectId,
  input: WaiveCharge,
  options: RequestOptions,
): Promise<Charge> {
  return request<Charge>(`/billing/charges/${id}/waive`, {
    ...options,
    method: "POST",
    body: input,
  });
}

/**
 * Remove a charge raised in error. Not a waiver — see the model note — and
 * the reason, though optional on the wire, is worth insisting on in the UI.
 * Requires admin or cashier.
 */
export function cancelCharge(
  id: ObjectId,
  reason: string | undefined,
  options: RequestOptions,
): Promise<Charge> {
  return request<Charge>(`/billing/charges/${id}/cancel`, {
    ...options,
    method: "POST",
    body: reason ? { reason } : {},
  });
}

/** One invoice, by id — what a receipt or a payment screen links back to. */
export function getInvoice(id: ObjectId, options: RequestOptions): Promise<Invoice> {
  return request<Invoice>(`/billing/invoices/${id}`, options);
}

/* -------------------------------------------------------------------------
   Insurance schemes (T8.2)
   ------------------------------------------------------------------------- */

/** Filters accepted by `GET /schemes`. */
export type SchemeQuery = {
  page?: number;
  /** 1–200; the API defaults to 25. */
  limit?: number;
  payerType?: PayerType;
  active?: boolean;
};

/** Insurance schemes and corporate accounts. Readable by any signed-in staff. */
export function listSchemes(
  query: SchemeQuery,
  options: RequestOptions,
): Promise<Paginated<InsuranceScheme>> {
  return requestPage<InsuranceScheme>("/schemes", {
    ...options,
    query: { ...options.query, ...query },
  });
}

/** One scheme, with the full contract detail. */
export function getScheme(id: ObjectId, options: RequestOptions): Promise<InsuranceScheme> {
  return request<InsuranceScheme>(`/schemes/${id}`, options);
}

/** Add a scheme or corporate account. Requires admin or claims. */
export function createScheme(
  input: CreateInsuranceScheme,
  options: RequestOptions,
): Promise<InsuranceScheme> {
  return request<InsuranceScheme>("/schemes", {
    ...options,
    method: "POST",
    body: input,
  });
}

/** Update a scheme — only the changed fields. Requires admin or claims. */
export function updateScheme(
  id: ObjectId,
  input: UpdateInsuranceScheme,
  options: RequestOptions,
): Promise<InsuranceScheme> {
  return request<InsuranceScheme>(`/schemes/${id}`, {
    ...options,
    method: "PATCH",
    body: input,
  });
}
