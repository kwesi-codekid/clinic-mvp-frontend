/**
 * Check a patient in — the front desk's first act of the day (T3.2).
 *
 * Three steps, in the order a clerk actually works: find the person, say what
 * kind of attendance this is and how urgent, then settle who is paying. It is
 * a page rather than a dialog for the same reason registration is — it is a
 * link a clerk can be sent, and the browser back button means something.
 *
 * Two things the API decides, which this screen is careful not to pretend
 * otherwise about:
 *
 * 1. **The payer is frozen at check-in.** Whatever is chosen here is copied
 *    onto the visit as a `PayerSnapshot` and stops tracking the folder. Get it
 *    wrong and the bill is wrong, so the choice is explicit rather than
 *    silently inherited.
 * 2. **Lapsed cover checks in as cash.** The API refuses to accrue charges a
 *    scheme will later reject. The warning here says so *before* submit rather
 *    than leaving the clerk to notice it on the visit afterwards.
 *
 * A patient who is already in the clinic cannot be checked in twice — the API
 * answers that with a `409`, so the screen asks `GET /visits/open` first and
 * offers the visit they already have instead of a refusal.
 */

import { useState } from "react";
import { format } from "date-fns";
import {
  ArrowRightIcon,
  Loader2Icon,
  LogInIcon,
  SearchIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { data, Form, Link, redirect, useNavigation } from "react-router";

import { avatarTint, initialsOf, StatusPill } from "~/components/directory";
import { PageHeader } from "~/components/page-header";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { ApiError, describeApiError } from "~/lib/api/client";
import { getPatient, listPatients } from "~/lib/api/patients";
import { throwRouteError } from "~/lib/api/route-error";
import { checkIn, getOpenVisit } from "~/lib/api/visits";
import { requireStaff, requireStaffAction } from "~/lib/auth.server";
import { cn } from "~/lib/utils";
import {
  PayerTypes,
  Priorities,
  Sexes,
  Stations,
  VisitTypes,
  type Priority,
  type VisitType,
} from "~/models/enums";
import type { Patient, PayerProfile } from "~/models/patient";
import { isObjectId } from "~/models/primitives";
import type { CheckIn } from "~/models/visit";
import type { Route } from "./+types/visit-new";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: loaderData?.patient
        ? `Check in ${loaderData.patient.fullName} · Clinic`
        : "Check in a patient · Clinic",
    },
  ];
}

/* -------------------------------------------------------------------------
   Loader
   ------------------------------------------------------------------------- */

export async function loader({ request }: Route.LoaderArgs) {
  const { accessToken } = await requireStaff(request);
  const url = new URL(request.url);

  const patientId = url.searchParams.get("patientId");
  const q = url.searchParams.get("q")?.trim() || undefined;
  const opts = { token: accessToken };

  try {
    const patient = isObjectId(patientId) ? await getPatient(patientId, opts) : undefined;

    const [openVisit, results] = await Promise.all([
      // Cheaper than a 409, and it lets us offer the visit they already have.
      patient ? getOpenVisit(patient.id, opts) : Promise.resolve(null),
      // Only search once there is something to search for; the empty state is
      // a prompt, not a dump of the whole register.
      !patient && q ? listPatients({ q, limit: 8 }, opts).then((page) => page.items) : [],
    ]);

    return { patient, openVisit, q: q ?? "", results };
  } catch (error) {
    throwRouteError(error);
  }
}

/* -------------------------------------------------------------------------
   Write
   ------------------------------------------------------------------------- */

