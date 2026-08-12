/**
 * The generic metric renderer (T13.3) — one component for every metric the
 * backend has or will ever publish.
 *
 * The API returns each result as `{columns, rows}` with a type per column, so
 * the only thing the UI has to know is **how to render a type**, not what a
 * metric means. There are five cell renderers below and no metric-specific
 * code anywhere; a metric added on the backend appears in the picker and
 * renders correctly with no frontend change. Resisting the pull to special-case
 * one metric ("just this once, revenue needs a different table") is what keeps
 * that true.
 *
 * Two rules the renderers exist to enforce:
 *
 * - **`money` is integer pesewas.** It goes through `~/lib/money`, never
 *   `toLocaleString`, and never near a floating-point division.
 * - **Missing is not zero.** A null cell renders as an em dash. A blank a
 *   reader can see is honest; a `0` they cannot distinguish from a measurement
 *   is not.
 *
 * `headline` is rendered above the table because the API computes it from the
 * rows rather than generating it. It is the sentence someone came for, and it
 * cannot contradict the figures underneath it.
 */

import { format } from "date-fns";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { formatPesewas } from "~/lib/money";
import { cn } from "~/lib/utils";
import type { MetricColumn, MetricResult, MetricRow } from "~/models/analytics";
import type { MetricColumnType } from "~/models/enums";

/** What a cell shows when the API sent nothing for it. */
const BLANK = "—";

/* -------------------------------------------------------------------------
   Cell renderers — one per column type, and no more
   ------------------------------------------------------------------------- */

function renderNumber(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return BLANK;
  return numeric.toLocaleString("en-GH", { maximumFractionDigits: 2 });
}

function renderMoney(value: unknown): string {
  const pesewas = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(pesewas)) return BLANK;

  // A non-integer here means the backend sent cedis where the convention is
  // pesewas. `formatPesewas` throws on that rather than silently rendering a
  // hundredfold error onto a bill, so round to the nearest pesewa first and
  // let the value be visibly odd instead of the screen being blank.
  return formatPesewas(Math.round(pesewas));
}

function renderPercent(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return BLANK;
  // The API sends whole percents (`bedOccupancyPercent: 72.5`), not fractions.
  return `${numeric.toLocaleString("en-GH", { maximumFractionDigits: 1 })}%`;
}

function renderDate(value: unknown): string {
  if (typeof value !== "string" || value === "") return BLANK;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  // `YYYY-MM` is a reporting period, not a day — the DHIMS2 return and the
  // monthly metrics both use it, and rendering it as the 1st would invent a
  // precision the data does not have.
  if (/^\d{4}-\d{2}$/.test(value)) return format(parsed, "MMM yyyy");
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return format(parsed, "d MMM yyyy");
  return format(parsed, "d MMM yyyy, HH:mm");
}

function renderString(value: unknown): string {
  if (value === null || value === undefined || value === "") return BLANK;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // An object in a `string` column is a backend surprise, not something to
  // crash a dashboard over.
  return JSON.stringify(value);
}

const CELL_RENDERERS: Record<MetricColumnType, (value: unknown) => string> = {
  string: renderString,
  number: renderNumber,
  money: renderMoney,
  date: renderDate,
  percent: renderPercent,
};

/** Quantities line up on the right so magnitudes can be compared by eye. */
const NUMERIC_TYPES: ReadonlySet<MetricColumnType> = new Set(["number", "money", "percent"]);

export function renderMetricCell(column: MetricColumn, row: MetricRow): string {
  const value = row[column.key];
  if (value === null || value === undefined) return BLANK;
  return (CELL_RENDERERS[column.type] ?? renderString)(value);
}

/* -------------------------------------------------------------------------
   The table
   ------------------------------------------------------------------------- */

export function MetricTable({ result }: { result: MetricResult }) {
  if (result.rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        This metric returned no rows for the period it ran on.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {result.columns.map((column) => (
              <TableHead
                key={column.key}
                className={cn(NUMERIC_TYPES.has(column.type) && "text-right")}
              >
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.map((row, index) => (
            // Rows are an ordered aggregation with no identifier of their own,
            // and nothing here reorders or edits them, so the index is stable.
            <TableRow key={index}>
              {result.columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn(
                    NUMERIC_TYPES.has(column.type) && "text-right tabular-nums",
                  )}
                >
                  {renderMetricCell(column, row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* -------------------------------------------------------------------------
   Headline + table
   ------------------------------------------------------------------------- */

/**
 * A whole metric result: the computed headline, then the table.
 *
 * @param hideHeadline for callers that render the headline themselves — the
 * assistant puts it beside its own prose so the two can be told apart.
 */
export function MetricResultView({
  result,
  hideHeadline = false,
}: {
  result: MetricResult;
  hideHeadline?: boolean;
}) {
  return (
    <div className="space-y-4">
      {!hideHeadline && result.headline && (
        <p className="font-heading text-lg font-semibold tracking-tight text-balance">
          {result.headline}
        </p>
      )}
      <MetricTable result={result} />
    </div>
  );
}
