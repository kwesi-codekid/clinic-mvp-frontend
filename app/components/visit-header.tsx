/**
 * The visit header — the strip every station screen opens with (T3.2).
 *
 * Vitals, consultation, lab, pharmacy and the till all need the same five
 * facts before anything else on their screen makes sense: who this is, what
 * kind of attendance it is, how urgent, where they are now, and who is paying.
 * Mounting one component means a nurse and a cashier are reading the same
 * header in the same place, and a change to it lands everywhere at once.
 *
 * The payer shown here is {@link PayerSnapshot} — the cover **as at
 * check-in**, not the folder's current profile. Rendering the live one would
 * quietly misprice a visit whose scheme lapsed mid-attendance, which is the
 * exact failure the snapshot exists to prevent.
 *
 * The status pills are exported on their own because the worklists in Phase 4
 * need the same vocabulary in a table cell.
 */

import type { ReactNode } from "react";
import { format } from "date-fns";
import { BanknoteIcon, ClockIcon, MapPinIcon, TriangleAlertIcon } from "lucide-react";
import { Link } from "react-router";

import { avatarTint, initialsOf, StatusPill } from "~/components/directory";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Card, CardContent } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import {
  Priorities,
  Sexes,
  Stations,
  VisitStatuses,
  VisitTypes,
  type Priority,
  type VisitStatus,
} from "~/models/enums";
import {
  formatMinutes,
  hasLapsedCover,
  visitElapsedMinutes,
  type Visit,
  type VisitSummary,
} from "~/models/visit";

/* -------------------------------------------------------------------------
   Pills
   ------------------------------------------------------------------------- */

/** Open, closed or cancelled. A cancelled visit is not a failed closure. */
export function VisitStatusPill({ status }: { status: VisitStatus }) {
  return (
    <StatusPill
      tone={status === "open" ? "positive" : status === "cancelled" ? "warning" : "muted"}
    >
      {VisitStatuses.label(status)}
    </StatusPill>
  );
}

/**
 * Urgency. Routine is the default and renders nothing — a triage desk needs
 * the exceptions to stand out, and a pill on every row is a pill on none.
 */
export function PriorityPill({ priority }: { priority: Priority }) {
  if (priority === "routine") return null;

  return (
    <StatusPill tone={priority === "emergency" ? "critical" : "warning"}>
      {Priorities.label(priority)}
    </StatusPill>
  );
}

/* -------------------------------------------------------------------------
   Facts
   ------------------------------------------------------------------------- */

function Fact({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-1.5 text-sm">
        {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="truncate">{children}</span>
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------
   The header
   ------------------------------------------------------------------------- */

export function VisitHeader({
  visit,
  now = Date.now(),
  children,
}: {
  visit: VisitSummary & Pick<Partial<Visit>, "totalMinutes">;
  /**
   * Timestamp the elapsed clock is measured against. Pass one shared value
   * when a screen renders several of these, so they cannot disagree.
   */
  now?: number;
  /** Actions, aligned to the right of the identity block. */
  children?: ReactNode;
}) {
  const { patient, payer } = visit;
  const elapsed = formatMinutes(visitElapsedMinutes(visit, now));
  const lapsed = hasLapsedCover(visit);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardContent className="flex flex-wrap items-center gap-4 p-4">
        <Avatar className="size-12">
          <AvatarFallback className={cn("font-semibold uppercase", avatarTint(patient.id))}>
            {initialsOf(patient.firstName, patient.surname)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/patients/${patient.id}`}
              className="font-heading text-lg font-semibold tracking-tight hover:underline"
            >
              {patient.fullName}
            </Link>
            {visit.isNewPatient && <StatusPill tone="muted">New patient</StatusPill>}
            <PriorityPill priority={visit.priority} />
            <VisitStatusPill status={visit.status} />
          </div>
          <div className="text-sm text-muted-foreground">
            <span className="font-mono">{patient.folderNumber}</span> · {patient.age.display} ·{" "}
            {Sexes.label(patient.sex)} · {VisitTypes.label(visit.type)}
          </div>
        </div>

        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </CardContent>

      <dl className="grid gap-x-6 gap-y-3 border-t bg-muted/40 p-4 sm:grid-cols-2 lg:grid-cols-4 dark:bg-muted/20">
        <Fact label="Visit number">
          <span className="font-mono">{visit.visitNumber}</span>
        </Fact>

        <Fact label="Arrived" icon={ClockIcon}>
          <span suppressHydrationWarning>
            {format(new Date(visit.arrivedAt), "d MMM, HH:mm")} · {elapsed}
          </span>
        </Fact>

        <Fact label={visit.status === "open" ? "Current station" : "Last station"} icon={MapPinIcon}>
          {visit.currentStation ? (
            Stations.label(visit.currentStation)
          ) : (
            <span className="text-muted-foreground">
              {visit.status === "open" ? "Not queued" : "—"}
            </span>
          )}
        </Fact>

        {/* Frozen at check-in. Never the folder's current PayerProfile. */}
        <Fact label="Payer at check-in" icon={BanknoteIcon}>
          {payer.label}
          {payer.copayPercent > 0 && payer.payerType !== "cash" && (
            <span className="text-muted-foreground"> · {payer.copayPercent}% co-pay</span>
          )}
        </Fact>
      </dl>

      {lapsed && (
        <div
          role="note"
          className="flex items-start gap-2 border-t border-amber-500/40 bg-amber-500/5 p-3 text-sm"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p>
            <span className="font-medium">Cover was not valid at check-in.</span>{" "}
            <span className="text-muted-foreground">
              This visit bills as {payer.label} but the scheme is likely to refuse it — settle at
              the till rather than raising a claim.
            </span>
          </p>
        </div>
      )}
    </Card>
  );
}
