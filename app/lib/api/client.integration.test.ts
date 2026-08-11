/**
 * Contract checks against the **deployed** backend — this is T0.3's
 * "done when", not a unit test. Excluded from `npm test`; run with
 * `npm run test:api` when the API is reachable.
 */

import { describe, expect, it } from "vitest";

import { getHealth } from "./platform";
import { ApiError, ApiErrorCode, request, requestPage } from "./client";

const baseUrl =
  process.env.API_BASE_URL ?? "https://clinic-mvp-backend.auxiliarynetwork.com/api/v1";

describe("GET /health", () => {
  it("unwraps the envelope into a typed Health", async () => {
    const health = await getHealth({ baseUrl });

    expect(["ok", "degraded"]).toContain(health.status);
    expect(typeof health.uptimeSeconds).toBe("number");
    expect(typeof health.version).toBe("string");
    expect(["up", "down"]).toContain(health.checks.database);
    expect(typeof health.checks.databaseWritable).toBe("boolean");
    expect(["enabled", "disabled"]).toContain(health.checks.ai);
    expect(typeof health.transactionsAvailable).toBe("boolean");
  });
});

describe("failures", () => {
  it("surfaces ApiError.code and requestId on a 401", async () => {
    const failure = await request("/auth/me", { baseUrl }).catch((error: unknown) => error);

    expect(ApiError.is(failure)).toBe(true);
    const error = failure as ApiError;
    expect(error.status).toBe(401);
    expect(error.code).toBe(ApiErrorCode.Unauthenticated);
    expect(error.isAuthError).toBe(true);
    expect(error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("surfaces field-level details on a 400", async () => {
    const failure = await request("/auth/login", {
      method: "POST",
      body: {},
      baseUrl,
    }).catch((error: unknown) => error);

    expect(ApiError.is(failure)).toBe(true);
    const error = failure as ApiError;
    expect(error.status).toBe(400);
    expect(error.code).toBe(ApiErrorCode.ValidationError);
    expect(error.details.length).toBeGreaterThan(0);
    expect(error.fieldErrors()["body.identifier"]).toBeTruthy();
  });

  it("rejects an unauthenticated list with a typed error, not a parse failure", async () => {
    const failure = await requestPage("/patients", { baseUrl }).catch((error: unknown) => error);

    expect(ApiError.is(failure)).toBe(true);
    expect((failure as ApiError).status).toBe(401);
  });

  it("reports an unreachable host as NETWORK_ERROR", async () => {
    const failure = await request("/health", {
      baseUrl: "https://clinic-mvp-backend.invalid/api/v1",
      timeoutMs: 5_000,
    }).catch((error: unknown) => error);

    expect(ApiError.is(failure)).toBe(true);
    expect([ApiErrorCode.NetworkError, ApiErrorCode.Timeout]).toContain(
      (failure as ApiError).code,
    );
    expect((failure as ApiError).isRetryable).toBe(true);
  });
});
