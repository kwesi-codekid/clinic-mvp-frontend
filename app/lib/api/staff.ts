/**
 * Staff tag — `/staff/*`.
 *
 * The directory behind the Staff module, plus the admin writes from T14.1.
 * Note the API's own vocabulary: the update is a **PATCH** (sparse, not a
 * replace) and the delete is a **deactivation** — no staff record is ever
 * destroyed, because visits, notes and claims all point back at one.
 */

import type { Role, Station } from "~/models/enums";
import type { ObjectId, PageQuery, Paginated } from "~/models/primitives";
import type { CreateStaff, Staff, UpdateStaff } from "~/models/staff";
import { request, requestPage, type RequestOptions } from "./client";

/** Filters accepted by `GET /staff`. Combine freely; all are optional. */
export type StaffListQuery = PageQuery & {
  /** Free-text search across name, staff number and email. */
  q?: string;
  role?: Role;
  station?: Station;
  active?: boolean;
};

/** List staff, filtered and paginated. Requires a bearer token. */
export function listStaff(
  query: StaffListQuery,
  options: RequestOptions,
): Promise<Paginated<Staff>> {
  return requestPage<Staff>("/staff", {
    ...options,
    query: { ...options.query, ...query },
  });
}

/**
 * Create a staff account.
 *
 * A `409` means the email or staff number already belongs to someone —
 * surface that as a field-level clash, not a generic conflict.
 */
export function createStaff(input: CreateStaff, options: RequestOptions): Promise<Staff> {
  return request<Staff>("/staff", { ...options, method: "POST", body: input });
}

/**
 * Patch a staff account. Sparse — whatever is omitted is left untouched, so
 * send only the fields the form actually changed.
 */
export function updateStaff(
  id: ObjectId,
  input: UpdateStaff,
  options: RequestOptions,
): Promise<Staff> {
  return request<Staff>(`/staff/${id}`, { ...options, method: "PATCH", body: input });
}

/**
 * Deactivate an account: sign-in stops, the record stays in the directory.
 * Reactivate with `updateStaff(id, { active: true })` — there is no undelete.
 */
export function deactivateStaff(id: ObjectId, options: RequestOptions): Promise<Staff> {
  return request<Staff>(`/staff/${id}`, { ...options, method: "DELETE" });
}
