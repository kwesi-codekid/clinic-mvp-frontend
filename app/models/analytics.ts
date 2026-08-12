/**
 * Analytics models (T13.3) — the metric catalogue, its results, and the
 * executive dashboard.
 *
 * Modelled from `components.schemas.{MetricSummary, MetricResult, Dashboard}`.
 *
 * The shape of this domain is unusual enough to state plainly, because it is
 * what the screens are built around:
 *
 * **There is no query endpoint.** No `POST /analytics/query`, no filter DSL,
 * nothing the client composes. The API publishes a *catalogue* of named
 * metrics (`GET /analytics/metrics`) and runs one by name
 * (`POST /analytics/metrics/{name}/run`). So the picker is built from the
 * catalogue, and a metric the backend has not published cannot be asked for.
 * That is a feature: it is also what makes T13.4's assistant trustworthy,
 * since the only figures it can produce are the ones this catalogue can.
 *
 * **A result describes itself.** {@link MetricResult} carries its own columns,
 * each with a {@link MetricColumnType}, so one renderer covers every metric —
 * see `~/components/metric-result`. `params` and `meta` are free-form by
 * design: each metric decides what it takes and what it wants to say about the
 * run, and the frontend does not enumerate either.
 */

import type { MetricColumnType } from "~/models/enums";

/* -------------------------------------------------------------------------
   The catalogue
   ------------------------------------------------------------------------- */

/**
 * One question the system can answer with real numbers.
 *
 * `examples` are plain-English phrasings — the same strings the assistant
 * matches a question against, which is why the picker shows them: they teach
 * someone how to ask before they ever open the ask box.
 */
export type MetricSummary = {
  /** Wire name. What `POST /analytics/metrics/{name}/run` takes. */
  name: string;
  title: string;
  description: string;
  /** Free-form grouping ("revenue", "clinical", …). Not a closed set. */
  category: string;
  /** The chart the API thinks suits this result. Advisory. */
  visualization: string;
  examples: string[];
};

/* -------------------------------------------------------------------------
   A result
   ------------------------------------------------------------------------- */

/** One column of a {@link MetricResult}, and how to render it. */
export type MetricColumn = {
  /** Key into each row object. */
  key: string;
  label: string;
  type: MetricColumnType;
};

/**
 * A row is whatever its columns say it is.
 *
 * Deliberately not `Record<string, string | number>`: `columns[].type` is the
 * authority on how a cell reads, and widening the value type here would only
 * invite a component to guess from the runtime shape instead.
 */
export type MetricRow = Record<string, unknown>;

/** Chart-ready output. Money columns are integer pesewas. */
export type MetricResult = {
  /** Which metric produced this. Rendered next to the answer — see T13.4. */
  metric: {
    name: string;
    title: string;
    visualization: string;
    category: string;
  };
  /** The parameters it actually ran with, echoed back. */
  params: Record<string, unknown>;
  columns: MetricColumn[];
  rows: MetricRow[];
  /**
   * A one-line answer, **computed rather than generated** — the API derives it
   * from the rows. Render it above the table: it is the sentence someone came
   * for, and unlike prose it cannot disagree with the figures beneath it.
   */
  headline?: string;
  /** Per-metric extras (period covered, row cap hit, …). Free-form. */
  meta?: Record<string, unknown>;
};

/* -------------------------------------------------------------------------
   The dashboard
   ------------------------------------------------------------------------- */

/** Attendances and money for one window. */
export type DashboardPeriod = {
  attendances: number;
  revenuePesewas: number;
  revenueFormatted: string;
};

/**
 * The headline numbers, composed by the API from the same metrics used
 * everywhere else — so the dashboard cannot drift from the metric that
 * produced it.
 *
 * Three fields are optional because they only exist where the module does:
 * `bedOccupancyPercent` needs a ward (T15), `topDiagnosis` needs somebody to
 * have been diagnosed today. A tile with nothing behind it is not rendered
 * rather than rendered as a zero, which would read as a real measurement.
 */
export type Dashboard = {
  generatedAt: string;
  today: DashboardPeriod;
  month: DashboardPeriod;
  topDiagnosis?: string;
  bedOccupancyPercent?: number;
  lowStockCount: number;
  outstandingPesewas: number;
  outstandingFormatted: string;
  nhisShortfallPesewas: number;
  nhisShortfallFormatted: string;
};

/* -------------------------------------------------------------------------
   The assistant (T13.4)
   ------------------------------------------------------------------------- */

