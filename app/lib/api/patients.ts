/**
 * Patients tag — `/patients/*`.
 *
 * The records desk's whole surface: the folder search behind the index, the
 * folder itself, registration, edits, and the duplicate/merge pair from T2.3.
 *
 * Note the API's vocabulary, which differs from the sketch in TASK.md: the
 * update is a **PATCH** (sparse), the duplicate search is
 * `POST /patients/check-duplicates`, and no folder is ever deleted — a
 * duplicate is *merged*, which repoints its visits, bills, results and claims
 * onto the surviving folder and leaves the retired one pointing at where they
 * went.
 */

import type { PayerType, Sex } from "~/models/enums";
import type {
  CreatePatient,
  DuplicateCandidate,
  DuplicateSearch,
  MergePatients,
  Patient,
  PatientSummary,
  UpdatePatient,
} from "~/models/patient";
import type { ObjectId, PageQuery, Paginated } from "~/models/primitives";
import { ApiError } from "./errors";
import { request, requestPage, type RequestOptions } from "./client";

/** Filters accepted by `GET /patients`. Combine freely; all are optional. */
export type PatientListQuery = PageQuery & {
  /**
   * One box, five fields: folder number, name, phone, NHIS number and Ghana
   * Card number are all searched at once — this is what the records desk types.
   */
  q?: string;
  payerType?: PayerType;
  sex?: Sex;
  /** Retired duplicate folders are hidden unless this is `true`. */
  includeMerged?: boolean;
};

/** Search and list patients. Requires a bearer token. */
export function listPatients(
  query: PatientListQuery,
  options: RequestOptions,
): Promise<Paginated<PatientSummary>> {
  return requestPage<PatientSummary>("/patients", {
    ...options,
    query: { ...options.query, ...query },
  });
}

/** One full folder by id. `404` when the id is unknown. */
export function getPatient(id: ObjectId, options: RequestOptions): Promise<Patient> {
  return request<Patient>(`/patients/${id}`, options);
}

/**
 * The same folder, found the way it is written on paper. Useful wherever a
 * clerk has the physical folder in front of them and not the record open.
 */
export function getPatientByFolder(
  folderNumber: string,
  options: RequestOptions,
): Promise<Patient> {
  return request<Patient>(`/patients/by-folder/${encodeURIComponent(folderNumber)}`, options);
}

/**
 * Register a patient.
 *
 * A `409` means the API believes this person already has a folder; its
 * candidates are in `error.data.candidates` — read them with
 * {@link duplicateCandidatesOf}, show them, and only resend with
 * `forceCreate: true` once a human has said it is someone else.
 */
export function createPatient(
  input: CreatePatient,
  options: RequestOptions,
): Promise<Patient> {
  return request<Patient>("/patients", { ...options, method: "POST", body: input });
}

/**
 * Patch a folder. Sparse — whatever is omitted is left untouched — but arrays
 * (`allergies`, `chronicConditions`, `payerProfiles`) are **replaced**, so
 * send the full list every time you send one at all.
 */
export function updatePatient(
  id: ObjectId,
  input: UpdatePatient,
  options: RequestOptions,
): Promise<Patient> {
  return request<Patient>(`/patients/${id}`, { ...options, method: "PATCH", body: input });
}

/**
 * Ask whether this person already has a folder — designed to be called while
 * the clerk is still typing, so keep the payload to whatever they have entered
 * so far.
 *
 * Returns an empty list when nothing looks close enough.
 */
export function checkDuplicates(
  search: DuplicateSearch,
  options: RequestOptions,
): Promise<DuplicateCandidate[]> {
  return request<DuplicateCandidate[]>("/patients/check-duplicates", {
    ...options,
    method: "POST",
    body: search,
  });
}

/**
 * Merge a duplicate folder into the one being kept, and return the survivor.
 *
 * Every visit, bill, result and claim moves across; the duplicate is retired
 * with a pointer to its new home. Nothing is deleted, but nothing about this
 * is undoable either — confirm it explicitly before calling.
 */
export function mergePatients(
  input: MergePatients,
  options: RequestOptions,
): Promise<Patient> {
  return request<Patient>("/patients/merge", { ...options, method: "POST", body: input });
}

/**
 * The candidate folders behind a `409` from {@link createPatient}, or an empty
 * list for any other failure.
 *
 * `error.data` is deliberately untyped on {@link ApiError} — this is the one
 * place that knows what the patients endpoint puts in it.
 */
export function duplicateCandidatesOf(error: unknown): DuplicateCandidate[] {
  if (!ApiError.is(error) || typeof error.data !== "object" || error.data === null) {
    return [];
  }

  const candidates = (error.data as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return [];

  // Shallow shape check: a malformed payload must not crash the form the
  // clerk is standing in front of.
  return candidates.filter(
    (entry): entry is DuplicateCandidate =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as DuplicateCandidate).patient?.id === "string",
  );
}
