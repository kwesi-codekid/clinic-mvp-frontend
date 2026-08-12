/**
 * How lab work is shown, shared by the bench, the order page and the visit's
 * lab screen (T6.2).
 *
 * Every judgement on display here is the API's. `LabResultValue.flag` was
 * graded server-side against the range for this patient's sex and age, and
 * `referenceText` names the range it was judged against — this module only
 * decides how loud each verdict looks. Unlike vitals, `normal` is a real flag
 * a lab report states explicitly, so it renders as quiet text rather than
 * nothing.
 */

import { TriangleAlertIcon } from "lucide-react";

import { StatusPill } from "~/components/directory";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { cn } from "~/lib/utils";
import {
  isCriticalLabFlag,
  LabOrderStatuses,
  LabResultFlags,
  SpecimenTypes,
  type LabOrderStatus,
  type LabResultFlag,
  type SpecimenType,
} from "~/models/enums";
import type { LabResultValue } from "~/models/lab";

/* -------------------------------------------------------------------------
   Pills
   ------------------------------------------------------------------------- */

/** Where one item (or its whole order) stands, as a pill. */
export function LabStatusPill({ status }: { status: LabOrderStatus }) {
  const tone =
    status === "verified"
      ? "positive"
      : status === "rejected"
        ? "critical"
        : status === "resulted" || status === "collected"
          ? "warning"
          : "muted";

  return <StatusPill tone={tone}>{LabOrderStatuses.label(status)}</StatusPill>;
}

/** The tube on the row — `Blood (EDTA)`, `Urine`. Nothing for `none`. */
export function SpecimenBadge({ type }: { type: SpecimenType }) {
  if (type === "none") return null;
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
      {SpecimenTypes.label(type)}
    </span>
  );
}

/** Text colour for a graded value — critical red, abnormal amber, normal plain. */
export function resultFlagClass(flag: LabResultFlag): string | undefined {
  if (isCriticalLabFlag(flag)) return "font-semibold text-destructive";
  if (flag !== "normal") return "font-medium text-amber-700 dark:text-amber-400";
  return undefined;
}

/**
 * The verdict beside a value. `normal` reads as quiet text — it is a real
 * statement on a lab report, not an omission — and a critical flag carries an
 * icon because the ordering clinician is being paged about it right now.
 */
export function ResultFlag({ flag }: { flag: LabResultFlag }) {
  if (flag === "normal") {
    return <span className="text-xs text-muted-foreground">Normal</span>;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
        isCriticalLabFlag(flag)
          ? "border-destructive/40 bg-destructive/10 font-semibold text-destructive"
          : "border-amber-500/40 bg-amber-500/10 font-medium text-amber-700 dark:text-amber-400",
      )}
    >
      {isCriticalLabFlag(flag) && <TriangleAlertIcon className="size-3" aria-hidden />}
      {LabResultFlags.label(flag)}
    </span>
  );
}

/* -------------------------------------------------------------------------
   The report
   ------------------------------------------------------------------------- */

/**
 * One item's graded results, in report form.
 *
 * The reference column shows `referenceText` — the range the API actually
 * judged against — never a range re-derived from the catalogue, which may
 * have changed since this result was graded.
 */
export function ResultsTable({ results }: { results: readonly LabResultValue[] }) {
  if (results.length === 0) return null;

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-9 px-3 text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Analyte
          </TableHead>
          <TableHead className="h-9 px-3 text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Result
          </TableHead>
          <TableHead className="h-9 px-3 text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Flag
          </TableHead>
          <TableHead className="h-9 px-3 text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Reference
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {results.map((result) => (
          <TableRow key={result.analyteCode} className="hover:bg-transparent">
            <TableCell className="px-3 py-2 text-sm">{result.analyteName}</TableCell>
            <TableCell
              className={cn("px-3 py-2 text-sm tabular-nums", resultFlagClass(result.flag))}
            >
              {result.value}
              {result.unit ? ` ${result.unit}` : ""}
            </TableCell>
            <TableCell className="px-3 py-2">
              <ResultFlag flag={result.flag} />
            </TableCell>
            <TableCell className="px-3 py-2 text-xs text-muted-foreground">
              {result.referenceText ?? "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
