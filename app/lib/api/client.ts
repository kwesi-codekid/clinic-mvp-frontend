/**
 * The single door to the Clinic Management API.
 *
 * Everything the wire contract asks for lives here so no caller repeats it:
 * the `{ data }` / `{ data, meta }` envelope is unwrapped, the
 * `{ error: { … } }` envelope becomes a typed {@link ApiError}, the bearer
 * token is attached, and the base URL comes from the environment.
 *
 * Call it from loaders and actions. Route modules should not call `fetch`.
 */

import type { ListEnvelope, PageMeta, Paginated } from "~/models/primitives";
import { ApiError, ApiErrorCode } from "./errors";

export { ApiError, ApiErrorCode, describeApiError } from "./errors";

/** Requests that outlive this are aborted. The clinic network is not fast. */
const DEFAULT_TIMEOUT_MS = 20_000;

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<string | number>;

export type QueryParams = Record<string, QueryValue>;

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Serialised as JSON. Use `FormData`/`URLSearchParams` to send them as-is. */
  body?: unknown;
  /** Appended to the URL. `undefined` and `null` entries are dropped. */
  query?: QueryParams;
  /** Access token for `Authorization: Bearer`. */
  token?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Defaults to 20s. Pass `0` to disable. */
  timeoutMs?: number;
  /** Overrides the environment base URL. Mostly for tests. */
  baseUrl?: string;
};

/* -------------------------------------------------------------------------
   Base URL
   ------------------------------------------------------------------------- */

/**
 * Reads the API base URL from the environment. Never hardcoded: the same build
 * has to point at a local backend, a staging one and production.
 *
 * - Server (loaders, actions, the SSR entry): `API_BASE_URL`.
 * - Browser, if a component ever fetches directly: `VITE_API_BASE_URL`.
 */
export function getApiBaseUrl(explicit?: string): string {
  const configured =
    explicit ??
    (typeof process !== "undefined" ? process.env?.API_BASE_URL : undefined) ??
    (typeof import.meta !== "undefined"
      ? (import.meta.env?.VITE_API_BASE_URL as string | undefined)
      : undefined);

  if (!configured) {
    throw new Error(
      "API base URL is not configured. Set API_BASE_URL (server) or " +
        "VITE_API_BASE_URL (browser) — see .env.example.",
    );
  }

  return configured.replace(/\/+$/, "");
}

function buildUrl(path: string, query: QueryParams | undefined, baseUrl: string): string {
  const url = new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) url.searchParams.append(key, String(entry));
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

/* -------------------------------------------------------------------------
   Envelope handling
   ------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPageMeta(value: unknown): value is PageMeta {
  return (
    isRecord(value) &&
    typeof value.page === "number" &&
    typeof value.limit === "number" &&
    typeof value.total === "number" &&
    typeof value.totalPages === "number"
  );
}

/** Turns a failed response into an {@link ApiError}, envelope or not. */
function toApiError(
  response: Response,
  payload: unknown,
  method: string,
  url: string,
): ApiError {
  const envelope = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;

  return new ApiError({
    status: response.status,
    code: typeof envelope?.code === "string" ? envelope.code : `HTTP_${response.status}`,
    message:
      typeof envelope?.message === "string"
        ? envelope.message
        : response.statusText || `Request failed with status ${response.status}`,
    details: Array.isArray(envelope?.details)
      ? (envelope.details as ApiError["details"])
      : undefined,
    data: envelope?.data,
    requestId:
      typeof envelope?.requestId === "string"
        ? envelope.requestId
        : (response.headers.get("x-request-id") ?? undefined),
    method,
    url,
  });
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;

  const text = await response.text();
  if (text.trim() === "") return undefined;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    // An HTML error page from a proxy, most likely.
    return { __raw: text };
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ApiError({
      status: response.status,
      code: ApiErrorCode.InvalidResponse,
      message: "The server returned a body that is not valid JSON.",
      cause,
    });
  }
}

/* -------------------------------------------------------------------------
   The request
   ------------------------------------------------------------------------- */

type SentResponse = {
  /** The parsed success envelope, or `undefined` for `204 No Content`. */
  envelope: Record<string, unknown> | undefined;
  status: number;
  method: string;
  url: string;
};

/**
 * Performs the request and validates the transport and the error envelope,
 * stopping just short of unwrapping — {@link request} and {@link requestPage}
 * differ only in what they take out of the envelope.
 */
