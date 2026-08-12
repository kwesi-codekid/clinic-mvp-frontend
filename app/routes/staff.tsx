/**
 * Doctors / Staff — the clinic team directory (the read half of T14.1).
 *
 * A build of the approved staff-list design on top of the real API: stat
 * cards, role tabs, search and paging all drive `GET /staff` through URL
 * search params, so every view is shareable and SSR-rendered. The design's
 * real-time columns (duty status, surgery workload) have no backend in the
 * spec; those slots carry what the API does know — station, contact details,
 * account and licence status, and last sign-in.
 *
 * Tab and stat counts come from `limit: 1` list calls read for `meta.total`
 * — the cheapest count the API offers. They run in parallel with the page
 * itself.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  HeartPulseIcon,
  PlusIcon,
  SearchIcon,
  StethoscopeIcon,
  UsersRoundIcon,
  UserXIcon,
} from "lucide-react";
import { Link, useNavigation, useSearchParams } from "react-router";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Button, buttonVariants } from "~/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
} from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
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
import { listStaff, type StaffListQuery } from "~/lib/api/staff";
import { requireStaff } from "~/lib/auth.server";
import { cn } from "~/lib/utils";
import { Roles, Stations, type Role } from "~/models/enums";
import type { Staff } from "~/models/staff";
import type { Route } from "./+types/staff";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Staff · Clinic" }];
}

/* -------------------------------------------------------------------------
   Tabs and loader
   ------------------------------------------------------------------------- */

const PAGE_SIZE = 10;

/** The role slices the design's tabs map onto. `role: undefined` = everyone. */
const STAFF_TABS = [
  { value: "all", label: "All staff", role: undefined },
  { value: "doctor", label: "Doctors", role: "doctor" },
  { value: "nurse", label: "Nurses", role: "nurse" },
  { value: "pharmacy", label: "Pharmacy", role: "pharmacy" },
  { value: "lab", label: "Laboratory", role: "lab" },
] as const satisfies ReadonlyArray<{ value: string; label: string; role: Role | undefined }>;

type StaffTab = (typeof STAFF_TABS)[number]["value"];

function parseTab(value: string | null): StaffTab {
  return STAFF_TABS.find((tab) => tab.value === value)?.value ?? "all";
}

export async function loader({ request }: Route.LoaderArgs) {
  const { accessToken } = await requireStaff(request);
  const url = new URL(request.url);

  const q = url.searchParams.get("q")?.trim() || undefined;
  const tab = parseTab(url.searchParams.get("tab"));
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page")) || 1));
  const role = STAFF_TABS.find((entry) => entry.value === tab)?.role;

  const opts = { token: accessToken };
  const countWhere = (query: StaffListQuery) =>
    listStaff({ ...query, limit: 1 }, opts).then((result) => result.meta.total);

  try {
    const [staffPage, all, active, doctor, nurse, pharmacy, lab] = await Promise.all([
      listStaff({ q, role, page, limit: PAGE_SIZE, sort: "surname" }, opts),
      countWhere({}),
      countWhere({ active: true }),
      countWhere({ role: "doctor" }),
      countWhere({ role: "nurse" }),
      countWhere({ role: "pharmacy" }),
      countWhere({ role: "lab" }),
    ]);

    return {
      staffPage,
      tab,
      q: q ?? "",
      counts: { all, active, doctor, nurse, pharmacy, lab },
    };
  } catch (error) {
    throwRouteError(error);
  }
}

/* -------------------------------------------------------------------------
   Presentational pieces
   ------------------------------------------------------------------------- */

function staffInitials(staff: Staff): string {
  return (staff.firstName[0] ?? "") + (staff.surname[0] ?? "");
}

/** Deterministic tint per person, standing in for the photos the API lacks. */
const AVATAR_TINTS = [
  "bg-primary/10 text-primary",
  "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
];

function avatarTint(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}

