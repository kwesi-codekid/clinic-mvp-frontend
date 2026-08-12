/**
 * The natural-language assistant (T13.4) — `/analytics/assistant`.
 *
 * Ask a question in English; get a real metric run with prose written around
 * it. The single most important thing this screen does is **name the metric
 * that ran**. The assistant can only ever execute one of the catalogued
 * metrics (T13.3) and writes around the figures that come back — it never
 * produces a number of its own — and that constraint is the entire reason the
 * answer can be trusted. An answer that hides which metric produced it is
 * indistinguishable from a chatbot's guess, so the attribution is rendered
 * beside the headline rather than tucked into a footer.
 *
 * Two consequences of the same idea:
 *
 * - Every figure on screen comes from `result`, rendered by the same generic
 *   renderer the metrics page uses. Nothing is parsed back out of the prose.
 * - `answered: false` is a correct outcome, not an error. It means no metric
 *   fits the question; the honest response is to say so and list what *can* be
 *   asked, which is what the suggestions are.
 *
 * **Streaming.** With the socket up, the question is sent with `stream: true`
 * and a client-generated `streamId`, and tokens are rendered as they arrive.
 * The POST's own response is still the authority: when it lands it replaces
 * whatever was streamed. So a socket that is down, or a room join the backend
 * does not recognise, costs the *appearance* of typing and nothing else — the
 * answer arrives either way. That fallback is deliberate, because the room's
 * join event is the one part of this contract the spec does not document (see
 * {@link JOIN_EVENT}).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  ChartColumnIcon,
  Loader2Icon,
  SendHorizontalIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { data, Link, useFetcher } from "react-router";

import { MetricTable } from "~/components/metric-result";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ask, getAssistantStatus, listMetrics } from "~/lib/api/analytics";
import { ApiError, describeApiError } from "~/lib/api/client";
import { getHealth } from "~/lib/api/platform";
import { throwRouteError } from "~/lib/api/route-error";
import { requireStaff, requireStaffAction } from "~/lib/auth.server";
import { emitRealtime, useRealtimeAny, useRealtimeStatus } from "~/lib/realtime";
import {
  describeAssistantStatus,
  isAssistantUsable,
  type AskResult,
  type AskSuggestion,
  type MetricSummary,
} from "~/models/analytics";
import type { Route } from "./+types/analytics-assistant";

export function meta() {
  return [{ title: "Ask · Analytics · Clinic" }];
}

/* -------------------------------------------------------------------------
   Loader
   ------------------------------------------------------------------------- */

export async function loader({ request }: Route.LoaderArgs) {
  const { accessToken } = await requireStaff(request);
  const options = { token: accessToken };

  try {
    // Both gates the task asks for: the assistant's own status, and the
    // platform's `checks.ai`. They can disagree — `/health` is cached cheaply
    // while the status call actually reaches the provider — and when they do,
    // the more pessimistic one wins.
    const [status, health, metrics] = await Promise.all([
      getAssistantStatus(options),
      getHealth(),
      listMetrics(options),
    ]);

    return {
      status,
      aiEnabled: health.checks.ai === "enabled",
      metrics,
    };
  } catch (error) {
    throwRouteError(error);
  }
}

/* -------------------------------------------------------------------------
   Action
   ------------------------------------------------------------------------- */

type AskOutcome =
  | { ok: true; answer: AskResult }
  | { ok: false; message: string };

export async function action({ request }: Route.ActionArgs) {
  const { accessToken, setCookie } = await requireStaffAction(request);
  const form = await request.formData();

  // A rotated token has to ride out on every exit, success or not.
  const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;

  const question = String(form.get("question") ?? "").trim();
  if (question.length < 3) {
    return data<AskOutcome>(
      { ok: false, message: "Ask a question of at least three characters." },
      { status: 400, headers },
    );
  }

  // Only claim to stream when the browser said it had a room to stream into.
  const streamId = String(form.get("streamId") ?? "").trim() || undefined;

  try {
    const answer = await ask(
      { question, stream: Boolean(streamId), streamId },
      { token: accessToken },
    );
    return data<AskOutcome>({ ok: true, answer }, { headers });
  } catch (error) {
    if (!ApiError.is(error)) throw error;
    return data<AskOutcome>(
      { ok: false, message: describeApiError(error).description },
      { status: error.status >= 400 ? error.status : 502, headers },
    );
  }
}

