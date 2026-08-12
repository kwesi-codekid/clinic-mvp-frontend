/**
 * Vitals tag — `/vitals/*`.
 *
 * Note the shape: vitals are a **top-level resource** carrying `visitId` in the
 * body, not a sub-resource of the visit. One visit can hold several sets and
 * none of them can be edited — a recheck is a new set, which is what keeps the
 * observation history honest.
 */

import type { ObjectId, PageQuery, Paginated } from "~/models/primitives";
import type { PreviewVitals, RecordVitals, Vitals, VitalsPreview } from "~/models/vitals";
import { request, requestPage, type RequestOptions } from "./client";

/** Filters accepted by `GET /vitals`. */
export type VitalsListQuery = PageQuery & {
  visitId?: ObjectId;
  patientId?: ObjectId;
};

/**
 * List recorded vitals.
 *
 * `{ visitId }` is this visit's observations, newest first; `{ patientId }` is
 * the trend across attendances, which is what a chronic-disease review reads.
 */
export function listVitals(
  query: VitalsListQuery,
  options: RequestOptions,
): Promise<Paginated<Vitals>> {
  return requestPage<Vitals>("/vitals", {
    ...options,
    query: { ...options.query, ...query },
  });
}

/** One set of vitals. */
export function getVitals(id: ObjectId, options: RequestOptions): Promise<Vitals> {
  return request<Vitals>(`/vitals/${id}`, options);
}

/**
 * Record a set of vitals.
 *
 * The response carries the computed `flags` and `bmi` — read them back rather
 * than trusting the preview, which was graded without the patient's record.
 * A critical reading is also pushed to the ordering clinician over the socket.
 *
 * Requires the nurse, midwife, doctor, physician_assistant or admin role.
 */
export function recordVitals(input: RecordVitals, options: RequestOptions): Promise<Vitals> {
  return request<Vitals>("/vitals", { ...options, method: "POST", body: input });
}

/**
 * Flag a set of readings **without saving them**.
 *
 * What lets the nurse see "Fever" while the thermometer is still in her hand.
 * Open to any signed-in staff member, because nothing is written.
 *
 * Pass `ageYears`: with no visit the API cannot look the patient up, and
 * without an age it grades the readings against **adult** ranges — which would
 * quietly under-flag a child. {@link previewVitalsForAge} is the safer door.
 */
export function previewVitals(
  input: PreviewVitals,
  options: RequestOptions,
): Promise<VitalsPreview> {
  return request<VitalsPreview>("/vitals/preview", {
    ...options,
    method: "POST",
    body: input,
  });
}

/**
 * {@link previewVitals} with the patient's age made a required argument, so the
 * paediatric ranges cannot be lost by omission. Pass `undefined` only when the
 * age genuinely is not known.
 */
export function previewVitalsForAge(
  readings: Omit<PreviewVitals, "ageYears">,
  ageYears: number | undefined,
  options: RequestOptions,
): Promise<VitalsPreview> {
  return previewVitals({ ...readings, ageYears }, options);
}