function StatCard({
  label,
  value,
  icon: Icon,
  children,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children: ReactNode;
}) {
  return (
    <Card size="sm" className="gap-2">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction>
          <span className="flex size-8 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
            <Icon className="size-4" strokeWidth={1.75} />
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-0.5">
        <div className="font-heading text-3xl font-semibold tracking-tight tabular-nums">
          {value}
        </div>
        <div className="text-xs text-muted-foreground">{children}</div>
      </CardContent>
    </Card>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: "positive" | "warning" | "muted";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        tone === "positive" &&
          "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
        tone === "warning" &&
          "bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          tone === "positive" && "bg-emerald-500",
          tone === "warning" && "bg-amber-500",
          tone === "muted" && "bg-muted-foreground/50",
        )}
      />
      {children}
    </span>
  );
}

function PagerLink({
  to,
  disabled,
  label,
  children,
}: {
  to: string;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  if (disabled) {
    return (
      <Button variant="outline" size="icon-sm" disabled aria-label={label}>
        {children}
      </Button>
    );
  }
  return (
    <Link
      to={to}
      preventScrollReset
      aria-label={label}
      className={buttonVariants({ variant: "outline", size: "icon-sm" })}
    >
      {children}
    </Link>
  );
}

/* -------------------------------------------------------------------------
   CSV export — the rows currently in view, entirely client-side
   ------------------------------------------------------------------------- */

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function exportCsv(items: Staff[]) {
  const rows = [
    ["Staff number", "Name", "Roles", "Station", "Email", "Phone", "Status", "Last sign-in"],
    ...items.map((staff) => [
      staff.staffNumber,
      staff.fullName,
      staff.roles.map((role) => Roles.label(role)).join("; "),
      staff.station ? Stations.label(staff.station) : "",
      staff.email,
      staff.phone ?? "",
      staff.active ? "Active" : "Inactive",
      staff.lastLoginAt ?? "Never",
    ]),
  ];
  const csv = rows.map((row) => row.map(csvField).join(",")).join("\r\n");

  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "staff.csv";
  anchor.click();
  URL.revokeObjectURL(url);

  toast.success(`Exported ${items.length} staff to CSV`, {
    description: "The rows currently in view.",
  });
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

export default function StaffPage({ loaderData }: Route.ComponentProps) {
  const { staffPage, tab, q, counts } = loaderData;
  const { items, meta } = staffPage;

  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const refreshing = navigation.state === "loading";

  // Row selection is page-local UI state; a navigation resets it.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => setSelected(new Set()), [loaderData]);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  function selectTab(next: StaffTab) {
    const params = new URLSearchParams(searchParams);
    if (next === "all") params.delete("tab");
    else params.set("tab", next);
    params.delete("page");
    setSearchParams(params, { preventScrollReset: true });
  }

  function onSearchChange(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.currentTarget.value;
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (value.trim()) params.set("q", value.trim());
      else params.delete("q");
      params.delete("page");
      setSearchParams(params, { replace: true, preventScrollReset: true });
    }, 300);
  }

  function pageHref(page: number): string {
    const params = new URLSearchParams(searchParams);
    if (page <= 1) params.delete("page");
    else params.set("page", String(page));
    return `?${params.toString()}`;
  }

  const allSelected = items.length > 0 && items.every((staff) => selected.has(staff.id));
  const someSelected = items.some((staff) => selected.has(staff.id));

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(items.map((staff) => staff.id)) : new Set());
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Doctors / Staff</h1>
          <p className="text-sm text-muted-foreground">
            Browse the clinic team — roles, stations and account status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => exportCsv(items)}>
            <DownloadIcon />
            Export data
          </Button>
          <Button
            onClick={() =>
              toast.info("Adding staff is on the way", {
                description: "Account creation lands with the staff admin module.",
              })
            }
          >
            <PlusIcon />
            Add staff
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active staff" value={counts.active} icon={UsersRoundIcon}>
          {counts.all > 0
            ? `${Math.round((counts.active / counts.all) * 100)}% of all staff`
            : "No staff yet"}
        </StatCard>
        <StatCard label="Doctors" value={counts.doctor} icon={StethoscopeIcon}>
          <Link
            to="?tab=doctor"
            preventScrollReset
            className="font-medium text-primary hover:underline"
          >
            View all
          </Link>
        </StatCard>
        <StatCard label="Nurses" value={counts.nurse} icon={HeartPulseIcon}>
          <Link
            to="?tab=nurse"
            preventScrollReset
            className="font-medium text-primary hover:underline"
          >
            View all
          </Link>
        </StatCard>
        <StatCard label="Inactive accounts" value={counts.all - counts.active} icon={UserXIcon}>
          Sign-in disabled until reactivated
        </StatCard>
      </div>

      {/* Directory */}
      <Card className={cn("gap-0 py-0 transition-opacity", refreshing && "opacity-60")}>
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={tab} onValueChange={(value) => selectTab(value as StaffTab)}>
            <TabsList className="h-auto flex-wrap">
              {STAFF_TABS.map((entry) => (
                <TabsTrigger key={entry.value} value={entry.value} className="gap-1.5 px-2.5">
                  {entry.label}
                  <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                    {counts[entry.value]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="relative lg:w-72">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              defaultValue={q}
              onChange={onSearchChange}
              placeholder="Search by name, staff number or email..."
              aria-label="Search staff"
              className="pl-8"
            />
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
                  aria-label="Select all staff on this page"
                />
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Name
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Station
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Contact info
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Status
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Last sign-in
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {items.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  {q ? (
                    <>
                      No staff match <span className="font-medium">“{q}”</span> in this view.
                    </>
                  ) : (
                    "No staff in this view yet."
                  )}
                </TableCell>
              </TableRow>
            )}

            {items.map((staff) => (
              <TableRow
                key={staff.id}
                data-state={selected.has(staff.id) ? "selected" : undefined}
              >
                <TableCell className="w-12 px-4 py-3">
                  <Checkbox
                    checked={selected.has(staff.id)}
                    onCheckedChange={(checked) => toggleOne(staff.id, checked === true)}
                    aria-label={`Select ${staff.fullName}`}
                  />
                </TableCell>

                <TableCell className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarFallback
                        className={cn(
                          "text-xs font-semibold uppercase",
                          avatarTint(staff.id),
                        )}
                      >
                        {staffInitials(staff)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{staff.fullName}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {staff.specialty ??
                          staff.roles.map((role) => Roles.label(role)).join(" · ")}
                      </div>
                    </div>
                  </div>
                </TableCell>

                <TableCell className="px-4 py-3">
                  {staff.station ? (
                    Stations.label(staff.station)
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>

                <TableCell className="px-4 py-3">
                  <a
                    href={`mailto:${staff.email}`}
                    className="block text-primary hover:underline"
                  >
                    {staff.email}
                  </a>
                  <div className="text-xs text-muted-foreground">{staff.phone ?? "—"}</div>
                </TableCell>

                <TableCell className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1">
                    {staff.active ? (
                      <StatusPill tone="positive">Active</StatusPill>
                    ) : (
                      <StatusPill tone="muted">Inactive</StatusPill>
                    )}
                    {staff.licence?.expired && (
                      <StatusPill tone="warning">Licence expired</StatusPill>
                    )}
                  </div>
                </TableCell>

                <TableCell
                  className="px-4 py-3 text-muted-foreground"
                  suppressHydrationWarning
                >
                  {staff.lastLoginAt
                    ? formatDistanceToNow(new Date(staff.lastLoginAt), { addSuffix: true })
                    : "Never"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-sm text-muted-foreground">
          <span>
            {selected.size > 0
              ? `${selected.size} of ${items.length} selected`
              : `Showing ${from}–${to} of ${meta.total} staff`}
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
