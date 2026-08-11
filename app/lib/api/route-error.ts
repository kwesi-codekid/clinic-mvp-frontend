/**
 * The bridge between {@link ApiError} and React Router's error boundaries.
 *
 * A thrown `ApiError` keeps all of its fields when the boundary renders on the
 * server, but a client-side navigation serialises the error and drops
 * everything except the message. Forwarding the payload through `data()`
 * instead keeps `code`, `details` and `requestId` intact on both paths —
 * `RouteError` reads either shape.
 */

import { data } from "react-router";

import { ApiError } from "./errors";

/**
 * Re-throws a failure in the form a route boundary can render in full.
 * Non-API errors are re-thrown untouched.
 *
 * @example
 * export async function loader({ params }: Route.LoaderArgs) {
 *   try {
 *     return { patient: await getPatient(parseObjectId(params.id)) };
 *   } catch (error) {
 *     throwRouteError(error);
 *   }
 * }
 */
export function throwRouteError(error: unknown): never {
  if (ApiError.is(error)) {
    // status 0 means the request never reached the server; report it as a
    // gateway failure so the boundary and any logging see a real HTTP status.
    const status = error.status >= 400 ? error.status : 502;
    throw data(error.toPayload(), { status });
  }

  throw error;
}