/* -------------------------------------------------------------------------
   The token stream
   ------------------------------------------------------------------------- */

/**
 * How the browser asks to be put in its own answer's room.
 *
 * The spec says "supply your own id to join the `ai:<streamId>` room before
 * asking" but never names the event that joins it. `ai:subscribe` mirrors the
 * documented `queue:subscribe`, which is the most that can be inferred — and
 * if it is wrong the only cost is that no tokens arrive and the complete
 * answer appears when the POST resolves, which is the documented fallback.
 * Worth confirming with the backend; not worth blocking on.
 */
const JOIN_EVENT = "ai:subscribe";

/** Events that mean the stream finished rather than carrying more of it. */
const TERMINAL = /:(done|end|complete|finished)$/;

/**
 * Pull a text chunk out of whatever shape the server emits.
 *
 * Undocumented, so this accepts the handful of conventions in circulation
 * rather than betting on one. Anything unrecognised is ignored — a stream that
 * renders nothing is invisible next to the real answer; a stream that renders
 * `[object Object]` is not.
 */
function chunkOf(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object" || payload === null) return "";

  const record = payload as Record<string, unknown>;
  for (const key of ["token", "delta", "text", "chunk", "content"]) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return "";
}

/** Whether an `ai:*` event belongs to the stream we are watching. */
function belongsToStream(event: string, payload: unknown, streamId: string): boolean {
  // The room name may be the event name itself (`ai:<streamId>`)…
  if (event === `ai:${streamId}`) return true;

  // …or the id may ride in the payload.
  if (typeof payload === "object" && payload !== null) {
    const carried = (payload as Record<string, unknown>).streamId;
    if (typeof carried === "string") return carried === streamId;
  }

  // Otherwise the server is only talking to rooms we joined, and this socket
  // joined exactly one.
  return true;
}

/**
 * Accumulate the answer as it is typed.
 *
 * Returns the text so far; `reset` clears it when a new question is asked or
 * when the authoritative response makes it redundant.
 */
function useAssistantStream(streamId: string | null) {
  const [text, setText] = useState("");
  const [finished, setFinished] = useState(false);

  useRealtimeAny(
    (event, ...args) => {
      if (!streamId || !event.startsWith("ai:")) return;
      const [payload] = args;
      if (!belongsToStream(event, payload, streamId)) return;

      if (TERMINAL.test(event)) {
        setFinished(true);
        return;
      }

      const chunk = chunkOf(payload);
      if (chunk) setText((previous) => previous + chunk);
    },
    Boolean(streamId),
  );

  const reset = useCallback(() => {
    setText("");
    setFinished(false);
  }, []);

  return { text, finished, reset };
}

/* -------------------------------------------------------------------------
   Pieces
   ------------------------------------------------------------------------- */

/**
 * The mark above the greeting: six dots in a ring, spinning slowly. Decorative
 * only — hidden from the accessibility tree, still under `motion-safe` so it
 * holds still for anyone who asked interfaces not to move.
 */
function DotMark() {
  const dots = Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    return { cx: 16 + Math.cos(angle) * 8.5, cy: 16 + Math.sin(angle) * 8.5 };
  });

  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="size-10 text-foreground motion-safe:animate-[spin_14s_linear_infinite]"
    >
      {dots.map((dot) => (
        <circle key={`${dot.cx}-${dot.cy}`} cx={dot.cx} cy={dot.cy} r="3.4" fill="currentColor" />
      ))}
    </svg>
  );
}

/**
 * One catalogued metric as an entry point. Clicking asks its first example
 * question — the card is a door into the same flow as typing, not a separate
 * feature, so a catalogue with no examples renders no card.
 */
function TopicCard({
  metric,
  onPick,
  disabled,
}: {
  metric: MetricSummary;
  onPick: (question: string) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(metric.examples[0])}
      className="group flex flex-col gap-2 rounded-xl border bg-card p-4 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 dark:hover:border-brand-500/60"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="font-heading text-sm font-semibold">{metric.title}</span>
        <span className="grid size-6 shrink-0 place-items-center rounded-full border text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
          <ArrowUpRightIcon className="size-3.5" />
        </span>
      </span>
      <span className="line-clamp-2 text-xs text-muted-foreground">{metric.description}</span>
    </button>
  );
}

