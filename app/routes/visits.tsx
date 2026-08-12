/**
 * Visits — the clinic day (T3.2).
 *
 * The same directory screen as Staff and Patients wearing attendance columns:
 * counters across the top, tabs and filters driving `GET /visits` through URL
 * search params, a table, a pager. Every view is therefore shareable and
 * SSR-rendered, and the back button works.
 *
 * There is no search box because the endpoint has none — a visit is found by
 * *when* and *what*, not by typing a name, and the patient search already
 * exists one screen over. What replaces it is the filter that matters at a
 * front desk: which day, and which kind of attendance.
 *
 * The day itself is the API's to define: `today=true` resolves the clinic day
 * server-side rather than trusting a browser's timezone, so the default view
 * is right even on a tablet whose clock is wrong.
 *
 * This route has **no action**. Checking in and the visit lifecycle are pages
 * of their own — each one a link a clerk can be sent.
 */

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DoorOpenIcon,
  DownloadIcon,
  IdCardIcon,
  LogInIcon,
  MoreHorizontalIcon,
  ShieldCheckIcon,
  StethoscopeIcon,
  UserRoundCheckIcon,
} from "lucide-react";
import { Link, useNavigation, useSearchParams } from "react-router";
import { toast } from "sonner";

import {
  avatarTint,
  downloadCsv,
  initialsOf,
  PagerLink,
  StatCard,
  StatusPill,
} from "~/components/directory";
import { PriorityPill, VisitStatusPill } from "~/components/visit-header";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { throwRouteError } from "~/lib/api/route-error";
import { listVisits, type VisitListQuery } from "~/lib/api/visits";
import { requireStaff } from "~/lib/auth.server";
import { cn } from "~/lib/utils";
import { Priorities, Stations, VisitTypes, type VisitStatus } from "~/models/enums";
import { formatMinutes, visitElapsedMinutes, type VisitSummary } from "~/models/visit";
import type { Route } from "./+types/visits";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Visits · Clinic" }];
}

/* -------------------------------------------------------------------------
   Tabs, scope and loader
   ------------------------------------------------------------------------- */

const PAGE_SIZE = 10;

/** The status slices the tabs map onto. `status: undefined` = every visit. */
const VISIT_TABS = [
  { value: "all", label: "All visits", status: undefined },
  { value: "open", label: "In clinic", status: "open" },
  { value: "closed", label: "Closed", status: "closed" },
  { value: "cancelled", label: "Cancelled", status: "cancelled" },
] as const satisfies ReadonlyArray<{
  value: string;
  label: string;
  status: VisitStatus | undefined;
}>;

type VisitTab = (typeof VISIT_TABS)[number]["value"];

