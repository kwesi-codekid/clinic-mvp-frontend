/**
 * Patients — the records desk's folder directory (T2.2).
 *
 * Same screen as the staff directory, wearing patient columns: counters
 * across the top, payer tabs and one search box driving `GET /patients`
 * through URL search params, a table, a pager. Every view is therefore
 * shareable and SSR-rendered, and the back button works.
 *
 * The single search box is deliberate — the API searches folder number, name,
 * phone, NHIS number and Ghana Card number at once, which is what a clerk with
 * a queue in front of them actually types.
 *
 * This route has **no action**. Registering, editing and merging are all
 * full pages of their own: a folder is too much form for a drawer, and each
 * one is a link a clerk can be sent.
 */

import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  BanknoteIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  GitMergeIcon,
  IdCardIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  UsersRoundIcon,
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
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
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
import { listPatients, type PatientListQuery } from "~/lib/api/patients";
import { throwRouteError } from "~/lib/api/route-error";
import { requireStaff } from "~/lib/auth.server";
import { cn } from "~/lib/utils";
import { Sexes, type PayerType } from "~/models/enums";
import type { PatientSummary } from "~/models/patient";
import type { Route } from "./+types/patients";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Patients · Clinic" }];
}

/* -------------------------------------------------------------------------
   Tabs and loader
   ------------------------------------------------------------------------- */

const PAGE_SIZE = 10;

/** The payer slices the tabs map onto. `payerType: undefined` = everyone. */
const PATIENT_TABS = [
  { value: "all", label: "All patients", payerType: undefined },
  { value: "nhis", label: "NHIS", payerType: "nhis" },
  { value: "cash", label: "Cash", payerType: "cash" },
  { value: "private_scheme", label: "Private", payerType: "private_scheme" },
  { value: "corporate", label: "Corporate", payerType: "corporate" },
] as const satisfies ReadonlyArray<{
  value: string;
  label: string;
  payerType: PayerType | undefined;
}>;

type PatientTab = (typeof PATIENT_TABS)[number]["value"];

function parseTab(value: string | null): PatientTab {
  return PATIENT_TABS.find((tab) => tab.value === value)?.value ?? "all";
}

export async function loader({ request }: Route.LoaderArgs) {
  const { accessToken } = await requireStaff(request);
  const url = new URL(request.url);

  const q = url.searchParams.get("q")?.trim() || undefined;
  const tab = parseTab(url.searchParams.get("tab"));
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page")) || 1));
  const payerType = PATIENT_TABS.find((entry) => entry.value === tab)?.payerType;

  const opts = { token: accessToken };
  // `meta.total` off a one-row page is the cheapest count the API offers.
  const countWhere = (query: PatientListQuery) =>
    listPatients({ ...query, limit: 1 }, opts).then((result) => result.meta.total);

  try {
    const [patientPage, all, nhis, cash, privateScheme, corporate, withMerged] =
      await Promise.all([
        listPatients({ q, payerType, page, limit: PAGE_SIZE, sort: "surname" }, opts),
        countWhere({}),
        countWhere({ payerType: "nhis" }),
        countWhere({ payerType: "cash" }),
        countWhere({ payerType: "private_scheme" }),
        countWhere({ payerType: "corporate" }),
        countWhere({ includeMerged: true }),
      ]);

    return {
      patientPage,
      tab,
      q: q ?? "",
      counts: {
        all,
        nhis,
        cash,
        private_scheme: privateScheme,
        corporate,
        // Folders that were merged away. The list endpoint hides them, so the
        // difference between the two totals is the only place they show up.
        retired: Math.max(withMerged - all, 0),
      },
    };
  } catch (error) {
    throwRouteError(error);
  }
}

/* -------------------------------------------------------------------------
   Presentational pieces
   ------------------------------------------------------------------------- */

/** Cover the till can rely on, cover that has lapsed, or plain cash. */
function PayerCell({ patient }: { patient: PatientSummary }) {
  const payer = patient.primaryPayer;
  const isCash = payer.payerType === "cash";

  return (
    <div className="space-y-1">
      <div className="font-medium">{payer.label}</div>
      {isCash ? (
        <span className="text-xs text-muted-foreground">Settles at the till</span>
      ) : payer.valid ? (
        <StatusPill tone="positive">Cover valid</StatusPill>
      ) : (
        <StatusPill tone="warning">Cover lapsed</StatusPill>
      )}
    </div>
  );
}