function SuggestionChips({
  suggestions,
  onPick,
  disabled,
}: {
  suggestions: AskSuggestion[];
  onPick: (question: string) => void;
  disabled: boolean;
}) {
  const questions = suggestions.flatMap((suggestion) => suggestion.examples.slice(0, 2));
  if (questions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {questions.map((question) => (
        <Button
          key={question}
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onPick(question)}
        >
          {question}
        </Button>
      ))}
    </div>
  );
}

/**
 * The answer.
 *
 * Ordered the way it should be read: which metric ran, then the computed
 * headline, then the prose, then the figures the prose was written from. The
 * headline comes from `result.headline` — the API derives it from the rows, so
 * unlike the narrative it cannot disagree with the table underneath it.
 */
function Answer({ answer }: { answer: AskResult }) {
  const { result } = answer;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardDescription>You asked</CardDescription>
            <CardTitle className="text-balance">{answer.question}</CardTitle>
          </div>
          {result ? (
            <Badge variant="secondary" className="shrink-0 gap-1.5">
              <ChartColumnIcon className="size-3.5" />
              Ran {result.metric.title}
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0">
              No metric fits this
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {result?.headline && (
          <p className="font-heading text-xl font-semibold tracking-tight text-balance">
            {result.headline}
          </p>
        )}

        <p className="text-sm whitespace-pre-wrap">{answer.narrative}</p>

        {result && <MetricTable result={result} />}

        <p className="text-xs text-muted-foreground">
          {result ? (
            <>
              Figures from the <span className="font-mono">{result.metric.name}</span> metric,
              run against the database — not written by the model.
            </>
          ) : (
            <>
              The assistant only answers with metrics it can actually run, and says so when none
              fits rather than guessing.
            </>
          )}
          {answer.usedModel && <> Model: {answer.usedModel}.</>}
        </p>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

export default function AssistantPage({ loaderData }: Route.ComponentProps) {
  const { status, aiEnabled, metrics } = loaderData;
  const fetcher = useFetcher<AskOutcome>();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const realtime = useRealtimeStatus();
  const [streamId, setStreamId] = useState<string | null>(null);
  const stream = useAssistantStream(streamId);

  const usable = isAssistantUsable(status) && aiEnabled;
  const unavailable = aiEnabled
    ? describeAssistantStatus(status)
    : "The backend reports its assistant as disabled.";

  const asking = fetcher.state !== "idle";
  const outcome = fetcher.data;
  const answer = outcome?.ok ? outcome.answer : null;

  // The streamed text has done its job once the real answer lands.
  useEffect(() => {
    if (!asking && outcome) stream.reset();
    // `stream.reset` is stable; re-running on the stream object would clear
    // the text on every token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking, outcome]);

  /**
   * Join the room *before* the question is sent — the answer starts streaming
   * the moment the backend accepts it, and a room joined afterwards misses the
   * opening tokens.
   */
  const submit = useCallback(
    async (question: string) => {
      stream.reset();

      let id: string | null = null;
      if (realtime === "up" && typeof crypto !== "undefined") {
        id = crypto.randomUUID();
        const joined = await emitRealtime(JOIN_EVENT, { streamId: id });
        if (!joined) id = null;
      }
      setStreamId(id);

      void fetcher.submit(
        { question, ...(id ? { streamId: id } : {}) },
        { method: "post" },
      );
    },
    [fetcher, realtime, stream],
  );

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = inputRef.current?.value.trim() ?? "";
    if (question.length >= 3) void submit(question);
  };

  const onPick = (question: string) => {
    if (inputRef.current) inputRef.current.value = question;
    void submit(question);
  };

  // Enter asks; Shift+Enter is a newline. A question is one line of prose far
  // more often than it is a paragraph.
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    formRef.current?.requestSubmit();
  };

  /** Before anything has been asked, the catalogue is the prompt. */
  const openers: MetricSummary[] = metrics
    .filter((metric: MetricSummary) => metric.examples.length > 0)
    .slice(0, 4);

  /** The hero stands until the first question; from then on it's a conversation. */
  const conversing = asking || Boolean(outcome);

  return (
    <div className="relative -mx-4 -my-6 flex min-h-[calc(100svh-4rem)] flex-col overflow-hidden px-4 py-6 sm:-mx-6 sm:px-6">
      {/* The wash behind everything — brand blue standing in for the
          reference's lavender, faded enough to sit under both themes. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(52rem_26rem_at_18%_-4%,var(--color-brand-200),transparent_65%),radial-gradient(44rem_24rem_at_88%_6%,var(--color-brand-100),transparent_60%)] opacity-70 dark:bg-[radial-gradient(52rem_26rem_at_18%_-4%,oklch(0.481_0.131_252.5/0.25),transparent_65%),radial-gradient(44rem_24rem_at_88%_6%,oklch(0.549_0.148_253.2/0.15),transparent_60%)] dark:opacity-100"
      />

      <div className="flex items-center justify-between">
        <Link
          to="/analytics"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          Analytics
        </Link>
        <Badge variant="outline" className="bg-background/60 font-normal text-muted-foreground">
          {realtime === "up" ? "Answers stream live" : "Answers arrive complete"}
        </Badge>
      </div>

      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-8 py-10">
        {!conversing && (
          <div className="flex flex-col items-center gap-4 text-center">
            <DotMark />
            <h1 className="font-heading text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              How can we <span className="text-primary">assist</span> you today?
            </h1>
            <p className="max-w-md text-sm text-muted-foreground">
              Ask in plain English. Every answer comes from one of the clinic's own metrics, run
              against the database — pick a topic below or type a question to start.
            </p>
          </div>
        )}

        {!conversing && openers.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {openers.map((metric) => (
              <TopicCard
                key={metric.name}
                metric={metric}
                onPick={onPick}
                disabled={!usable || asking}
              />
            ))}
          </div>
        )}

        {!usable && (
          <p className="mx-auto flex max-w-xl items-start gap-2 rounded-md border border-dashed bg-background/60 p-4 text-sm text-muted-foreground">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <span>
              {unavailable} The metrics on the{" "}
              <Link to="/analytics" className="underline underline-offset-4">
                analytics page
              </Link>{" "}
              still run — only the plain-English route is unavailable.
            </span>
          </p>
        )}

        {/* While the POST is in flight, whatever has streamed so far stands in
            for the answer. It is replaced, never merged, when the real one
            lands — the response is the authority. */}
        {asking && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <SparklesIcon className="size-4" />
                {stream.text ? "Answering…" : "Choosing a metric…"}
              </CardTitle>
            </CardHeader>
            {stream.text && (
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{stream.text}</p>
              </CardContent>
            )}
          </Card>
        )}

        {!asking && outcome && !outcome.ok && (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            {outcome.message}
          </p>
        )}

        {!asking && answer && <Answer answer={answer} />}

        {conversing && !asking && answer?.suggestions?.length ? (
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              Ask next
            </p>
            <SuggestionChips
              suggestions={answer.suggestions}
              onPick={onPick}
              disabled={!usable || asking}
            />
          </div>
        ) : null}
      </div>

      <div className="sticky bottom-0 z-10 mx-auto w-full max-w-3xl pb-1">
        <fetcher.Form
          ref={formRef}
          method="post"
          onSubmit={onSubmit}
          className="flex items-end gap-2 rounded-4xl border bg-card p-2 shadow-lg shadow-brand-900/5"
        >
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-background"
          >
            <SparklesIcon className="size-4" />
          </span>
          <textarea
            ref={inputRef}
            name="question"
            rows={1}
            disabled={!usable || asking}
            placeholder="Type your question here"
            onKeyDown={onKeyDown}
            aria-label="Your question"
            className="field-sizing-content max-h-40 min-w-0 flex-1 resize-none self-center bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!usable || asking}
            aria-label="Ask"
            className="size-9 shrink-0 rounded-full"
          >
            {asking ? <Loader2Icon className="animate-spin" /> : <SendHorizontalIcon />}
          </Button>
        </fetcher.Form>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Enter asks · Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}
