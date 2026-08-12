/**
 * Merge two folders into one (T2.3).
 *
 * `POST /patients/merge` repoints every visit, bill, result and claim from the
 * duplicate onto the surviving folder, then retires the duplicate with a
 * pointer to where its records went. Nothing is deleted — and nothing about it
 * is undoable from this screen either, which is why it takes three deliberate
 * steps: pick the other folder, read the two side by side, then type the
 * folder number being retired.
 *
 * The folder you arrived from is the one kept by default, because that is the
 * one the clerk was looking at. Swapping is a single link — and it swaps the
 * *whole* decision, so the confirmation has to be typed again.
 *
 * Candidates come from the same duplicate check the registration form uses,
 * run against this patient's own details, so the usual case needs no search at
 * all.
 */

import { useState } from "react";
import { format } from "date-fns";
import {
  ArrowLeftRightIcon,
  GitMergeIcon,
  Loader2Icon,
  SearchIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { data, Form, Link, redirect, useNavigation, useSearchParams } from "react-router";

import { avatarTint, initialsOf } from "~/components/directory";
import { CandidateRow } from "~/components/duplicate-candidates";
import { PageHeader } from "~/components/page-header";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { ApiError, describeApiError } from "~/lib/api/client";
import { checkDuplicates, getPatient, listPatients, mergePatients } from "~/lib/api/patients";
import { throwRouteError } from "~/lib/api/route-error";
import { requireStaff, requireStaffAction } from "~/lib/auth.server";
import { cn } from "~/lib/utils";
import { Sexes } from "~/models/enums";
import type { Patient } from "~/models/patient";
import { isObjectId, parseObjectId } from "~/models/primitives";
import type { Route } from "./+types/patient-merge";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: loaderData
        ? `Merge ${loaderData.patient.fullName} · Clinic`
        : "Merge folders · Clinic",
    },
  ];
}

/* -------------------------------------------------------------------------
   Loader
   ------------------------------------------------------------------------- */

export async function loader({ request, params }: Route.LoaderArgs) {
  const { accessToken } = await requireStaff(request);
  const id = parseObjectId(params.patientId, "patient id");
  const url = new URL(request.url);

  const q = url.searchParams.get("q")?.trim() || undefined;
  const otherId = url.searchParams.get("other");
  const opts = { token: accessToken };

  try {
    const patient = await getPatient(id, opts);

    // A folder can never be merged with itself, whatever the URL claims.
    const other =
      isObjectId(otherId) && otherId !== id ? await getPatient(otherId, opts) : undefined;

    const [suggested, results] = await Promise.all([
      // The patient's own details, run back through the duplicate check.
      other
        ? Promise.resolve([])
        : checkDuplicates(
            {
              surname: patient.surname,
              firstName: patient.firstName,
              otherNames: patient.otherNames,
              phone: patient.phone,
              ghanaCardNumber: patient.ghanaCardNumber,
              nhisNumber: patient.nhisNumber,
              dateOfBirth: patient.dateOfBirth,
              sex: patient.sex,
            },
            opts,
          ).catch(() => []),
      q ? listPatients({ q, limit: 6 }, opts).then((page) => page.items) : Promise.resolve([]),
    ]);

    return {
      patient,
      other,
      q: q ?? "",
      // The patient's own folder is never a candidate to merge with itself.
      suggested: suggested.filter((candidate) => candidate.patient.id !== id),
      results: results.filter((result) => result.id !== id),
    };
  } catch (error) {
    throwRouteError(error);
  }
}

/* -------------------------------------------------------------------------
   Write
   ------------------------------------------------------------------------- */

export async function action({ request, params }: Route.ActionArgs) {
  const { accessToken, setCookie } = await requireStaffAction(request);
  const currentId = parseObjectId(params.patientId, "patient id");

  const form = await request.formData();
  const opts = { token: accessToken };
  const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;

  const fail = (message: string, status = 400) =>
    data({ message }, { status, headers });

  const sourceId = form.get("sourceId");
  const targetId = form.get("targetId");

  if (!isObjectId(sourceId) || !isObjectId(targetId) || sourceId === targetId) {
    return fail("Choose two different folders to merge.");
  }
  if (sourceId !== currentId && targetId !== currentId) {
    return fail("This merge does not involve the folder you opened.");
  }

  // Re-read the folder being retired rather than trusting the form: the typed
  // confirmation is the only thing standing between a clerk and an
  // irreversible move, so it is checked against the record, not against a
  // hidden input that came from the same page.
  let source: Patient;
  try {
    source = await getPatient(sourceId, opts);
  } catch (error) {
    if (!ApiError.is(error)) throw error;
    return fail(describeApiError(error).description, error.status >= 400 ? error.status : 502);
  }

  const typed = String(form.get("confirmFolderNumber") ?? "").trim();
  if (typed.toLowerCase() !== source.folderNumber.toLowerCase()) {
    return fail(`Type ${source.folderNumber} to confirm which folder is retired.`);
  }

  try {
    const survivor = await mergePatients(
      { sourceId, targetId, reason: String(form.get("reason") ?? "").trim() || undefined },
      opts,
    );
    return redirect(`/patients/${survivor.id}?merged=1`, { headers });
  } catch (error) {
    if (!ApiError.is(error)) throw error;
    return fail(describeApiError(error).description, error.status >= 400 ? error.status : 502);
  }
}

