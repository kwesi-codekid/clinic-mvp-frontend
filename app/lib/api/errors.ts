/**
 * The typed error every API call rejects with, plus the one place that turns
 * an `ErrorResponse.code` into copy a clinic staff member can act on.
 *
 * Nothing outside this file should switch on error codes or invent its own
 * wording for a failure.
 */

import type { ApiErrorPayload, ErrorDetail } from "~/models/primitives";

/**
 * Codes observed from the deployed backend, plus the synthetic ones this
 * client raises when a request never produced an error envelope at all.
 * The list is not closed — `ApiError.code` stays a plain string, and
 * {@link describeApiError} falls back to the HTTP status for anything new.
 */
export const ApiErrorCode = {
  /** No credentials, bad credentials, or an expired access token. */
  Unauthenticated: "UNAUTHENTICATED",
  /** Authenticated, but the role or station does not permit this. */
  Forbidden: "FORBIDDEN",
  NotFound: "NOT_FOUND",
  /** Request body failed validation; `details[]` carries the field paths. */
  ValidationError: "VALIDATION_ERROR",
  Conflict: "CONFLICT",

  /** Synthetic: the request never reached the server. */
  NetworkError: "NETWORK_ERROR",
  /** Synthetic: the request was aborted or ran past its timeout. */
  Timeout: "TIMEOUT",
  /** Synthetic: a response arrived but was not the documented envelope. */
  InvalidResponse: "INVALID_RESPONSE",
} as const;

export type ApiErrorCodeValue = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export type ApiErrorInit = {
  status: number;
  code: string;
  message: string;
  details?: ErrorDetail[];
  data?: unknown;
  requestId?: string;
  method?: string;
  url?: string;
  cause?: unknown;
};

/**
 * A failed API call.
 *
 * Carries the whole error envelope, so a caller can branch on `code`, render
 * field errors from `details`, act on `data` (duplicate candidates, for
 * instance) and quote `requestId` to support.
 */
export class ApiError extends Error {
  /**
   * Structural marker. `instanceof` is unreliable once an error has crossed
   * the SSR boundary or been re-thrown by the router — check {@link ApiError.is}.
   */
  readonly isApiError = true as const;

  readonly status: number;
  readonly code: string;
  readonly details: ErrorDetail[];
  readonly data: unknown;
  readonly requestId?: string;
  readonly method?: string;
  readonly url?: string;

  constructor(init: ApiErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? [];
    this.data = init.data;
    this.requestId = init.requestId;
    this.method = init.method;
    this.url = init.url;
  }

  static is(value: unknown): value is ApiError {
    return (
      typeof value === "object" &&
      value !== null &&
      (value as { isApiError?: unknown }).isApiError === true
    );
  }

  /** True when re-authenticating (or refreshing the token) might fix this. */
  get isAuthError(): boolean {
    return this.status === 401 || this.code === ApiErrorCode.Unauthenticated;
  }

  /** True when a retry stands a chance: connectivity, timeout, or a 5xx. */
  get isRetryable(): boolean {
    return (
      this.status >= 500 ||
      this.code === ApiErrorCode.NetworkError ||
      this.code === ApiErrorCode.Timeout
    );
  }

  /**
   * `details[]` collapsed into `field path → message`, ready to hang off form
   * inputs. Paths keep the API's `body.`/`query.` prefix.
   */
  fieldErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const detail of this.details) {
      if (detail.path && !(detail.path in errors)) {
        errors[detail.path] = detail.message;
      }
    }
    return errors;
  }

  /** The serialisable envelope, for handing to a route error boundary. */
  toPayload(): ApiErrorPayload & { status: number } {
    return {
      status: this.status,
      code: this.code,
      message: this.message,
      details: this.details,
      data: this.data,
      requestId: this.requestId,
    };
  }
}

/** Copy shown to staff when a request fails. */
export type ApiErrorCopy = {
  title: string;
  description: string;
};

const COPY_BY_CODE: Record<string, ApiErrorCopy> = {
  [ApiErrorCode.Unauthenticated]: {
    title: "Sign in again",
    description: "Your session has expired or the credentials were not accepted.",
  },
  [ApiErrorCode.Forbidden]: {
    title: "Not permitted",
    description: "Your role does not allow this action. Ask an administrator if you need it.",
  },
  [ApiErrorCode.NotFound]: {
    title: "Not found",
    description: "That record no longer exists, or the link is wrong.",
  },
  [ApiErrorCode.ValidationError]: {
    title: "Check the highlighted fields",
    description: "Some values were rejected. Correct them and submit again.",
  },
  [ApiErrorCode.Conflict]: {
    title: "Conflicting record",
    description: "Something changed since this screen loaded. Reload and try again.",
  },
  [ApiErrorCode.NetworkError]: {
    title: "No connection to the server",
    description: "Check the clinic network, then try again. Nothing was saved.",
  },
  [ApiErrorCode.Timeout]: {
    title: "The server took too long",
    description: "The request timed out. It may or may not have been saved — reload before retrying.",
  },
  [ApiErrorCode.InvalidResponse]: {
    title: "Unexpected response",
    description: "The server replied in a form this app does not understand.",
  },
};

const COPY_BY_STATUS: Array<[(status: number) => boolean, ApiErrorCopy]> = [
  [(s) => s === 400 || s === 422, COPY_BY_CODE[ApiErrorCode.ValidationError]],
  [(s) => s === 401, COPY_BY_CODE[ApiErrorCode.Unauthenticated]],
  [(s) => s === 403, COPY_BY_CODE[ApiErrorCode.Forbidden]],
  [(s) => s === 404, COPY_BY_CODE[ApiErrorCode.NotFound]],
  [(s) => s === 409, COPY_BY_CODE[ApiErrorCode.Conflict]],
  [
    (s) => s === 429,
    {
      title: "Too many requests",
      description: "Slow down for a moment, then try again.",
    },
  ],
  [
    (s) => s >= 500,
    {
      title: "The server had a problem",
      description: "This is not something you did. Try again shortly.",
    },
  ],
];

const FALLBACK_COPY: ApiErrorCopy = {
  title: "Something went wrong",
  description: "The request could not be completed.",
};

/**
 * Maps a failure to user-facing copy. Falls back to the HTTP status, then to
 * generic wording, so an unmapped code never surfaces raw to staff.
 *
 * The API's own `message` is deliberately not used as the description: it is
 * written for developers. Show it in a detail view alongside `requestId`.
 */
export function describeApiError(error: unknown): ApiErrorCopy {
  if (!ApiError.is(error)) {
    return FALLBACK_COPY;
  }

  const byCode = COPY_BY_CODE[error.code];
  if (byCode) return byCode;

  const byStatus = COPY_BY_STATUS.find(([matches]) => matches(error.status));
  return byStatus ? byStatus[1] : FALLBACK_COPY;
}
