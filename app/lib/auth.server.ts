/**
 * Server-side auth: the session cookie that holds the JWT pair, and the
 * loader helpers built on it.
 *
 * The browser never sees a token. Login stores `{ accessToken, refreshToken,
 * expiresAt, staff }` in an encrypted, httpOnly cookie; loaders call
 * {@link requireStaff} to read it back, refreshing silently when the access
 * token is about to lapse.
 *
 * Refresh tokens **rotate**: presenting an old one revokes the whole session.
 * Two consequences are encoded here —
 * 1. a refresh is committed by redirecting to the same URL with `Set-Cookie`,
 *    so the rotated pair is persisted before any further API call can race it;
 * 2. concurrent loaders on one navigation share a single in-flight refresh
 *    ({@link refreshOnce}) instead of each rotating the token.
 */

import { createCookieSessionStorage, redirect } from "react-router";

import { logout as apiLogout, refreshSession } from "~/lib/api/auth";
import { ApiError } from "~/lib/api/client";
import type { Session as ApiSession } from "~/models/auth";
import type { Staff } from "~/models/staff";

/** What the cookie holds. `expiresAt` is epoch milliseconds. */
type AuthData = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  staff: Staff;
};

type SessionData = {
  auth: AuthData;
};

/** Refresh this long before the access token actually lapses. */
const REFRESH_SKEW_MS = 60_000;

/* -------------------------------------------------------------------------
   Cookie storage
   ------------------------------------------------------------------------- */

// Vite only exposes VITE_-prefixed vars, and nothing loads `.env` into
// `process.env` for the SSR runtime — Node's own loader closes that gap.
// Missing file (production containers set real env vars) is fine.
if (!process.env.SESSION_SECRET) {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file; rely on the actual environment.
  }
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is not set. Refusing to sign session cookies without it.");
  }

  console.warn("SESSION_SECRET is not set — using an insecure development-only fallback.");
  return "dev-only-insecure-secret";
}

const sessionStorage = createCookieSessionStorage<SessionData>({
  cookie: {
    name: "__clinic_session",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secrets: [sessionSecret()],
    secure: process.env.NODE_ENV === "production",
    // Practical ceiling; the refresh token's own server-side lifetime rules.
    maxAge: 60 * 60 * 24 * 14,
  },
});

function getSession(request: Request) {
  return sessionStorage.getSession(request.headers.get("Cookie"));
}

function toAuthData(session: ApiSession): AuthData {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: Date.now() + session.expiresIn * 1000,
    staff: session.staff,
  };
}

/** Only ever redirect within the app — never to a URL a link could inject. */
function safeRedirect(to: unknown, fallback = "/"): string {
  if (typeof to !== "string" || !to.startsWith("/") || to.startsWith("//")) {
    return fallback;
  }
  return to;
}

function loginRedirect(url: URL): string {
  const returnTo = url.pathname + url.search;
  return returnTo === "/" ? "/login" : `/login?redirectTo=${encodeURIComponent(returnTo)}`;
}

/* -------------------------------------------------------------------------
   Single-flight refresh
   ------------------------------------------------------------------------- */

const inFlightRefreshes = new Map<string, Promise<ApiSession>>();

/**
 * How long a rotated pair stays cached against the token it replaced.
 *
 * Long enough to cover one navigation: when an action refreshes, the loaders
 * that revalidate straight afterwards are still reading the *request's*
 * cookie, which carries the token the action just spent.
 */
const ROTATED_TOKEN_TTL_MS = 30_000;

/**
 * Deduplicates refreshes of the same token. Without this, two loaders running
 * in parallel would both present it; the second one would look like a replay
 * and revoke the session.
 *
 * A successful result is kept for {@link ROTATED_TOKEN_TTL_MS} rather than
 * dropped on settle, so the *sequential* case — action refreshes, revalidating
 * loader presents the same spent token moments later — resolves to the pair
 * that replaced it instead of tripping the replay defence.
 */
function refreshOnce(refreshToken: string): Promise<ApiSession> {
  let pending = inFlightRefreshes.get(refreshToken);
  if (!pending) {
    pending = refreshSession({ refreshToken });
    inFlightRefreshes.set(refreshToken, pending);

    pending.then(
      () => {
        const expiry = setTimeout(() => {
          inFlightRefreshes.delete(refreshToken);
        }, ROTATED_TOKEN_TTL_MS);
        // Never hold the process open for a cache entry.
        expiry.unref?.();
      },
      () => inFlightRefreshes.delete(refreshToken),
    );
  }
  return pending;
}

/* -------------------------------------------------------------------------
   Public API
   ------------------------------------------------------------------------- */

