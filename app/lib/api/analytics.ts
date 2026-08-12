/**
 * Analytics tag — `/analytics/*`, minus the notes search that Phase 5 already
 * owns (see `~/lib/api/notes`).
 *
 * Three calls for T13.3: read the catalogue, run one metric by name, read the
 * dashboard. None of them takes a query the client composed — see
 * `~/models/analytics` on why there is no query endpoint to compose one for.
 *
 * **Role gates.** Unlike `/reports/*`, which the spec restricts to admin,
 * cashier and claims, none of these three declares a required role: any
 * signed-in staff member may read the dashboard and run a metric. That is why
 * the Analytics nav entry is offered to everyone rather than to `claims`.
 */

import type {
  AskQuestion,
  AskResult,
  AssistantStatus,
  Dashboard,
  MetricResult,
  MetricSummary,
} from "~/models/analytics";
import { request, type RequestOptions } from "./client";

/**
 * Every metric the backend can run.
 *
 * The source of truth for the picker *and* for what the assistant can answer
 * in words — the spec is explicit that it matches a plain-English question
 * against this same list.
 */
export function listMetrics(options: RequestOptions): Promise<MetricSummary[]> {
  return request<MetricSummary[]>("/analytics/metrics", options);
}

/**
 * Run one metric by name.
 *
 * `params` is the metric's own free-form body — the catalogue entry describes
 * what it takes, and `MetricResult.params` echoes back what it actually ran
 * with. An unknown parameter is the backend's business to reject; passing
 * `{}` runs the metric on its defaults, which is what the picker does.
 */
export function runMetric(
  name: string,
  params: Record<string, unknown>,
  options: RequestOptions,
): Promise<MetricResult> {
  return request<MetricResult>(`/analytics/metrics/${encodeURIComponent(name)}/run`, {
    ...options,
    method: "POST",
    body: params,
  });
}

/**
 * The headline numbers for the executive dashboard.
 *
 * Composed by the API from the same metrics `runMetric` exposes, so a tile and
 * the metric behind it cannot disagree.
 */
export function getDashboard(options: RequestOptions): Promise<Dashboard> {
  return request<Dashboard>("/analytics/dashboard", options);
}

/* -------------------------------------------------------------------------
   The assistant (T13.4)
   ------------------------------------------------------------------------- */

/**
 * How long a question may take before the request is abandoned.
 *
 * The client's 20-second default is sized for a database read. This one waits
 * on a language model choosing a metric, the metric running, and prose being
 * written around the result — a minute is not a sick request, and timing out
 * at 20s would abandon answers that were about to arrive.
 */
const ASK_TIMEOUT_MS = 90_000;

/**
 * Ask a question in plain English.
 *
 * The assistant picks **one metric from the catalogue**, runs it, and writes
 * around the real result — so this cannot return a figure that `runMetric`
 * would not also return. When no metric fits it says so (`answered: false`)
 * and suggests what can be asked instead; that is a successful response, not
 * an error to catch.
 *
 * With `stream: true` the same answer is also emitted token by token to the
 * `ai:<streamId>` socket room. The resolved value is complete either way —
 * streaming is presentation, never the source of the answer.
 */
export function ask(input: AskQuestion, options: RequestOptions): Promise<AskResult> {
  return request<AskResult>("/analytics/ask", {
    timeoutMs: ASK_TIMEOUT_MS,
    ...options,
    method: "POST",
    body: input,
  });
}

/**
 * Whether the assistant is reachable, and what it is running on.
 *
 * Unauthenticated — the spec offers it as the thing to check before a demo —
 * but called with the token anyway so it travels the same path as everything
 * else here.
 */
export function getAssistantStatus(options?: RequestOptions): Promise<AssistantStatus> {
  return request<AssistantStatus>("/analytics/assistant/status", options);
}