/** Trimmed, or `undefined` when the field was left empty. */
function text(form: FormData, key: string): string | undefined {
  const raw = form.get(key);
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

/**
 * The chosen payer.
 *
 * The rows post as parallel lists — `payerTypeOption[]`, `payerSchemeOption[]`
 * — and a single radio carries the index, which is the same shape the patient
 * form uses for its repeating blocks. `cash` is always offered as its own
 * choice: a patient with cover may still elect to pay for this visit.
 *
 * Returning `{}` leaves the payer out of the body entirely, which is how the
 * API is told to fall back to the folder's primary cover.
 */
function readPayer(form: FormData): Pick<CheckIn, "payerType" | "schemeId" | "memberNumber"> {
  const choice = form.get("payerChoice");
  if (choice === "cash") return { payerType: "cash" };

  const index = Number(choice);
  if (!Number.isInteger(index) || index < 0) return {};

  const types = form.getAll("payerTypeOption");
  const schemes = form.getAll("payerSchemeOption");
  const payerType = types[index];
  if (!PayerTypes.is(payerType)) return {};

  const schemeId = schemes[index];

  return {
    payerType,
    schemeId: isObjectId(schemeId) ? schemeId : undefined,
    // Typed at the desk off the card in the patient's hand; falls back to
    // whatever the folder already holds.
    memberNumber: text(form, "memberNumber"),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const { accessToken, setCookie } = await requireStaffAction(request);
  const form = await request.formData();

  const opts = { token: accessToken };
  // A rotated token has to ride out on every exit, success or not.
  const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;

  const fail = (message: string, fieldErrors: Record<string, string> = {}, status = 400) =>
    data({ message, fieldErrors }, { status, headers });

  const patientId = form.get("patientId");
  if (!isObjectId(patientId)) {
    return fail("Choose the patient being checked in.");
  }

  const type = form.get("type");
  const priority = form.get("priority");
  const station = form.get("station");

  const input: CheckIn = {
    patientId,
    type: VisitTypes.is(type) ? type : undefined,
    priority: Priorities.is(priority) ? priority : undefined,
    chiefComplaint: text(form, "chiefComplaint"),
    ...readPayer(form),
    // Omitted means "the first station of the default route for this type",
    // which is the clinic's own routing and the answer we want by default.
    station: Stations.is(station) ? station : undefined,
  };

  try {
    const visit = await checkIn(input, opts);
    return redirect(`/visits/${visit.id}?checkedIn=1`, { headers });
  } catch (error) {
    if (!ApiError.is(error)) throw error;

    const message =
      error.status === 409
        ? "This patient is already in the clinic. Open their current visit instead."
        : describeApiError(error).description;

    return fail(message, error.fieldErrors(), error.status >= 400 ? error.status : 502);
  }
}

/* -------------------------------------------------------------------------
   Pieces
   ------------------------------------------------------------------------- */

const TYPE_ITEMS = VisitTypes.options();
const STATION_ITEMS = [
  { value: "", label: "Default route for this visit type" },
  ...Stations.options(),
];

/** One payer the visit can be checked in against. */
function PayerOption({
  value,
  label,
  detail,
  profile,
}: {
  value: string;
  label: string;
  detail: string;
  profile?: PayerProfile;
}) {
  const lapsed = profile !== undefined && profile.payerType !== "cash" && !profile.valid;

  return (
    <FieldLabel
      className={cn(
        "w-full items-start gap-3 rounded-lg border p-3 font-normal",
        lapsed && "border-amber-500/40 bg-amber-500/5",
      )}
    >
      <RadioGroupItem value={value} className="mt-0.5" />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{label}</span>
          {profile?.isPrimary && <StatusPill tone="muted">Primary</StatusPill>}
          {lapsed && <StatusPill tone="warning">Cover lapsed</StatusPill>}
        </span>
        <span className="block text-sm text-muted-foreground">{detail}</span>
      </span>
    </FieldLabel>
  );
}

/**
 * Step 3's controls.
 *
 * Its own component so the page can mount it with `key={patient.id}`: the
 * chosen payer is state seeded from the folder's primary cover, and picking a
 * *different* patient has to reseed it. Without the remount, a clerk who
 * searched and then selected someone would keep whatever the previous folder
 * defaulted to — and the payer frozen onto a visit is exactly the thing that
 * must never be inherited by accident.
 */
function PayerStep({
  patient,
  fieldError,
}: {
  patient: Patient;
  fieldError: (path: string) => string | undefined;
}) {
  const profiles = patient.payerProfiles;
  const primaryIndex = Math.max(
    profiles.findIndex((profile) => profile.isPrimary),
    0,
  );

  const [payerChoice, setPayerChoice] = useState(
    profiles.length > 0 ? String(primaryIndex) : "cash",
  );
  const chosenProfile = profiles[Number(payerChoice)];

  return (
    <>
      <RadioGroup
        name="payerChoice"
        value={payerChoice}
        onValueChange={(value) => setPayerChoice(String(value))}
        className="gap-2"
      >
        {profiles.map((profile, index) => (
          <PayerOption
            key={`${profile.payerType}-${profile.memberNumber ?? index}`}
            value={String(index)}
            label={profile.label}
            detail={
              [
                profile.memberNumber && `Member ${profile.memberNumber}`,
                profile.expiresAt &&
                  `expires ${format(new Date(profile.expiresAt), "d MMM yyyy")}`,
              ]
                .filter(Boolean)
                .join(" · ") || "No membership details on the folder"
            }
            profile={profile}
          />
        ))}
        <PayerOption
          value="cash"
          label="Cash"
          detail="The patient settles this visit at the till."
        />
      </RadioGroup>

      {/* Parallel lists, picked by the radio's index — the same shape the
          patient form uses for its repeating blocks. */}
      {profiles.map((profile, index) => (
        <div key={`option-${index}`} className="hidden">
          <input type="hidden" name="payerTypeOption" value={profile.payerType} />
          <input type="hidden" name="payerSchemeOption" value={profile.schemeId ?? ""} />
        </div>
      ))}

      {chosenProfile && chosenProfile.payerType !== "cash" && (
        <>
          <Field className="sm:max-w-xs">
            <FieldLabel htmlFor="visit-member">Member number for this visit</FieldLabel>
            <Input
              id="visit-member"
              name="memberNumber"
              defaultValue={chosenProfile.memberNumber ?? ""}
              placeholder="As printed on the card"
              aria-invalid={fieldError("memberNumber") ? true : undefined}
            />
            <FieldDescription>
              Leave as it is unless the card in front of you says otherwise.
            </FieldDescription>
            <FieldError>{fieldError("memberNumber")}</FieldError>
          </Field>

          {!chosenProfile.valid && (
            <div
              role="note"
              className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p>
                <span className="font-medium">This cover is not valid.</span>{" "}
                <span className="text-muted-foreground">
                  The clinic will check the visit in as cash rather than raising charges the
                  scheme would refuse. Tell the patient before they see anyone.
                </span>
              </p>
            </div>
          )}
        </>
      )}

      {profiles.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No payer on this folder — the visit will be checked in as cash.
        </p>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

export default function CheckInPage({ loaderData, actionData }: Route.ComponentProps) {
  const { patient, openVisit, q, results } = loaderData;
  const navigation = useNavigation();
  // Covers the POST and the redirect after it, so the button stays busy until
  // the visit page is actually on screen.
  const busy = navigation.formData != null;

  const fieldError = (path: string) => actionData?.fieldErrors?.[`body.${path}`];

  // Reasons this patient must not start a new visit at all.
  const blocked = patient?.mergedInto
    ? "This folder has been merged away — check the patient in on the surviving folder."
    : patient?.isDeceased
      ? "This patient is recorded as deceased and cannot be checked in."
      : openVisit
        ? "This patient is already in the clinic."
        : undefined;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Check in a patient"
        description="Open a visit for someone who has arrived. The payer is frozen onto it as it stands now."
        backTo={patient ? `/patients/${patient.id}` : "/visits"}
        backLabel={patient ? "Back to folder" : "Back to visits"}
      />

      {actionData?.message && (
        <div
          role="alert"
          className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {actionData.message}
        </div>
      )}

      {/* Step 1 — who */}
      <Card>
        <CardHeader>
          <CardTitle>1. Who has arrived</CardTitle>
          <CardDescription>
            {patient
              ? "Checking in against this folder."
              : "Search by name, folder number, phone, NHIS or Ghana Card."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {patient ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <Avatar className="size-10">
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
                  <div className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{patient.folderNumber}</span> ·{" "}
                    {patient.age.display} · {Sexes.label(patient.sex)}
                    {patient.lastVisitAt
                      ? ` · last seen ${format(new Date(patient.lastVisitAt), "d MMM yyyy")}`
                      : " · first visit"}
                  </div>
                </div>
              </div>
              <Link to="/visits/new" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Choose someone else
              </Link>
            </div>
          ) : (
            <>
              <Form method="get" className="flex flex-wrap gap-2">
                <div className="relative min-w-56 flex-1">
                  <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    name="q"
                    defaultValue={q}
                    placeholder="Name, folder number, phone, NHIS or Ghana Card..."
                    aria-label="Search for the patient"
                    className="pl-8"
                  />
                </div>
                <Button type="submit" variant="outline">
                  Search
                </Button>
              </Form>

              {q === "" ? (
                <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                  Search for the patient above, or{" "}
                  <Link to="/patients/new" className="font-medium text-primary hover:underline">
                    register a new folder
                  </Link>{" "}
                  if this is their first visit.
                </p>
              ) : results.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                  No folder matches “{q}”.{" "}
                  <Link to="/patients/new" className="font-medium text-primary hover:underline">
                    Register a new one
                  </Link>
                  .
                </p>
              ) : (
                <div className="space-y-2">
                  {results.map((result) => (
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
                            {result.age.display} {Sexes.label(result.sex)} ·{" "}
                            {result.primaryPayer.label}
                          </div>
                        </div>
                      </div>
                      <Link
                        to={`/visits/new?patientId=${result.id}`}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        Check in
                        <ArrowRightIcon />
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {openVisit && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
            >
              <div className="flex items-start gap-2">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="font-medium">This patient is already in the clinic.</p>
                  <p className="text-muted-foreground">
                    Visit <span className="font-mono">{openVisit.visitNumber}</span> opened at{" "}
                    {format(new Date(openVisit.arrivedAt), "HH:mm")}
                    {openVisit.currentStation
                      ? `, now at ${Stations.label(openVisit.currentStation)}`
                      : ""}
                    .
                  </p>
                </div>
              </div>
              <Link
                to={`/visits/${openVisit.id}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Open that visit
              </Link>
            </div>
          )}

          {patient && !openVisit && (patient.mergedInto || patient.isDeceased) && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm font-medium text-destructive"
            >
              {blocked}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Steps 2 and 3 — one form, so a single submit checks the patient in. */}
      <Form method="post" className="space-y-6">
        <input type="hidden" name="patientId" value={patient?.id ?? ""} />

        <Card>
          <CardHeader>
            <CardTitle>2. The visit</CardTitle>
            <CardDescription>
              What kind of attendance this is, and how soon it needs to be seen.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="visit-type">Visit type</FieldLabel>
                <Select id="visit-type" name="type" defaultValue={"opd" satisfies VisitType} items={TYPE_ITEMS}>
                  <SelectTrigger className="h-8 w-full" aria-invalid={fieldError("type") ? true : undefined}>
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
                <FieldDescription>Decides the route through the clinic.</FieldDescription>
                <FieldError>{fieldError("type")}</FieldError>
              </Field>

              <Field>
                <FieldLabel htmlFor="visit-station">Start at</FieldLabel>
                <Select id="visit-station" name="station" defaultValue="" items={STATION_ITEMS}>
                  <SelectTrigger
                    className="h-8 w-full"
                    aria-invalid={fieldError("station") ? true : undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATION_ITEMS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>Override only when the patient skips a step.</FieldDescription>
                <FieldError>{fieldError("station")}</FieldError>
              </Field>
            </div>

            <Field>
              <FieldLabel>Priority</FieldLabel>
              <RadioGroup
                name="priority"
                defaultValue={"routine" satisfies Priority}
                className="gap-2 sm:grid-cols-3"
              >
                {Priorities.options().map((option) => (
                  <FieldLabel
                    key={option.value}
                    className="w-full items-center gap-2 rounded-lg border p-2 font-normal"
                  >
                    <RadioGroupItem value={option.value} />
                    {option.label}
                  </FieldLabel>
                ))}
              </RadioGroup>
              <FieldDescription>
                Emergency and urgent jump the queue at every station, not just the first.
              </FieldDescription>
              <FieldError>{fieldError("priority")}</FieldError>
            </Field>

            <Field>
              <FieldLabel htmlFor="visit-complaint">Chief complaint</FieldLabel>
              <Textarea
                id="visit-complaint"
                name="chiefComplaint"
                rows={2}
                placeholder="Fever and headache for three days"
                aria-invalid={fieldError("chiefComplaint") ? true : undefined}
              />
              <FieldDescription>
                In the patient's own words — the clinician writes the history later.
              </FieldDescription>
              <FieldError>{fieldError("chiefComplaint")}</FieldError>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. Who is paying</CardTitle>
            <CardDescription>
              Copied onto the visit as it stands now. Changing the folder later will not change
              this visit's bill.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {patient ? (
              // Keyed on the folder: choosing a different patient reseeds the
              // payer default rather than inheriting the last one.
              <PayerStep key={patient.id} patient={patient} fieldError={fieldError} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Choose the patient above and their cover will be listed here.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <Link
            to={patient ? `/patients/${patient.id}` : "/visits"}
            className="text-sm text-muted-foreground hover:underline"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={!patient || blocked !== undefined || busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : <LogInIcon />}
            Check in
          </Button>
        </div>
      </Form>
    </div>
  );
}