function parseTab(value: string | null): VisitTab {
  return VISIT_TABS.find((tab) => tab.value === value)?.value ?? "all";
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The `date` search param as a query fragment.
 *
 * Absent means today — expressed as `today=true` rather than a computed date
 * so the clinic's own day boundary rules, not the browser's.
 */
function parseScope(value: string | null): Pick<VisitListQuery, "today" | "from" | "to"> {
  if (value === "all") return {};
  if (value && DATE_PATTERN.test(value)) return { from: value, to: value };
  return { today: true };
}

export async function loader({ request }: Route.LoaderArgs) {
  const { accessToken } = await requireStaff(request);
  const url = new URL(request.url);

  const tab = parseTab(url.searchParams.get("tab"));
  const dateParam = url.searchParams.get("date");
  const typeParam = url.searchParams.get("type");
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page")) || 1));

  const scope = parseScope(dateParam);
  const type = VisitTypes.is(typeParam) ? typeParam : undefined;
  const status = VISIT_TABS.find((entry) => entry.value === tab)?.status;

  const opts = { token: accessToken };
  // `meta.total` off a one-row page is the cheapest count the API offers.
  const countWhere = (query: VisitListQuery) =>
    listVisits({ ...query, limit: 1 }, opts).then((result) => result.meta.total);

  try {
    const [visitPage, openNow, all, open, closed, cancelled, nhis] = await Promise.all([
      // Most recent arrival first: the front desk reads the day downwards.
      listVisits({ ...scope, status, type, page, limit: PAGE_SIZE, sort: "-arrivedAt" }, opts),
      // Deliberately unscoped — a patient who arrived yesterday and is still
      // here is exactly who a triage desk must not lose sight of.
      countWhere({ status: "open" }),
      countWhere({ ...scope, type }),
      countWhere({ ...scope, type, status: "open" }),
      countWhere({ ...scope, type, status: "closed" }),
      countWhere({ ...scope, type, status: "cancelled" }),
      countWhere({ ...scope, type, payerType: "nhis" }),
    ]);

    return {
      visitPage,
      tab,
      date: dateParam === "all" || (dateParam && DATE_PATTERN.test(dateParam)) ? dateParam : "",
      type: type ?? "",
      counts: { all, open, closed, cancelled, openNow, nhis },
    };
  } catch (error) {
    throwRouteError(error);
  }
}

/* -------------------------------------------------------------------------
   Presentational pieces
   ------------------------------------------------------------------------- */

const TYPE_ITEMS = [{ value: "", label: "All visit types" }, ...VisitTypes.options()];

/** Cover the till can rely on, cover that has lapsed, or plain cash. */
function PayerCell({ visit }: { visit: VisitSummary }) {
  const { payer } = visit;

  return (
    <div className="space-y-1">
      <div className="font-medium">{payer.label}</div>
      {payer.payerType === "cash" ? (
        <span className="text-xs text-muted-foreground">Settles at the till</span>
      ) : payer.valid ? (
        <StatusPill tone="positive">Cover valid</StatusPill>
      ) : (
        <StatusPill tone="warning">Cover lapsed</StatusPill>
      )}
    </div>
  );
}

function exportCsv(items: VisitSummary[], now: number) {
  downloadCsv(
    [
      [
        "Visit number",
        "Patient",
        "Folder number",
        "Type",
        "Priority",
        "Status",
        "Station",
        "Payer",
        "Arrived",
        "Elapsed",
      ],
      ...items.map((visit) => [
        visit.visitNumber,
        visit.patient.fullName,
        visit.patient.folderNumber,
        VisitTypes.label(visit.type),
        Priorities.label(visit.priority),
        visit.status,
        visit.currentStation ? Stations.label(visit.currentStation) : "",
        visit.payer.label,
        visit.arrivedAt,
        formatMinutes(visitElapsedMinutes(visit, now)),
      ]),
    ],
    "visits.csv",
  );

  toast.success(`Exported ${items.length} visits to CSV`, {
    description: "The rows currently in view.",
  });
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

export default function VisitsPage({ loaderData }: Route.ComponentProps) {
  const { visitPage, tab, date, type, counts } = loaderData;
  const { items, meta } = visitPage;

  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const refreshing = navigation.state === "loading";

  // Row selection is page-local UI state; a navigation resets it.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => setSelected(new Set()), [loaderData]);

  // One timestamp for the whole table, so no two rows disagree about "now".
  const now = Date.now();
  const allDates = date === "all";

  function update(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    // Any change of filter invalidates the page number.
    params.delete("page");
    setSearchParams(params, { preventScrollReset: true });
  }

  function pageHref(page: number): string {
    const params = new URLSearchParams(searchParams);
    if (page <= 1) params.delete("page");
    else params.set("page", String(page));
    return `?${params.toString()}`;
  }

  const allSelected = items.length > 0 && items.every((visit) => selected.has(visit.id));
  const someSelected = items.some((visit) => selected.has(visit.id));

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(items.map((visit) => visit.id)) : new Set());
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);

  const scopeLabel = allDates
    ? "every visit on record"
    : date
      ? format(new Date(`${date}T00:00:00`), "d MMMM yyyy")
      : "today";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Visits</h1>
          <p className="text-sm text-muted-foreground">
            Attendance for {scopeLabel} — who is in the clinic, where they are, and who is
            paying.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => exportCsv(items, now)}>
            <DownloadIcon />
            Export data
          </Button>
          <Link to="/visits/new" className={buttonVariants()}>
            <LogInIcon />
            Check in patient
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="In the clinic now" value={counts.openNow} icon={UserRoundCheckIcon}>
          <Link
            to="?tab=open&date=all"
            preventScrollReset
            className="font-medium text-primary hover:underline"
          >
            Open visits, any day
          </Link>
        </StatCard>
        <StatCard label="Attendances" value={counts.all} icon={StethoscopeIcon}>
          {allDates ? "All time" : date ? "On this date" : "Today"}
        </StatCard>
        <StatCard label="Closed" value={counts.closed} icon={DoorOpenIcon}>
          {counts.cancelled > 0
            ? `${counts.cancelled} cancelled before being seen`
            : "None left before being seen"}
        </StatCard>
        <StatCard label="NHIS attendances" value={counts.nhis} icon={ShieldCheckIcon}>
          {counts.all > 0
            ? `${Math.round((counts.nhis / counts.all) * 100)}% of this view`
            : "Nothing in this view"}
        </StatCard>
      </div>

      {/* Directory */}
      <Card className={cn("gap-0 py-0 transition-opacity", refreshing && "opacity-60")}>
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={tab} onValueChange={(value) => update({ tab: value as VisitTab })}>
            <TabsList className="h-auto flex-wrap">
              {VISIT_TABS.map((entry) => (
                <TabsTrigger key={entry.value} value={entry.value} className="gap-1.5 px-2.5">
                  {entry.label}
                  <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                    {counts[entry.value]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              items={TYPE_ITEMS}
              value={type}
              onValueChange={(value) => update({ type: String(value) })}
            >
              <SelectTrigger className="w-44" aria-label="Filter by visit type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              type="date"
              // Empty means the clinic day, which only the API can name.
              value={allDates ? "" : date}
              disabled={allDates}
              onChange={(event) => update({ date: event.currentTarget.value })}
              aria-label="Arrival date"
              className="w-40"
            />

            <Button
              variant={allDates ? "secondary" : "outline"}
              onClick={() => update({ date: allDates ? null : "all" })}
              aria-pressed={allDates}
            >
              All dates
            </Button>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-11 w-12 px-4">
                <Checkbox
                  checked={allSelected}
                  indeterminate={!allSelected && someSelected}
                  onCheckedChange={(checked) => toggleAll(checked === true)}
                  aria-label="Select all visits on this page"
                />
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Patient
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Visit
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Status
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Station
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Payer at check-in
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Arrived
              </TableHead>
              <TableHead className="h-11 w-14 px-4 text-right text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {items.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                  No visit matches this view.
                </TableCell>
              </TableRow>
            )}

            {items.map((visit) => (
              <TableRow
                key={visit.id}
                data-state={selected.has(visit.id) ? "selected" : undefined}
              >
                <TableCell className="w-12 px-4 py-3">
                  <Checkbox
                    checked={selected.has(visit.id)}
                    onCheckedChange={(checked) => toggleOne(visit.id, checked === true)}
                    aria-label={`Select visit ${visit.visitNumber}`}
                  />
                </TableCell>

                <TableCell className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarFallback
                        className={cn(
                          "text-xs font-semibold uppercase",
                          avatarTint(visit.patient.id),
                        )}
                      >
                        {initialsOf(visit.patient.firstName, visit.patient.surname)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <Link
                        to={`/visits/${visit.id}`}
                        className="truncate font-medium hover:underline"
                      >
                        {visit.patient.fullName}
                      </Link>
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {visit.patient.folderNumber}
                      </div>
                    </div>
                  </div>
                </TableCell>

                <TableCell className="px-4 py-3">
                  <div className="font-mono text-xs">{visit.visitNumber}</div>
                  <div className="text-xs text-muted-foreground">
                    {VisitTypes.label(visit.type)}
                  </div>
                </TableCell>

                <TableCell className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <VisitStatusPill status={visit.status} />
                    <PriorityPill priority={visit.priority} />
                  </div>
                </TableCell>

                <TableCell className="px-4 py-3">
                  {visit.currentStation ? (
                    Stations.label(visit.currentStation)
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>

                <TableCell className="px-4 py-3">
                  <PayerCell visit={visit} />
                </TableCell>

                <TableCell className="px-4 py-3" suppressHydrationWarning>
                  <div className="tabular-nums">{format(new Date(visit.arrivedAt), "HH:mm")}</div>
                  <div className="text-xs text-muted-foreground">
                    {visit.status === "open"
                      ? `${formatMinutes(visitElapsedMinutes(visit, now))} in clinic`
                      : format(new Date(visit.arrivedAt), "d MMM yyyy")}
                  </div>
                </TableCell>

                <TableCell className="w-14 px-4 py-3 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for visit ${visit.visitNumber}`}
                        />
                      }
                    >
                      <MoreHorizontalIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem render={<Link to={`/visits/${visit.id}`} />}>
                        <StethoscopeIcon />
                        Open visit
                      </DropdownMenuItem>
                      <DropdownMenuItem render={<Link to={`/patients/${visit.patient.id}`} />}>
                        <IdCardIcon />
                        Open folder
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-sm text-muted-foreground">
          <span>
            {selected.size > 0
              ? `${selected.size} of ${items.length} selected`
              : `Showing ${from}–${to} of ${meta.total} visits`}
          </span>
          <div className="flex items-center gap-3">
            <span className="tabular-nums">
              Page {meta.page} of {Math.max(meta.totalPages, 1)}
            </span>
            <div className="flex items-center gap-1.5">
              <PagerLink
                to={pageHref(meta.page - 1)}
                disabled={meta.page <= 1}
                label="Previous page"
              >
                <ChevronLeftIcon />
              </PagerLink>
              <PagerLink
                to={pageHref(meta.page + 1)}
                disabled={meta.page >= meta.totalPages}
                label="Next page"
              >
                <ChevronRightIcon />
              </PagerLink>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
