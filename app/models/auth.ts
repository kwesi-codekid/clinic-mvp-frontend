/**
 * Auth — sessions and the request bodies of the `/auth/*` endpoints.
 *
 * Modelled from `components.schemas.Session`, `LoginRequest`,
 * `RefreshRequest` and `ChangePasswordRequest` in the OpenAPI document.
 */

import type { Staff } from "./staff";

/** Tokens plus the signed-in staff member, returned by login and refresh. */
export type Session = {
  accessToken: string;
  /** Rotates on every refresh; presenting an old one revokes the session. */
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  staff: Staff;
};

export type LoginRequest = {
  /** Email address or staff number. */
  identifier: string;
  password: string;
};

export type RefreshRequest = {
  refreshToken: string;
};

export type LogoutRequest = {
  refreshToken?: string;
};

export type ChangePasswordRequest = {
  currentPassword: string;
  /** Minimum 6 characters. */
  newPassword: string;
};
