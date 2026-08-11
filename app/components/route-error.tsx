import { AlertTriangleIcon, HomeIcon, RotateCwIcon } from "lucide-react";
import { Link, isRouteErrorResponse, useRevalidator } from "react-router";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ApiError, describeApiError } from "~/lib/api/errors";
import type { ApiErrorPayload, ErrorDetail } from "~/models/primitives";

type NormalizedError = {
  title: string;
  description: string;
  /** The API's own code — developer-facing, shown in the detail block. */
  code?: string;
  /** The API's own message — developer-facing. */
  message?: string;
  requestId?: string;
  details: ErrorDetail[];
  status?: number;
  stack?: string;
};

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ApiErrorPayload).code === "string" &&
    typeof (value as ApiErrorPayload).message === "string"
  );
}

function fromPayload(payload: ApiErrorPayload, status: number): NormalizedError {
  const rebuilt = new ApiError({ ...payload, status });
  const copy = describeApiError(rebuilt);

  return {
    ...copy,
    code: payload.code,
    message: payload.message,
    requestId: payload.requestId,
    details: payload.details ?? [],
    status,
  };
}

/**
 * Flattens everything a route boundary can be handed into one shape.
 *
 * Three things arrive here: an {@link ApiError} thrown by a loader (intact
 * during SSR), a router `ErrorResponse` — whose `data` may itself be an API
 * error payload, which is how loaders forward one losslessly — and any other
 * thrown value.
 */
function normalize(error: unknown): NormalizedError {
  if (ApiError.is(error)) {
    return {
      ...describeApiError(error),
      code: error.code,
      message: error.message,
      requestId: error.requestId,
      details: error.details,
      status: error.status,
    };
  }

  if (isRouteErrorResponse(error)) {
    if (isApiErrorPayload(error.data)) {
      return fromPayload(error.data, error.status);
    }

    if (error.status === 404) {
      return {
        title: "Page not found",
        description: "That link does not lead anywhere. Check it, or start again from the home page.",
        details: [],
        status: 404,
      };
    }

    return {
      title: "Something went wrong",
      description: error.statusText || "The request could not be completed.",
      details: [],
      status: error.status,
      message: typeof error.data === "string" ? error.data : undefined,
    };
  }

  return {
    title: "Something went wrong",
    description: "An unexpected error occurred. Nothing you did caused this.",
    details: [],
    message: error instanceof Error ? error.message : undefined,
    stack: import.meta.env.DEV && error instanceof Error ? error.stack : undefined,
  };
}

/**
 * The error surface every route's `ErrorBoundary` renders.
 *
 * Staff see the copy from `describeApiError`; the raw code, message and
 * `requestId` sit underneath, because support cannot trace a failure without
 * the request id.
 */
export function RouteError({ error }: { error: unknown }) {
  const { revalidate, state } = useRevalidator();
  const normalized = normalize(error);
  const hasDiagnostics = Boolean(
    normalized.code || normalized.message || normalized.requestId || normalized.details.length,
  );

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl items-center p-6">
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"
            >
              <AlertTriangleIcon className="size-5" />
            </span>
            <div className="space-y-1">
              <CardTitle>{normalized.title}</CardTitle>
              <CardDescription>{normalized.description}</CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {normalized.details.length > 0 && (
            <ul className="space-y-1 text-sm">
              {normalized.details.map((detail, index) => (
                <li key={`${detail.path ?? "detail"}-${index}`} className="flex gap-2">
                  {detail.path && (
                    <span className="font-mono text-xs text-muted-foreground">{detail.path}</span>
                  )}
                  <span>{detail.message}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => revalidate()} disabled={state === "loading"}>
              <RotateCwIcon />
              {state === "loading" ? "Retrying…" : "Try again"}
            </Button>
            <Button variant="outline" render={<Link to="/" />}>
              <HomeIcon />
              Home
            </Button>
          </div>

          {hasDiagnostics && (
            <dl className="grid gap-x-4 gap-y-1 border-t pt-4 text-xs text-muted-foreground sm:grid-cols-[auto_1fr]">
              {normalized.status !== undefined && normalized.status > 0 && (
                <>
                  <dt>Status</dt>
                  <dd className="font-mono">{normalized.status}</dd>
                </>
              )}
              {normalized.code && (
                <>
                  <dt>Code</dt>
                  <dd className="font-mono">{normalized.code}</dd>
                </>
              )}
              {normalized.message && (
                <>
                  <dt>Detail</dt>
                  <dd>{normalized.message}</dd>
                </>
              )}
              {normalized.requestId && (
                <>
                  <dt>Request</dt>
                  <dd className="font-mono break-all select-all">{normalized.requestId}</dd>
                </>
              )}
            </dl>
          )}

          {normalized.stack && (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
              <code>{normalized.stack}</code>
            </pre>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
