/**
 * Visits tag — `/visits/*`.
 *
 * The clinic day: who is in the building, where they are, and how their
 * attendance ended.
 *
 * Note the API's vocabulary, which differs from the sketch in TASK.md: the
 * move is `POST /visits/{id}/move` (not `/move-station`), there is a
 * `GET /visits/open` for "is this patient already here?", and a visit that was
 * never seen is **cancelled**, not closed — see {@link cancelVisit}.
 */

import type { PayerType, Priority, Station, VisitStatus, VisitType } from "~/models/enums";
import type { IsoDate, ObjectId, PageQuery, Paginated } from "~/models/primitives";
import type {
  CancelVisit,
  CheckIn,
  CloseVisit,
  MoveStation,
  Visit,
  VisitSummary,
} from "~/models/visit";
import { request, requestPage, type RequestOptions } from "./client";

/** Filters accepted by `GET /visits`. Combine freely; all are optional. */
export type VisitListQuery = PageQuery & {
  patientId?: ObjectId;
  status?: VisitStatus;
  type?: VisitType;
  payerType?: PayerType;
  station?: Station;
  /** Inclusive `YYYY-MM-DD` bounds on the arrival date. */
  from?: IsoDate;
  to?: IsoDate;
  /**
   * The current clinic day, resolved server-side. Prefer this to computing
   * `from`/`to` here — the clinic's day boundary is the API's to decide, not
   * the browser's timezone.
   */
  today?: boolean;
};

/** List visits. The front desk's usual view is `{ today: true }`. */
export function listVisits(
  query: VisitListQuery,
  options: RequestOptions,
): Promise<Paginated<VisitSummary>> {
  return requestPage<VisitSummary>("/visits", {
    ...options,
    query: { ...options.query, ...query },
  });
}

/** One visit, with its full station history. `404` when the id is unknown. */
export function getVisit(id: ObjectId, options: RequestOptions): Promise<Visit> {
  return request<Visit>(`/visits/${id}`, options);
}

/**
 * The patient's currently open visit, or `null` when they are not in the
 * clinic.
 *
 * Call it before offering to check someone in: a second open visit is a
 * `409` from {@link checkIn}, and the patient is usually just already here.
 */
export function getOpenVisit(
  patientId: ObjectId,
  options: RequestOptions,
): Promise<Visit | null> {
  return request<Visit | null>("/visits/open", {
    ...options,
    query: { ...options.query, patientId },
  });
}

/**
 * Check a patient in.
 *
 * Freezes the payer onto the visit and places the patient on the first station
 * queue for the visit type. Lapsed cover is checked in as **cash** rather than
 * accruing charges a scheme will refuse — so read the payer back off the
 * returned visit rather than assuming what was sent.
 *
 * Requires the records, nurse or admin role. A `409` means the patient already
 * has an open visit.
 */
export function checkIn(input: CheckIn, options: RequestOptions): Promise<Visit> {
  return request<Visit>("/visits", { ...options, method: "POST", body: input });
}

/**
 * Send a visit to the next station.
 *
 * Omit `station` to follow the default route for the visit type. The move
 * closes the current station-history entry, which is what captures time spent.
 */
export function moveVisit(
  id: ObjectId,
  input: MoveStation,
  options: RequestOptions,
): Promise<Visit> {
  return request<Visit>(`/visits/${id}/move`, { ...options, method: "POST", body: input });
}

/** Close a visit with a disposition. A `409` means it is not open. */
export function closeVisit(
  id: ObjectId,
  input: CloseVisit,
  options: RequestOptions,
): Promise<Visit> {
  return request<Visit>(`/visits/${id}/close`, { ...options, method: "POST", body: input });
}

/**
 * Cancel a visit — the patient left before being seen.
 *
 * Not a closure: nothing clinical happened, so there is no disposition and no
 * turnaround to report. Requires the records or admin role.
 */
export function cancelVisit(
  id: ObjectId,
  input: CancelVisit,
  options: RequestOptions,
): Promise<Visit> {
  return request<Visit>(`/visits/${id}/cancel`, { ...options, method: "POST", body: input });
}
