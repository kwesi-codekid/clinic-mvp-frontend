/**
 * `GET /resources/realtime-token` — the one place the access token is handed
 * to the browser, and only for the socket.
 *
 * Every other screen keeps its token server-side: the `resources/*` routes
 * exist precisely so a keystroke can reach the API without the browser ever
 * holding a credential. The socket cannot work that way. It is a direct
 * browser-to-backend connection to a *different origin*, so our httpOnly
 * session cookie is not sent with it and Socket.io's handshake wants the
 * bearer token in `auth`. Something has to cross the boundary.
 *
 * What that costs is bounded deliberately:
 *
 * - the token is fetched inside the connect effect and handed straight to
 *   `io()`; `~/lib/realtime` never writes it to storage, so it lives in a
 *   closure for the life of the connection and nowhere else;
 * - `cache-control: no-store` keeps it out of the browser and proxy caches;
 * - it is the *access* token, which lapses in minutes. The refresh token —
 *   the one that can mint new sessions — never leaves the cookie.
 *
 * Returning the URL from here too means the browser needs no build-time
 * `VITE_API_BASE_URL`: the server already knows where the API is, and the
 * socket lives at that URL's origin (the Socket.io server is mounted on the
 * HTTP server itself, at `/socket.io`, not under the `/api/v1` prefix).
 */

import { getApiBaseUrl } from "~/lib/api/client";
import { requireStaffAction } from "~/lib/auth.server";
import type { Route } from "./+types/resource-realtime-token";

/** What `~/lib/realtime` reads back. */
export type RealtimeCredentials = {
  /** Origin to hand `io()`. The namespace and path are Socket.io defaults. */
  url: string;
  /** Passed as `auth: { token }` in the handshake. */
  token: string;
};

export async function loader({ request }: Route.LoaderArgs) {
  // The action gate, deliberately: this is fetched from an effect, where
  // `requireStaff`'s same-URL redirect would be answered by `fetch` rather
  // than the browser and never reach the login screen.
  const { accessToken, setCookie } = await requireStaffAction(request);

  const headers = new Headers({ "cache-control": "no-store" });
  if (setCookie) headers.append("Set-Cookie", setCookie);

  return Response.json(
    {
      url: new URL(getApiBaseUrl()).origin,
      token: accessToken,
    } satisfies RealtimeCredentials,
    { headers },
  );
}