async function send(path: string, options: RequestOptions): Promise<SentResponse> {
  const {
    method = "GET",
    body,
    query,
    token,
    headers = {},
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    baseUrl,
  } = options;

  const url = buildUrl(path, query, getApiBaseUrl(baseUrl));

  const requestHeaders: Record<string, string> = { accept: "application/json", ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;

  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (body instanceof FormData || body instanceof URLSearchParams) {
      payload = body;
    } else {
      payload = JSON.stringify(body);
      requestHeaders["content-type"] ??= "application/json";
    }
  }

  const timeout = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
  const abortSignal =
    signal && timeout ? AbortSignal.any([signal, timeout]) : (signal ?? timeout);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: payload,
      signal: abortSignal,
    });
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === "AbortError";
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";

    throw new ApiError({
      status: 0,
      code: aborted || timedOut ? ApiErrorCode.Timeout : ApiErrorCode.NetworkError,
      message:
        aborted || timedOut
          ? `${method} ${path} did not complete in time.`
          : `${method} ${path} could not reach the server.`,
      method,
      url,
      cause,
    });
  }

  const parsed = await readBody(response);

  if (!response.ok) {
    throw toApiError(response, parsed, method, url);
  }

  if (parsed !== undefined && !isRecord(parsed)) {
    throw new ApiError({
      status: response.status,
      code: ApiErrorCode.InvalidResponse,
      message: `${method} ${path} returned a body that is not an envelope.`,
      method,
      url,
    });
  }

  return { envelope: parsed, status: response.status, method, url };
}

/**
 * Performs a request and returns the **unwrapped** `data` payload.
 *
 * Rejects with an {@link ApiError} for any non-2xx response, an aborted or
 * timed-out request, a transport failure, or a body that is not the documented
 * envelope. `204 No Content` resolves to `undefined`.
 *
 * @example const patient = await request<Patient>(`/patients/${id}`, { token });
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { envelope, status, method, url } = await send(path, options);

  if (envelope === undefined) {
    return undefined as T;
  }

  if (!("data" in envelope)) {
    throw new ApiError({
      status,
      code: ApiErrorCode.InvalidResponse,
      message: `${method} ${path} returned a body without a "data" envelope.`,
      method,
      url,
    });
  }

  return envelope.data as T;
}

/**
 * A paginated `GET`, returning `items` plus the API's {@link PageMeta}.
 * Use this for every index endpoint so one list component can drive them all.
 */
export async function requestPage<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Paginated<T>> {
  const { envelope, status, method, url } = await send(path, options);
  const list = envelope as ListEnvelope<T> | undefined;

  if (!list || !Array.isArray(list.data) || !isPageMeta(list.meta)) {
    throw new ApiError({
      status,
      code: ApiErrorCode.InvalidResponse,
      message: `${method} ${path} did not return a paginated envelope.`,
      method,
      url,
    });
  }

  return { items: list.data, meta: list.meta };
}

/* -------------------------------------------------------------------------
   Bound client
   ------------------------------------------------------------------------- */

export type ApiClient = {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  list<T>(path: string, options?: RequestOptions): Promise<Paginated<T>>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  del<T>(path: string, options?: RequestOptions): Promise<T>;
};

/**
 * Binds a token (and any other defaults) so a loader can make several calls
 * without repeating itself.
 *
 * @example
 * const api = createApiClient({ token: session.accessToken });
 * const [patient, visits] = await Promise.all([
 *   api.get<Patient>(`/patients/${id}`),
 *   api.list<VisitSummary>("/visits", { query: { patientId: id } }),
 * ]);
 */
export function createApiClient(defaults: Omit<RequestOptions, "method" | "body"> = {}): ApiClient {
  const merge = (options?: RequestOptions): RequestOptions => ({
    ...defaults,
    ...options,
    headers: { ...defaults.headers, ...options?.headers },
    query: { ...defaults.query, ...options?.query },
  });

  return {
    get: (path, options) => request(path, { ...merge(options), method: "GET" }),
    list: (path, options) => requestPage(path, { ...merge(options), method: "GET" }),
    post: (path, body, options) => request(path, { ...merge(options), method: "POST", body }),
    put: (path, body, options) => request(path, { ...merge(options), method: "PUT", body }),
    patch: (path, body, options) => request(path, { ...merge(options), method: "PATCH", body }),
    del: (path, options) => request(path, { ...merge(options), method: "DELETE" }),
  };
}