/* -------------------------------------------------------------------------
   Comparison
   ------------------------------------------------------------------------- */

type Facet = { label: string; of: (patient: Patient) => string };

/** What a clerk compares when deciding whether two folders are one person. */
const FACETS: Facet[] = [
  { label: "Folder number", of: (p) => p.folderNumber },
  { label: "Full name", of: (p) => p.fullName },
  { label: "Sex", of: (p) => Sexes.label(p.sex) },
  { label: "Age", of: (p) => p.age.display },
  {
    label: "Date of birth",
    of: (p) => (p.dateOfBirth ? format(new Date(p.dateOfBirth), "d MMM yyyy") : "—"),
  },
  { label: "Phone", of: (p) => p.phoneFormatted ?? p.phone ?? "—" },
  { label: "NHIS number", of: (p) => p.nhisNumber ?? "—" },
  { label: "Ghana Card", of: (p) => p.ghanaCardNumber ?? "—" },
  { label: "Payer", of: (p) => p.primaryPayer.label },
  { label: "Town", of: (p) => p.town ?? "—" },
  { label: "Registered", of: (p) => format(new Date(p.registeredAt), "d MMM yyyy") },
  { label: "Last visit", of: (p) => (p.lastVisitAt ? format(new Date(p.lastVisitAt), "d MMM yyyy") : "Never") },
  { label: "Allergies", of: (p) => String(p.allergies.length) },
  { label: "Chronic conditions", of: (p) => String(p.chronicConditions.length) },
];