function exportCsv(items: PatientSummary[]) {
  downloadCsv(
    [
      ["Folder number", "Name", "Sex", "Age", "Phone", "NHIS number", "Payer", "Last visit"],
      ...items.map((patient) => [
        patient.folderNumber,
        patient.fullName,
        Sexes.label(patient.sex),
        patient.age.display,
        patient.phoneFormatted ?? patient.phone ?? "",
        patient.nhisNumber ?? "",
        patient.primaryPayer.label,
        patient.lastVisitAt ?? "Never",
      ]),
    ],
    "patients.csv",
  );

  toast.success(`Exported ${items.length} patients to CSV`, {
    description: "The rows currently in view.",
  });
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

export default function PatientsPage({ loaderData }: Route.ComponentProps) {
  const { patientPage, tab, q, counts } = loaderData;
  const { items, meta } = patientPage;

  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const refreshing = navigation.state === "loading";

  // Row selection is page-local UI state; a navigation resets it.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => setSelected(new Set()), [loaderData]);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  function selectTab(next: PatientTab) {
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

  const allSelected = items.length > 0 && items.every((patient) => selected.has(patient.id));
  const someSelected = items.some((patient) => selected.has(patient.id));

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(items.map((patient) => patient.id)) : new Set());
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
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Patients</h1>
          <p className="text-sm text-muted-foreground">
            Every folder in the clinic — search by name, folder number, phone, NHIS or Ghana
            Card.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => exportCsv(items)}>
            <DownloadIcon />
            Export data
          </Button>
          <Link to="/patients/new" className={buttonVariants()}>
            <PlusIcon />
            Register patient
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total folders" value={counts.all} icon={UsersRoundIcon}>
          Registered patients
        </StatCard>
        <StatCard label="NHIS covered" value={counts.nhis} icon={ShieldCheckIcon}>
          {counts.all > 0
            ? `${Math.round((counts.nhis / counts.all) * 100)}% of all folders`
            : "No folders yet"}
        </StatCard>
        <StatCard label="Cash paying" value={counts.cash} icon={BanknoteIcon}>
          <Link
            to="?tab=cash"
            preventScrollReset
            className="font-medium text-primary hover:underline"
          >
            View all
          </Link>
        </StatCard>
        <StatCard label="Retired folders" value={counts.retired} icon={GitMergeIcon}>
          Merged into another folder
        </StatCard>
      </div>

      {/* Directory */}
      <Card className={cn("gap-0 py-0 transition-opacity", refreshing && "opacity-60")}>
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={tab} onValueChange={(value) => selectTab(value as PatientTab)}>
            <TabsList className="h-auto flex-wrap">
              {PATIENT_TABS.map((entry) => (
                <TabsTrigger key={entry.value} value={entry.value} className="gap-1.5 px-2.5">
                  {entry.label}
                  <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                    {counts[entry.value]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="relative lg:w-80">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              defaultValue={q}
              onChange={onSearchChange}
              placeholder="Search name, folder, phone, NHIS or Ghana Card..."
              aria-label="Search patients"
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
                  aria-label="Select all patients on this page"
                />
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Patient
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Age / Sex
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Contact info
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Payer
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Last visit
              </TableHead>
              <TableHead className="h-11 w-14 px-4 text-right text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {items.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  {q ? (
                    <>
                      No folder matches <span className="font-medium">“{q}”</span> in this view.
                    </>
                  ) : (
                    "No patients in this view yet."
                  )}
                </TableCell>
              </TableRow>
            )}

            {items.map((patient) => (
              <TableRow
                key={patient.id}
                data-state={selected.has(patient.id) ? "selected" : undefined}
              >
                <TableCell className="w-12 px-4 py-3">
                  <Checkbox
                    checked={selected.has(patient.id)}
                    onCheckedChange={(checked) => toggleOne(patient.id, checked === true)}
                    aria-label={`Select ${patient.fullName}`}
                  />
                </TableCell>

                <TableCell className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarFallback
                        className={cn("text-xs font-semibold uppercase", avatarTint(patient.id))}
                      >
                        {initialsOf(patient.firstName, patient.surname)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <Link
                        to={`/patients/${patient.id}`}
                        className="truncate font-medium hover:underline"
                      >
                        {patient.fullName}
                      </Link>
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {patient.folderNumber}
                      </div>
                    </div>
                  </div>
                </TableCell>

                <TableCell className="px-4 py-3">
                  {/* `display` is the folder's own wording — never recomputed. */}
                  <div className="tabular-nums">{patient.age.display}</div>
                  <div className="text-xs text-muted-foreground">
                    {Sexes.label(patient.sex)}
                  </div>
                </TableCell>

                <TableCell className="px-4 py-3">
                  {patient.phone ? (
                    <a href={`tel:${patient.phone}`} className="block text-primary hover:underline">
                      {patient.phoneFormatted ?? patient.phone}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">No phone</span>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {patient.nhisNumber ? `NHIS ${patient.nhisNumber}` : "—"}
                  </div>
                </TableCell>

                <TableCell className="px-4 py-3">
                  <PayerCell patient={patient} />
                </TableCell>

                <TableCell className="px-4 py-3 text-muted-foreground" suppressHydrationWarning>
                  {patient.lastVisitAt
                    ? formatDistanceToNow(new Date(patient.lastVisitAt), { addSuffix: true })
                    : "Never"}
                </TableCell>

                <TableCell className="w-14 px-4 py-3 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for ${patient.fullName}`}
                        />
                      }
                    >
                      <MoreHorizontalIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem render={<Link to={`/patients/${patient.id}`} />}>
                        <IdCardIcon />
                        Open folder
                      </DropdownMenuItem>
                      <DropdownMenuItem render={<Link to={`/patients/${patient.id}/edit`} />}>
                        <PencilIcon />
                        Edit details
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem render={<Link to={`/patients/${patient.id}/merge`} />}>
                        <GitMergeIcon />
                        Merge duplicate
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
              : `Showing ${from}–${to} of ${meta.total} patients`}
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
