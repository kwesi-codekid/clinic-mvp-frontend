/**
 * Consultations tag — `/consultations/*`.
 *
 * The vocabulary differs from the original sketch in TASK.md: there is **no
 * `PUT`**. A note is written once, and a signed one is corrected through
 * {@link amendConsultation}, which appends a reason to its audit trail. The
 * ICD-10 subset also lives under this tag rather than being a lookup we ship.
 */

import type {
  AmendConsultation,
  Consultation,
  Icd10Entry,
  WriteConsultation,
} from "~/models/consultation";
import type { IsoDate, ObjectId, PageQuery, Paginated } from "~/models/primitives";
import { request, requestPage, type RequestOptions } from "./client";

/** Filters accepted by `GET /consultations`. */
export type ConsultationListQuery = PageQuery & {
  visitId?: ObjectId;
  patientId?: ObjectId;
  /** Every attendance coded with this diagnosis — the recall list. */
  icd10Code?: string;
  /** Inclusive `YYYY-MM-DD` bounds. */
  from?: IsoDate;
  to?: IsoDate;
};

/** List consultation notes. */
export function listConsultations(
  query: ConsultationListQuery,
  options: RequestOptions,
): Promise<Paginated<Consultation>> {
  return requestPage<Consultation>("/consultations", {
    ...options,
    query: { ...options.query, ...query },
  });
}

/**
 * The note written on a visit, or `undefined` when none has been started.
 *
 * There is no `GET /visits/{id}/consultation`, so this is the lookup every
 * consulting-room screen opens with. A visit is expected to carry one note; if
 * more than one exists the most recent is returned, which is the one being
 * worked on.
 */
export async function getVisitConsultation(
  visitId: ObjectId,
  options: RequestOptions,
): Promise<Consultation | undefined> {
  const page = await listConsultations({ visitId, limit: 1, sort: "-createdAt" }, options);
  return page.items[0];
}

/** One note, with its diagnoses and amendment trail. */
export function getConsultation(id: ObjectId, options: RequestOptions): Promise<Consultation> {
  return request<Consultation>(`/consultations/${id}`, options);
}

/**
 * Write a consultation note.
 *
 * **An upsert keyed on the visit.** There is one note per visit, and posting
 * again replaces it — so the "save draft, come back after the lab result" path
 * is this same call, not a separate update. That is also why the screen must
 * send the whole note each time rather than the fields that changed.
 *
 * `sign: true` closes it in the same request. Once signed, this endpoint
 * answers `409` and {@link amendConsultation} is the only way in.
 *
 * Requires the doctor, physician_assistant, midwife or admin role.
 */
export function writeConsultation(
  input: WriteConsultation,
  options: RequestOptions,
): Promise<Consultation> {
  return request<Consultation>("/consultations", { ...options, method: "POST", body: input });
}

/**
 * Amend a signed note.
 *
 * Send the whole body as it should now read, plus the reason — the amendment
 * replaces the narrative and appends to the trail. Never presented as an edit:
 * the previous wording is what the record is defended with.
 *
 * Requires the doctor, physician_assistant, midwife or admin role.
 */
export function amendConsultation(
  id: ObjectId,
  input: AmendConsultation,
  options: RequestOptions,
): Promise<Consultation> {
  return request<Consultation>(`/consultations/${id}/amend`, {
    ...options,
    method: "POST",
    body: input,
  });
}

/* -------------------------------------------------------------------------
   ICD-10
   ------------------------------------------------------------------------- */

/** Typeahead over the clinic's ICD-10 subset — code or description. */
export function searchIcd10(
  query: { q?: string; limit?: number },
  options: RequestOptions,
): Promise<Icd10Entry[]> {
  return request<Icd10Entry[]>("/consultations/icd10", {
    ...options,
    query: { ...options.query, ...query },
  });
}

/**
 * The whole ICD-10 subset in one call.
 *
 * Small enough to hold, which is the point: the clinic network drops, and a
 * diagnosis picker that stops working mid-consultation is worse than a stale
 * one. Cache it rather than calling it per keystroke — {@link searchIcd10} is
 * the per-keystroke door.
 */
export function listAllIcd10(options: RequestOptions): Promise<Icd10Entry[]> {
  return request<Icd10Entry[]>("/consultations/icd10/all", options);
}
