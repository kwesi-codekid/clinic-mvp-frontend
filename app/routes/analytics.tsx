/**
 * Analytics (T13.3) — `/analytics`.
 *
 * Two things on one screen, in the order someone actually wants them: the
 * headline numbers, then the catalogue of everything else the system can be
 * asked.
 *
 * **The dashboard** is `GET /analytics/dashboard`, composed by the API from
 * the same metrics the catalogue below exposes — so a tile and the metric
 * behind it cannot disagree. Tiles whose module the clinic does not run
 * (`bedOccupancyPercent` without a ward) are absent from the response and are
 * simply not rendered. Rendering them as `0%` would read as a measurement.
 *
 * **The catalogue** is the picker. There is no query builder here and there
 * will not be one: the API has no query endpoint, only named metrics
 * (`~/models/analytics` explains why that is the good design). Selecting one
 * puts its name in the URL and the loader runs it, so a result is shareable,
 * server-rendered and survives the back button.
 *
 * Metrics run on their **default parameters**. The catalogue publishes each
 * metric's name, description and example questions but not a schema for its
 * params, so there is nothing to build a parameter form out of — and nothing
 * that needs one, because varying the period is exactly what the assistant is
 * for (T13.4). "Revenue by service, last quarter" is a sentence, not a form.
 */

import { ChartColumnIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { MetricResultView } from "~/components/metric-result";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { getDashboard, listMetrics, runMetric } from "~/lib/api/analytics";
import { ApiError } from "~/lib/api/client";
import { throwRouteError } from "~/lib/api/route-error";
import { requireStaff } from "~/lib/auth.server";
import { cn } from "~/lib/utils";
import { groupMetricsByCategory, type Dashboard, type MetricSummary } from "~/models/analytics";
import type { Route } from "./+types/analytics";

export function meta() {
  return [{ title: "Analytics · Clinic" }];
}

/* -------------------------------------------------------------------------
   Loader
   ------------------------------------------------------------------------- */

export async function loader({ request }: Route.LoaderArgs) {
  const { accessToken } = await requireStaff(request);
  const options = { token: accessToken };

  const selected = new URL(request.url).searchParams.get("metric")?.trim() || null;

  try {
    const [dashboard, metrics] = await Promise.all([
      getDashboard(options),
      listMetrics(options),
    ]);

    if (!selected) return { dashboard, metrics, selected, result: null, runError: null };

    // A metric that fails must not take the dashboard down with it: the name
    // came out of a URL someone may have edited, and a 400 from one metric
    // says nothing about the other twenty. Report it in place instead.
    try {
      const result = await runMetric(selected, {}, options);
      return { dashboard, metrics, selected, result, runError: null };
    } catch (error) {
      if (!ApiError.is(error)) throw error;
      return { dashboard, metrics, selected, result: null, runError: error.message };
    }
  } catch (error) {
    throwRouteError(error);
  }
}

/* -------------------------------------------------------------------------
   Dashboard tiles
   ------------------------------------------------------------------------- */

function Tile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "warning" | "destructive";
}) {
  return (
    <Card size="sm" className="gap-2">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={cn(
            "font-heading text-3xl font-semibold tracking-tight tabular-nums",
            tone === "warning" && "text-amber-600 dark:text-amber-400",
            tone === "destructive" && "text-destructive",
          )}
        >
          {value}
        </CardTitle>
      </CardHeader>
      {note && <CardContent className="text-xs text-muted-foreground">{note}</CardContent>}
    </Card>
  );
}