function FolderColumn({
  patient,
  role,
}: {
  patient: Patient;
  role: "keep" | "retire";
}) {
  return (
    <div
      className={cn(
        "space-y-1 rounded-lg border p-3",
        role === "keep"
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-destructive/40 bg-destructive/5",
      )}
    >
      <div className="text-xs font-medium tracking-wider uppercase">
        {role === "keep" ? (
          <span className="text-emerald-700 dark:text-emerald-400">Folder to keep</span>
        ) : (
          <span className="text-destructive">Folder to retire</span>
        )}
      </div>
      <div className="flex items-center gap-2.5">
        <Avatar>
          <AvatarFallback className={cn("text-xs font-semibold uppercase", avatarTint(patient.id))}>
            {initialsOf(patient.firstName, patient.surname)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate font-medium">{patient.fullName}</div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {patient.folderNumber}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

export default function MergePatientsPage({ loaderData, actionData }: Route.ComponentProps) {
  const { patient, other, q, suggested, results } = loaderData;
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const busy = navigation.formData != null;

  // Which way round the merge runs. The folder we arrived from is kept unless
  // the clerk says otherwise.
  const swapped = searchParams.get("swap") === "1";
  const target = other && swapped ? other : patient;
  const source = other && swapped ? patient : other;

  const [confirmation, setConfirmation] = useState("");
  const confirmed =
    source !== undefined &&
    confirmation.trim().toLowerCase() === source.folderNumber.toLowerCase();

  function withParams(changes: Record<string, string | null>): string {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Merge duplicate folders"
        description="Bring one patient's two folders back together."
        backTo={`/patients/${patient.id}`}
        backLabel="Back to folder"
      />

      <div className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="space-y-1">
          <p className="font-medium">A merge cannot be undone from here.</p>
          <p className="text-muted-foreground">
            Every visit, bill, result and claim moves onto the folder you keep. The other one is
            retired — nothing is deleted, and it keeps a pointer to where its records went — but
            it stops being usable for new visits.
          </p>
        </div>
      </div>

      {actionData?.message && (
        <div
          role="alert"
          className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {actionData.message}
        </div>
      )}

      {/* Step 1 — choose the other folder */}
      <Card>
        <CardHeader>
          <CardTitle>1. Choose the other folder</CardTitle>
          <CardDescription>
            {other
              ? "Pick a different one at any time — the comparison below updates with it."
              : "Folders that look like this patient are listed first. Search if the one you want is not among them."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Form method="get" className="flex flex-wrap gap-2">
            {other && <input type="hidden" name="other" value={other.id} />}
            {swapped && <input type="hidden" name="swap" value="1" />}
            <div className="relative min-w-56 flex-1">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Name, folder number, phone, NHIS or Ghana Card..."
                aria-label="Search for the other folder"
                className="pl-8"
              />
            </div>
            <Button type="submit" variant="outline">
              Search
            </Button>
          </Form>

          {!other && suggested.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Suggested duplicates
              </h3>
              {suggested.map((candidate) => (
                <CandidateRow
                  key={candidate.patient.id}
                  candidate={candidate}
                  action={
                    <Link
                      to={withParams({ other: candidate.patient.id })}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                      preventScrollReset
                    >
                      Select
                    </Link>
                  }
                />
              ))}
            </div>
          )}

          {q !== "" && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Search results
              </h3>
              {results.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                  No other folder matches “{q}”.
                </p>
              ) : (
                results.map((result) => (
                  <div
                    key={result.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-2.5">
                      <Avatar>
                        <AvatarFallback
                          className={cn(
                            "text-xs font-semibold uppercase",
                            avatarTint(result.id),
                          )}
                        >
                          {initialsOf(result.firstName, result.surname)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{result.fullName}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          <span className="font-mono">{result.folderNumber}</span> ·{" "}
                          {result.age.display} {Sexes.label(result.sex)}
                          {result.phoneFormatted ? ` · ${result.phoneFormatted}` : ""}
                        </div>
                      </div>
                    </div>
                    <Link
                      to={withParams({ other: result.id })}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                      preventScrollReset
                    >
                      Select
                    </Link>
                  </div>
                ))
              )}
            </div>
          )}

          {!other && suggested.length === 0 && q === "" && (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
              Nothing in the register looks like a duplicate of this folder. Search above if you
              know of one.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Step 2 — compare, and decide which way round */}
      <Card>
        <CardHeader>
          <CardTitle>2. Compare them</CardTitle>
          <CardDescription>
            Differences are highlighted. The folder you keep keeps its own details — a merge
            moves records, not demographics.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!source || !target || !other ? (
            <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              Choose a second folder above to compare it with{" "}
              <span className="font-medium">{patient.fullName}</span>.
            </p>
          ) : (
            <>
              <div className="grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
                <FolderColumn patient={target} role="keep" />
                <div className="flex items-center justify-center">
                  <Link
                    to={withParams({ swap: swapped ? null : "1" })}
                    preventScrollReset
                    className={buttonVariants({ variant: "outline", size: "icon" })}
                    aria-label="Swap which folder is kept"
                    onClick={() => setConfirmation("")}
                  >
                    <ArrowLeftRightIcon />
                  </Link>
                </div>
                <FolderColumn patient={source} role="retire" />
              </div>

              <dl className="divide-y rounded-lg border">
                {FACETS.map((facet) => {
                  const kept = facet.of(target);
                  const retired = facet.of(source);
                  const differs = kept !== retired;

                  return (
                    <div
                      key={facet.label}
                      className={cn(
                        "grid grid-cols-[1fr_auto_1fr] items-baseline gap-3 px-3 py-2 text-sm sm:grid-cols-[1fr_10rem_1fr]",
                        differs && "bg-amber-500/5",
                      )}
                    >
                      <dd className={cn("text-right", differs && "font-medium")}>{kept}</dd>
                      <dt className="text-center text-xs tracking-wider text-muted-foreground uppercase">
                        {facet.label}
                      </dt>
                      <dd className={cn(differs && "font-medium")}>{retired}</dd>
                    </div>
                  );
                })}
              </dl>
            </>
          )}
        </CardContent>
      </Card>

      {/* Step 3 — confirm */}
      <Card>
        <CardHeader>
          <CardTitle>3. Confirm the merge</CardTitle>
          <CardDescription>
            {source
              ? `Folder ${source.folderNumber} will be retired into ${target.folderNumber}.`
              : "Available once both folders are chosen."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {source && target ? (
            <Form method="post" className="space-y-4">
              <input type="hidden" name="sourceId" value={source.id} />
              <input type="hidden" name="targetId" value={target.id} />

              <Field>
                <FieldLabel htmlFor="merge-reason">Reason</FieldLabel>
                <Textarea
                  id="merge-reason"
                  name="reason"
                  rows={2}
                  placeholder="Registered twice at the desk on the same morning."
                />
                <FieldDescription>
                  Optional, but it is what explains the retired folder to whoever finds it later.
                </FieldDescription>
              </Field>

              <Field className="sm:max-w-xs">
                <FieldLabel htmlFor="merge-confirm">
                  Type {source.folderNumber} to confirm
                </FieldLabel>
                <Input
                  id="merge-confirm"
                  name="confirmFolderNumber"
                  autoComplete="off"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.currentTarget.value)}
                  aria-invalid={confirmation !== "" && !confirmed ? true : undefined}
                />
                <FieldError>
                  {confirmation !== "" && !confirmed
                    ? "That is not the folder number being retired."
                    : undefined}
                </FieldError>
              </Field>

              <div className="flex flex-wrap items-center justify-end gap-3">
                <Link
                  to={`/patients/${patient.id}`}
                  className="text-sm text-muted-foreground hover:underline"
                >
                  Cancel
                </Link>
                <Button type="submit" variant="destructive" disabled={!confirmed || busy}>
                  {busy ? <Loader2Icon className="animate-spin" /> : <GitMergeIcon />}
                  Merge folders
                </Button>
              </div>
            </Form>
          ) : (
            <p className="text-sm text-muted-foreground">
              Choose the duplicate folder first.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
