/**
 * Primitive types shared by every model, plus the response envelopes the API
 * wraps around them.
 *
 * Wire conventions, encoded once here:
 * - Success is `{ data }`, and lists add `{ meta }`.
 * - Failure is `{ error: { code, message, details?, data?, requestId? } }`.
 * - Money is an integer count of pesewas (100 = GHS 1.00) paired with a
 *   preformatted display string — see `~/lib/money`.
 * - Identifiers are 24-character hex ObjectId strings.
 * - Timestamps are ISO 8601 in UTC; plain dates are `YYYY-MM-DD`.
 */

declare const objectIdBrand: unique symbol;

/**
 * A 24-character hexadecimal identifier.
 *
 * Branded so a folder number, accession number or receipt number cannot be
 * passed where a document id is expected. Values arriving inside API responses
 * are already typed; strings from route params and form fields have to go
 * through {@link parseObjectId}, which is the validation you want at that
 * boundary anyway.
 */
export type ObjectId = string & { readonly [objectIdBrand]: true };

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/;

export function isObjectId(value: unknown): value is ObjectId {
  return typeof value === "string" && OBJECT_ID_PATTERN.test(value);
}

/**
 * Narrows a route param or form value to an {@link ObjectId}.
 * Throws a 404 `Response` when it is not one, so a loader can call this
 * directly on `params.id` and let the route error boundary render.
 */
export function parseObjectId(value: string | undefined, label = "id"): ObjectId {
  if (!isObjectId(value)) {
    throw new Response(`Invalid ${label}`, { status: 404, statusText: "Not Found" });
  }
  return value;
}

/** An ISO 8601 timestamp in UTC, e.g. `2026-08-11T09:30:00.000Z`. */
export type IsoDateTime = string;

/** A calendar date with no time component, e.g. `2026-08-11`. */
export type IsoDate = string;

/**
 * An amount in integer pesewas plus a display string built by the API.
 *
 * Render `formatted`. Only reach for `pesewas` to do arithmetic, and only
 * through the integer helpers in `~/lib/money` — never floating point.
 */
export type Money = {
  pesewas: number;
  formatted: string;
};

/** Pagination counters returned alongside every list response. */
export type PageMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

/** Query parameters every paginated index endpoint accepts. */
export type PageQuery = {
  page?: number;
  /** 1–200; the API defaults to 25. */
  limit?: number;
  /** Field name, prefixed with `-` for descending. */
  sort?: string;
};

/** One field-level problem behind a `VALIDATION_ERROR`. */
export type ErrorDetail = {
  /** Dotted path to the offending field, e.g. `body.identifier`. */
  path?: string;
  message: string;
};

/** The `error` payload carried by every failed request. */
export type ApiErrorPayload = {
  code: string;
  message: string;
  details?: ErrorDetail[];
  /**
   * Structured payload for errors the client can act on — for example the
   * candidate folders behind a duplicate-registration conflict.
   */
  data?: unknown;
  /** Correlates with the backend log; always show it in support surfaces. */
  requestId?: string;
};

/** The shape every failed request returns. */
export type ErrorResponse = {
  error: ApiErrorPayload;
};

/** Envelope around a single resource. */
export type DataEnvelope<T> = {
  data: T;
};

/** Envelope around a page of resources. */
export type ListEnvelope<T> = {
  data: T[];
  meta: PageMeta;
};

/** A page of resources, unwrapped — what `~/lib/api/client` hands back. */
export type Paginated<T> = {
  items: T[];
  meta: PageMeta;
};
