/**
 * Auth tag — `/auth/*`.
 *
 * One module per API tag, each exporting plain async functions that loaders
 * and actions call. Nothing here holds state; the server-side session cookie
 * in `~/lib/auth.server` is the only place tokens live.
 */

import type {
  ChangePasswordRequest,
  LoginRequest,
  LogoutRequest,
  RefreshRequest,
  Session,
} from "~/models/auth";
import type { Staff } from "~/models/staff";
import { request, type RequestOptions } from "./client";

/**
 * Sign in with an email address or staff number.
 * Rejects with `ApiError` (401) when the credentials are not accepted.
 */
export function login(body: LoginRequest, options?: RequestOptions): Promise<Session> {
  return request<Session>("/auth/login", { ...options, method: "POST", body });
}

/**
 * Exchange a refresh token for a new session. Refresh tokens rotate on every
 * use — the caller must persist the returned pair before making another call,
 * or the next refresh will present a stale token and revoke the session.
 */
export function refreshSession(
  body: RefreshRequest,
  options?: RequestOptions,
): Promise<Session> {
  return request<Session>("/auth/refresh", { ...options, method: "POST", body });
}

/** Revoke a refresh token server-side. Safe to treat as best-effort. */
export function logout(body: LogoutRequest, options?: RequestOptions): Promise<void> {
  return request<void>("/auth/logout", { ...options, method: "POST", body });
}

/** The currently signed-in staff member. Requires a bearer token. */
export function getMe(options: RequestOptions): Promise<Staff> {
  return request<Staff>("/auth/me", options);
}

/** Change your own password. Revokes every other active session. */
export function changePassword(
  body: ChangePasswordRequest,
  options: RequestOptions,
): Promise<void> {
  return request<void>("/auth/change-password", { ...options, method: "POST", body });
}
