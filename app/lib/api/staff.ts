/**
 * Staff tag — `/staff/*`.
 *
 * Read surface only for now: the directory behind the Staff module. Create,
 * update and deactivate land with the staff admin task (T14.1).
 */

import type { Role, Station } from "~/models/enums";
import type { PageQuery, Paginated } from "~/models/primitives";
import type { Staff } from "~/models/staff";
import { requestPage, type RequestOptions } from "./client";

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