export type StaffContext = {
  staff: Staff;
  /** Pass as `token` to `~/lib/api` calls made on this request. */
  accessToken: string;
};

/**
 * The loader gate for every authenticated route.
 *
 * - No session → redirect to `/login` carrying the current URL.
 * - Fresh access token → returns the staff member and token.
 * - Stale access token → refreshes, then **redirects to the same URL** with
 *   the new cookie so the rotated pair is committed before anything else runs.
 * - Refresh rejected → the session is gone; clear the cookie and sign in again.
 *
 * Call it from **loaders** only: the same-URL redirect would turn a POST into
 * a GET and drop the form body. Actions use {@link requireStaffAction}.
 */
export async function requireStaff(request: Request): Promise<StaffContext> {
  const session = await getSession(request);
  const auth = session.get("auth");
  const url = new URL(request.url);

  if (!auth) {
    throw redirect(loginRedirect(url));
  }

  if (Date.now() < auth.expiresAt - REFRESH_SKEW_MS) {
    return { staff: auth.staff, accessToken: auth.accessToken };
  }

  let fresh: ApiSession;
  try {
    fresh = await refreshOnce(auth.refreshToken);
  } catch (error) {
    if (ApiError.is(error) && !error.isRetryable) {
      // The token was rejected, not the network — the session is over.
      throw redirect(loginRedirect(url), {
        headers: { "Set-Cookie": await sessionStorage.destroySession(session) },
      });
    }
    // Connectivity or a 5xx: surface it; do not log the user out for it.
    throw error;
  }

  session.set("auth", toAuthData(fresh));
  throw redirect(url.pathname + url.search, {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
  });
}

export type StaffActionContext = StaffContext & {
  /**
   * `Set-Cookie` to attach to the action's own response, present only when the
   * token rotated on this request. Dropping it costs the user their session on
   * the next navigation, so pass it through on **every** exit — the failure
   * responses as much as the success one.
   */
  setCookie?: string;
};

/**
 * The action counterpart of {@link requireStaff}.
 *
 * An action cannot be redirected mid-flight to commit a rotated token: the
 * browser would re-issue it as a GET and the form body would be gone. So the
 * refresh happens in place and the new cookie is handed back for the caller to
 * attach, rather than committed by a redirect.
 *
 * @example
 * const { accessToken, setCookie } = await requireStaffAction(request);
 * const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;
 * return data({ ok: true }, { headers });
 */
export async function requireStaffAction(request: Request): Promise<StaffActionContext> {
  const session = await getSession(request);
  const auth = session.get("auth");
  const url = new URL(request.url);

  if (!auth) {
    // Nothing to preserve — there was never a session to submit under.
    throw redirect(loginRedirect(url));
  }

  if (Date.now() < auth.expiresAt - REFRESH_SKEW_MS) {
    return { staff: auth.staff, accessToken: auth.accessToken };
  }

  let fresh: ApiSession;
  try {
    fresh = await refreshOnce(auth.refreshToken);
  } catch (error) {
    if (ApiError.is(error) && !error.isRetryable) {
      throw redirect(loginRedirect(url), {
        headers: { "Set-Cookie": await sessionStorage.destroySession(session) },
      });
    }
    throw error;
  }

  session.set("auth", toAuthData(fresh));
  return {
    staff: fresh.staff,
    accessToken: fresh.accessToken,
    setCookie: await sessionStorage.commitSession(session),
  };
}

/** Whether a session cookie exists, without refreshing or validating it. */
export async function hasSession(request: Request): Promise<boolean> {
  const session = await getSession(request);
  return session.get("auth") !== undefined;
}

/**
 * Stores a freshly minted API session and sends the user on.
 * `redirectTo` is validated — anything that is not an in-app path becomes `/`.
 */
export async function createStaffSession(
  apiSession: ApiSession,
  redirectTo: string | null | undefined,
): Promise<Response> {
  const session = await sessionStorage.getSession();
  session.set("auth", toAuthData(apiSession));

  return redirect(safeRedirect(redirectTo), {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
  });
}

/**
 * Ends the session: revokes the refresh token server-side (best-effort — a
 * dead backend must not trap someone in a signed-in state) and clears the
 * cookie.
 */
export async function logoutSession(request: Request): Promise<Response> {
  const session = await getSession(request);
  const auth = session.get("auth");

  if (auth) {
    try {
      await apiLogout({ refreshToken: auth.refreshToken });
    } catch {
      // The cookie is what signs the user in; clearing it is what matters.
    }
  }

  return redirect("/login", {
    headers: { "Set-Cookie": await sessionStorage.destroySession(session) },
  });
}
