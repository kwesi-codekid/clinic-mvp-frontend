/**
 * Pharmacy tag — `/pharmacy/*` (T7.2).
 *
 * Same shape as the lab: the prescription is the container, the **item** is
 * the unit of work. Writing a script is one call; everything after it —
 * dispensing, substituting, running out — is per item, which is what lets one
 * drug go out in full while another is closed as unavailable.
 *
 * **On realtime.** There is no documented socket event for the dispensing
 * counter, so `/pharmacy` polls its loader exactly as the queues and the lab
 * bench do — see `~/hooks/use-poll`.
 */

import type { PrescriptionStatus } from "~/models/enums";
import type {
  CreatePrescription,
  DispenseItem,
  Prescription,
  SubstituteItem,
} from "~/models/pharmacy";
import type { IsoDate, ObjectId, Paginated } from "~/models/primitives";
import { request, requestPage, type RequestOptions } from "./client";

/* -------------------------------------------------------------------------
   Prescriptions
   ------------------------------------------------------------------------- */

/** Filters accepted by `GET /pharmacy/prescriptions`. */
export type PrescriptionQuery = {
  page?: number;
  /** 1–200; the API defaults to 25. */
  limit?: number;
  visitId?: ObjectId;
  patientId?: ObjectId;
  status?: PrescriptionStatus;
  from?: IsoDate;
  to?: IsoDate;
};

/**
 * Write a prescription.
 *
 * The quantity to dispense is worked out by the API from dose, frequency and
 * duration rather than typed a second time, and **no charge is raised here** —
 * a script that is never collected should not appear on the bill. Requires the
 * doctor, physician_assistant, midwife or admin role; a `409` means the visit
 * is not open to work.
 */
export function createPrescription(
  input: CreatePrescription,
  options: RequestOptions,
): Promise<Prescription> {
  return request<Prescription>("/pharmacy/prescriptions", {
    ...options,
    method: "POST",
    body: input,
  });
}

/** List prescriptions. `{ visitId }` is this visit's scripts; open to any staff. */
export function listPrescriptions(
  query: PrescriptionQuery,
  options: RequestOptions,
): Promise<Paginated<Prescription>> {
  return requestPage<Prescription>("/pharmacy/prescriptions", {
    ...options,
    query: { ...options.query, ...query },
  });
}

/** One prescription, with every item and its dispensing trail. */
export function getPrescription(
  id: ObjectId,
  options: RequestOptions,
): Promise<Prescription> {
  return request<Prescription>(`/pharmacy/prescriptions/${id}`, options);
}

/**
 * The dispensing counter worklist: everything not yet fully dispensed, with
 * live stock against each line so the counter knows what it can hand over.
 * Requires the pharmacy or admin role — this is the counter's own view.
 */
export function getPharmacyQueue(options: RequestOptions): Promise<Prescription[]> {
  return request<Prescription[]>("/pharmacy/queue", options);
}

/* -------------------------------------------------------------------------
   Item lifecycle
   ------------------------------------------------------------------------- */

/**
 * Dispense one item.
 *
 * One call does three things together: takes stock by first-expiry-first-out,
 * writes the movement to the ledger, and raises the charge at this patient's
 * payer price. The batch handed over is recorded, which is what makes a recall
 * possible. Omit `quantity` to give everything outstanding; send less for a
 * partial. Requires pharmacy or admin — a `422` is the shelf refusing.
 */
export function dispenseItem(
  prescriptionId: ObjectId,
  itemId: ObjectId,
  input: DispenseItem,
  options: RequestOptions,
): Promise<Prescription> {
  return request<Prescription>(
    `/pharmacy/prescriptions/${prescriptionId}/items/${itemId}/dispense`,
    { ...options, method: "POST", body: input },
  );
}

/**
 * Give something else instead.
 *
 * The original drug and the reason stay on the record — a substitution is a
 * decision someone made, not a correction of the prescriber. Requires pharmacy
 * or admin.
 */
export function substituteItem(
  prescriptionId: ObjectId,
  itemId: ObjectId,
  input: SubstituteItem,
  options: RequestOptions,
): Promise<Prescription> {
  return request<Prescription>(
    `/pharmacy/prescriptions/${prescriptionId}/items/${itemId}/substitute`,
    { ...options, method: "POST", body: input },
  );
}

/**
 * Close an item as out of stock.
 *
 * A first-class outcome, not an error: it ends the item so the patient can be
 * sent to buy outside, and it feeds the low-stock report. Requires pharmacy or
 * admin.
 */
export function markOutOfStock(
  prescriptionId: ObjectId,
  itemId: ObjectId,
  options: RequestOptions,
): Promise<Prescription> {
  return request<Prescription>(
    `/pharmacy/prescriptions/${prescriptionId}/items/${itemId}/out-of-stock`,
    { ...options, method: "POST" },
  );
}