/**
 * Whether the assistant is reachable, and what it is running on.
 *
 * Read before offering the ask box. `enabled` is configuration, `reachable` is
 * the provider answering right now, and `chatModelPresent` is the one people
 * forget: a provider can be up and authenticated while the configured model is
 * not served there, which fails at the moment someone asks rather than at
 * start-up. {@link isAssistantUsable} requires all three.
 *
 * `embeddingsAvailable` belongs to notes search (T5.3), not to asking — a
 * provider with no embeddings route still answers questions.
 */
export type AssistantStatus = {
  enabled: boolean;
  reachable: boolean;
  baseUrl: string;
  /** Whether an API key is configured. */
  authenticated: boolean;
  chatModel: string;
  chatModelPresent: boolean;
  /** False on providers with no embeddings route; notes search falls back to text. */
  embeddingsAvailable: boolean;
  embedModel: string;
  availableModels: string[];
};

/** One thing worth asking next, taken from the metric catalogue. */
export type AskSuggestion = {
  /** The metric it would run. */
  name: string;
  title: string;
  /** Plain-English phrasings that reach it. */
  examples: string[];
};

/**
 * An answer: prose written *around* a real metric run, never instead of one.
 *
 * This is the whole contract of the feature, and the UI's job is to make it
 * visible. The assistant picks one metric from the catalogue, runs it, and
 * writes `narrative` around the figures that come back. It never produces a
 * number of its own. So:
 *
 * - `answered: false` with no `result` is a **correct** outcome, not an error.
 *   It means no catalogued metric fits the question, and the honest answer is
 *   to say so and list what can be asked — which is what `suggestions` is for.
 * - Whenever `result` is present, the screen names the metric that ran. That
 *   attribution is the reason the answer can be trusted at all, and burying it
 *   would turn a checkable claim back into a chatbot's word.
 * - The figures rendered come from `result`, never parsed back out of
 *   `narrative`.
 */
export type AskResult = {
  /** Echoed back, so a stored answer carries its own question. */
  question: string;
  answered: boolean;
  /** Prose written around the figures, never instead of them. */
  narrative: string;
  /** The metric run the narrative describes. Absent when nothing fit. */
  result?: MetricResult;
  suggestions?: AskSuggestion[];
  /** Join the `ai:<streamId>` socket room to follow tokens. */
  streamId?: string;
  usedModel?: string;
};

/** Body of `POST /analytics/ask`. */
export type AskQuestion = {
  /** At least 3 characters, per the spec. */
  question: string;
  /** Emit tokens over Socket.io as they are generated. */
  stream?: boolean;
  /** Supply your own id to join the room before asking. */
  streamId?: string;
};

/* -------------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------------- */

/**
 * Whether it is worth offering the ask box.
 *
 * All three conditions matter, and `chatModelPresent` is the one that turns a
 * confusing failure into a clear one — see {@link AssistantStatus}.
 */
export function isAssistantUsable(status: AssistantStatus): boolean {
  return status.enabled && status.reachable && status.chatModelPresent;
}

/**
 * Why the assistant is unavailable, in a sentence someone can act on.
 * `null` when it is available.
 */
export function describeAssistantStatus(status: AssistantStatus): string | null {
  if (!status.enabled) return "The assistant is switched off for this clinic.";
  if (!status.authenticated) {
    return "The assistant has no API key configured, so it cannot be called.";
  }
  if (!status.reachable) {
    return `The assistant's provider (${status.baseUrl}) is not responding.`;
  }
  if (!status.chatModelPresent) {
    return `The configured model (${status.chatModel}) is not served by the provider.`;
  }
  return null;
}

/**
 * Group a catalogue by `category`, preserving the API's ordering within each
 * group and the order in which categories first appear.
 *
 * `category` is free-form, so this deliberately does not map it to a known set
 * — a category the backend adds tomorrow gets its own heading on its own.
 */
export function groupMetricsByCategory(
  metrics: readonly MetricSummary[],
): Array<{ category: string; metrics: MetricSummary[] }> {
  const groups = new Map<string, MetricSummary[]>();

  for (const metric of metrics) {
    const existing = groups.get(metric.category);
    if (existing) existing.push(metric);
    else groups.set(metric.category, [metric]);
  }

  return [...groups].map(([category, list]) => ({ category, metrics: list }));
}

/**
 * Whether a result has anything to tabulate.
 *
 * An empty result is a normal answer — "no NHIS claims were rejected this
 * month" is good news, not a failure — so screens render the headline and an
 * empty state rather than an error.
 */
export function isEmptyResult(result: MetricResult): boolean {
  return result.rows.length === 0;
}
