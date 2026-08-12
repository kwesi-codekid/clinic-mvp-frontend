/**
 * Facility tag — `/facility`.
 *
 * One clinic per deployment, so there is no id in the path and no list
 * endpoint. The write half (`PUT /facility`) ships with the admin screen in
 * T14.2; this is the read the shell needs on every navigation.
 */

import type { Facility } from "~/models/facility";
import { ApiError } from "./errors";
import { request, type RequestOptions } from "./client";

/** The clinic profile, including the settings that switch modules on and off. */
export function getFacility(options: RequestOptions): Promise<Facility> {
  return request<Facility>("/facility", options);
}

/**
 * The same read, but never throwing — for callers that want the facility to
 * *shape* a screen rather than *be* one.
 *
 * The app shell is the case this exists for: the nav is filtered by the
 * facility's feature flags, and a clinic whose profile is momentarily
 * unreachable must still get a working shell. Returning `null` lets
 * {@link hasFeature} fall open instead of hiding half the app over a blip.
 *
 * Only API failures are swallowed — a bug in this client still throws.
 */
export async function getFacilityOrNull(options: RequestOptions): Promise<Facility | null> {
  try {
    return await getFacility(options);
  } catch (error) {
    if (!ApiError.is(error)) throw error;
    return null;
  }
}