function DashboardTiles({ dashboard }: { dashboard: Dashboard }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        label="Attendances today"
        value={dashboard.today.attendances.toLocaleString("en-GH")}
        note={`${dashboard.month.attendances.toLocaleString("en-GH")} so far this month.`}
      />
      <Tile
        label="Taken today"
        value={dashboard.today.revenueFormatted}
        note={`${dashboard.month.revenueFormatted} so far this month.`}
      />
      <Tile
        label="Outstanding"
        value={dashboard.outstandingFormatted}
        tone={dashboard.outstandingPesewas > 0 ? "warning" : undefined}
        note="Billed and not yet paid."
      />
      <Tile
        label="NHIS shortfall"
        value={dashboard.nhisShortfallFormatted}
        tone={dashboard.nhisShortfallPesewas > 0 ? "warning" : undefined}
        note="Tariff less than the price charged — the clinic absorbs this."
      />

      {dashboard.topDiagnosis && (
        <Card size="sm" className="gap-2">
          <CardHeader>
            <CardDescription>Top diagnosis</CardDescription>
            <CardTitle className="font-heading text-xl font-semibold tracking-tight text-balance">
              {dashboard.topDiagnosis}
            </CardTitle>
          </CardHeader>
        </Card>
      )}

      {dashboard.bedOccupancyPercent !== undefined && (
        <Tile
          label="Bed occupancy"
          value={`${dashboard.bedOccupancyPercent.toLocaleString("en-GH", {
            maximumFractionDigits: 1,
          })}%`}
          note="Across every ward."
        />
      )}

      <Tile
        label="Low stock"
        value={dashboard.lowStockCount.toLocaleString("en-GH")}
        tone={dashboard.lowStockCount > 0 ? "warning" : undefined}
        note={dashboard.lowStockCount > 0 ? "Lines at or below reorder level." : "Nothing to reorder."}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------
   The catalogue
   ------------------------------------------------------------------------- */

function MetricCard({ metric, selected }: { metric: MetricSummary; selected: boolean }) {
  return (
    <Link
      to={selected ? "/analytics" : `/analytics?metric=${encodeURIComponent(metric.name)}`}
      preventScrollReset
      aria-current={selected ? "true" : undefined}
      className={cn(
        "block rounded-lg border p-4 text-left transition-colors",
        selected ? "border-primary bg-primary/5" : "hover:bg-accent",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-medium">{metric.title}</span>
        <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
          {metric.visualization}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{metric.description}</p>
      {metric.examples.length > 0 && (
        // The example phrasings are what the assistant matches a question
        // against, so showing one here teaches the ask box by the way.
        <p className="mt-2 text-xs text-muted-foreground italic">“{metric.examples[0]}”</p>
      )}
    </Link>
  );
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

export default function AnalyticsPage({ loaderData }: Route.ComponentProps) {
  const { dashboard, metrics, selected, result, runError } = loaderData;
  const [searchParams] = useSearchParams();
  const groups = groupMetricsByCategory(metrics);

  // Keeps the result in view when a metric is picked from far down the list.
  const resultKey = searchParams.get("metric") ?? "none";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            The clinic today and this month, and every question the system can answer with real
            numbers.
          </p>
        </div>
        <Link to="/analytics/assistant" className={buttonVariants({ variant: "outline" })}>
          <SparklesIcon />
          Ask a question
        </Link>
      </div>

      <DashboardTiles dashboard={dashboard} />

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold tracking-tight">Metrics</h2>
          <p className="text-sm text-muted-foreground">
            {metrics.length} metric{metrics.length === 1 ? "" : "s"}. Each runs on its default
            period — to vary it, ask in words.
          </p>
        </div>

        {selected && (
          <Card key={resultKey}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ChartColumnIcon className="size-4" />
                {result?.metric.title ?? selected}
              </CardTitle>
              {result && (
                <CardDescription>
                  Ran <span className="font-mono text-xs">{result.metric.name}</span>
                  {Object.keys(result.params).length > 0 && (
                    <> with {JSON.stringify(result.params)}</>
                  )}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {runError ? (
                <p className="flex items-start gap-2 text-sm text-destructive">
                  <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                  {runError}
                </p>
              ) : result ? (
                <MetricResultView result={result} />
              ) : null}
            </CardContent>
          </Card>
        )}

        {groups.map((group) => (
          <div key={group.category} className="space-y-3">
            <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              {group.category}
            </h3>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {group.metrics.map((metric) => (
                <MetricCard
                  key={metric.name}
                  metric={metric}
                  selected={metric.name === selected}
                />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
