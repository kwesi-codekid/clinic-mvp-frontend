/**
 * Platform tag — `GET /health`.
 *
 * One module per API tag, each exporting plain async functions that loaders
 * and actions call. Nothing here holds state.
 */

import type { Health } from "~/models/platform";
import { request, type RequestOptions } from "./client";

/**
 * Liveness plus the state of each dependency. Unauthenticated and safe to poll.
 *
 * `checks.databaseWritable` being false means the backend can read but not
 * write — worth surfacing loudly, because saves will fail.
 */
export function getHealth(options?: RequestOptions): Promise<Health> {
  return request<Health>("/health", options);
}
