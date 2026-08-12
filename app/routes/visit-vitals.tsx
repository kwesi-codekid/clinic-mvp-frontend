/**
 * Vitals — the observations taken before the patient is seen (T5.1).
 *
 * The screen is built around one decision: **the clinic's ranges live in the
 * API, not here.** As readings are typed, `/resources/vitals-preview` grades
 * them server-side and the flags come back against the fields that caused
 * them — so the nurse is told "Fever" while the thermometer is still in her
 * hand, using the same age-aware rules the saved record will be judged by.
 * There is no range table in this file, and there must not be one: a second
 * copy would eventually disagree with the first, and the disagreement would be
 * silent.
 *
 * Two consequences worth knowing:
 *
 * - The preview is graded **without the patient's record**, so the age is sent
 *   explicitly. What comes back from the save is authoritative; the screen
 *   re-renders the saved set's own flags rather than leaving the preview up.
 * - A set is never edited. A recheck is a new set, which is why the previous
 *   ones stay on screen instead of being replaced.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  ActivityIcon,
  ClipboardPlusIcon,
  HeartPulseIcon,
  Loader2Icon,
  RulerIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { data, Form, Link, redirect, useFetcher, useNavigation } from "react-router";

import { PageHeader } from "~/components/page-header";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { FieldFlags, flagFieldClass, FlagList } from "~/components/vital-flags";
import { VisitHeader } from "~/components/visit-header";
import { ApiError, describeApiError } from "~/lib/api/client";
import { throwRouteError } from "~/lib/api/route-error";
import { listVitals, recordVitals } from "~/lib/api/vitals";
import { getVisit } from "~/lib/api/visits";
import { requireStaff, requireStaffAction } from "~/lib/auth.server";
import { cn } from "~/lib/utils";
import type { Role } from "~/models/enums";
import { parseObjectId } from "~/models/primitives";
import {
  flagsByField,
  hasCriticalFlag,
  isEmptyReading,
  VITAL_BOUNDS,
  worstSeverity,
  type RecordVitals,
  type VitalField,
  type Vitals,
} from "~/models/vitals";
import type { VitalsPreviewData } from "./resource-vitals-preview";
import type { Route } from "./+types/visit-vitals";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.visit.patient.fullName;
  return [{ title: name ? `Vitals · ${name} · Clinic` : "Vitals · Clinic" }];
}

/** Who `POST /vitals` accepts, per the endpoint's own role gate. */
const RECORDING_ROLES: readonly Role[] = [
  "nurse",
  "midwife",
  "doctor",
  "physician_assistant",
  "admin",
];

/* -------------------------------------------------------------------------
   Loader
   ------------------------------------------------------------------------- */

export async function loader({ request, params }: Route.LoaderArgs) {
  const { accessToken, staff } = await requireStaff(request);
  const visitId = parseObjectId(params.visitId, "visit id");
  const opts = { token: accessToken };

  try {
    const [visit, page] = await Promise.all([
      getVisit(visitId, opts),
      // Newest first: the set just taken leads, and the one before it is the
      // comparison a nurse actually makes.
      listVitals({ visitId, limit: 20, sort: "-takenAt" }, opts),
    ]);

    const savedId = new URL(request.url).searchParams.get("saved");

    return {
      visit,
      sets: page.items,
      saved: page.items.find((set) => set.id === savedId),
      canRecord: staff.roles.some((role) => RECORDING_ROLES.includes(role)),
    };
  } catch (error) {
    throwRouteError(error);
  }
}

/* -------------------------------------------------------------------------
   Write
   ------------------------------------------------------------------------- */

/** A reading off the form, or `undefined` when the field was left blank. */
function readingOf(form: FormData, field: VitalField): number | undefined {
  const raw = form.get(field);
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

const FIELDS = Object.keys(VITAL_BOUNDS) as VitalField[];

export async function action({ request, params }: Route.ActionArgs) {
  const { accessToken, setCookie } = await requireStaffAction(request);
  const visitId = parseObjectId(params.visitId, "visit id");
  const form = await request.formData();

  const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;
  const fail = (message: string, fieldErrors: Record<string, string> = {}, status = 400) =>
    data({ message, fieldErrors }, { status, headers });

  const readings: Partial<Record<VitalField, number>> = {};
  const fieldErrors: Record<string, string> = {};

  for (const field of FIELDS) {
    const value = readingOf(form, field);
    if (value === undefined) continue;

    const { min, max, unit } = VITAL_BOUNDS[field];
    if (value < min || value > max) {
      // Caught here rather than sent: outside these limits it is a slipped
      // decimal, and a 400 would say so far less usefully.
      fieldErrors[`body.${field}`] = `Must be between ${min} and ${max} ${unit}.`;
      continue;
    }
    readings[field] = value;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return fail("Check the readings marked below.", fieldErrors);
  }

  const notesRaw = form.get("notes");
  const notes = typeof notesRaw === "string" && notesRaw.trim() !== "" ? notesRaw.trim() : undefined;

  if (isEmptyReading(readings)) {
    return fail("Record at least one observation — a note on its own is not a set of vitals.");
  }

  // Both halves or neither: a lone systolic is not a blood pressure, and the
  // API would store it as one.
  if ((readings.systolic === undefined) !== (readings.diastolic === undefined)) {
    return fail("Enter both halves of the blood pressure, or neither.", {
      "body.systolic": "A blood pressure needs both numbers.",
    });
  }

  const input: RecordVitals = { visitId, ...readings, notes };

  try {
    const saved = await recordVitals(input, { token: accessToken });
    // Back to this screen rather than away from it: the flags computed against
    // the patient's real record are the ones that matter, and a critical
    // reading has to be seen by the person who just took it.
    return redirect(`/visits/${visitId}/vitals?saved=${saved.id}`, { headers });
  } catch (error) {
    if (!ApiError.is(error)) throw error;
    return fail(
      describeApiError(error).description,
      error.fieldErrors(),
      error.status >= 400 ? error.status : 502,
    );
  }
}

/* -------------------------------------------------------------------------
   Pieces
   ------------------------------------------------------------------------- */

type ReadingState = Partial<Record<VitalField, string>>;

/** One numeric observation, with whatever the API flagged about it beneath. */
function ReadingField({
  field,
  label,
  hint,
  value,
  onChange,
  flags,
  error,
  className,
}: {
  field: VitalField;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  flags: ReturnType<typeof flagsByField>;
  error?: string;
  className?: string;
}) {
  const bounds = VITAL_BOUNDS[field];
  const own = flags.get(field) ?? [];
  const severity = worstSeverity(own);

  return (
    <Field className={className}>
      <FieldLabel htmlFor={`vitals-${field}`}>
        {label} <span className="font-normal text-muted-foreground">({bounds.unit})</span>
      </FieldLabel>
      <Input
        id={`vitals-${field}`}
        name={field}
        type="number"
        inputMode="decimal"
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        className={cn(!error && flagFieldClass(severity))}
      />
      <FieldFlags flags={own} />
      {hint && !error && own.length === 0 && <FieldDescription>{hint}</FieldDescription>}
      <FieldError>{error}</FieldError>
    </Field>
  );
}

/** A saved set, as it reads back on the record. */
function VitalsCard({ set, highlight }: { set: Vitals; highlight?: boolean }) {
  const rows: Array<[string, string | undefined]> = [
    ["Temperature", set.temperature !== undefined ? `${set.temperature} °C` : undefined],
    ["Blood pressure", set.bloodPressure],
    ["Pulse", set.pulse !== undefined ? `${set.pulse} bpm` : undefined],
    [
      "Respiratory rate",
      set.respiratoryRate !== undefined ? `${set.respiratoryRate} /min` : undefined,
    ],
    ["SpO₂", set.spo2 !== undefined ? `${set.spo2}%` : undefined],
    ["Weight", set.weightKg !== undefined ? `${set.weightKg} kg` : undefined],
    ["Height", set.heightCm !== undefined ? `${set.heightCm} cm` : undefined],
    ["BMI", set.bmi !== undefined ? String(set.bmi) : undefined],
    ["MUAC", set.muacCm !== undefined ? `${set.muacCm} cm` : undefined],
    [
      "Random blood sugar",
      set.randomBloodSugar !== undefined ? `${set.randomBloodSugar} mmol/L` : undefined,
    ],
    [
      "Fasting blood sugar",
      set.fastingBloodSugar !== undefined ? `${set.fastingBloodSugar} mmol/L` : undefined,
    ],
    ["Pain score", set.painScore !== undefined ? `${set.painScore}/10` : undefined],
  ];

  const present = rows.filter((row): row is [string, string] => row[1] !== undefined);

  return (
    <Card className={cn(highlight && "border-primary/50")}>
      <CardHeader>
        <CardTitle className="text-base">
          <span suppressHydrationWarning>{format(new Date(set.takenAt), "d MMM yyyy, HH:mm")}</span>
        </CardTitle>
        <CardDescription>
          {set.takenByName ? `Taken by ${set.takenByName}` : "Recorded"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <FlagList flags={set.flags} />
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          {present.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {set.notes && <p className="text-sm text-muted-foreground">{set.notes}</p>}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

export default function VisitVitalsPage({ loaderData, actionData }: Route.ComponentProps) {
  const { visit, sets, saved, canRecord } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.formData != null;

  const fieldError = (field: string) => actionData?.fieldErrors?.[`body.${field}`];

  const [readings, setReadings] = useState<ReadingState>({});
  const preview = useFetcher<VitalsPreviewData>();

  /**
   * The patient's age in whole years, for the preview's paediatric ranges.
   * An infant measured in months is 0, which is exactly what the API wants —
   * it is only a *missing* age that would silently grade them as an adult.
   */
  const ageYears = useMemo(() => {
    const { years, months } = visit.patient.age;
    if (years !== undefined) return years;
    return months !== undefined ? 0 : undefined;
  }, [visit.patient.age]);

  // Debounced so a four-digit reading is one request, not four. The query is
  // built from the readings themselves, so an unchanged form makes no call.
  const query = useMemo(() => {
    const params = new URLSearchParams();
    for (const [field, value] of Object.entries(readings)) {
      if (value !== undefined && value.trim() !== "") params.set(field, value.trim());
    }
    if (params.size > 0 && ageYears !== undefined) params.set("ageYears", String(ageYears));
    return params.toString();
  }, [readings, ageYears]);

  const load = useRef(preview.load);
  load.current = preview.load;

  useEffect(() => {
    if (query === "") return;
    const timer = setTimeout(() => {
      load.current(`/resources/vitals-preview?${query}`);
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  const liveFlags = query === "" ? [] : (preview.data?.preview.flags ?? []);
  const flags = useMemo(() => flagsByField(liveFlags), [liveFlags]);
  const liveBmi = query === "" ? undefined : preview.data?.preview.bmi;

  const set = (field: VitalField) => (value: string) =>
    setReadings((current) => ({ ...current, [field]: value }));
  const valueOf = (field: VitalField) => readings[field] ?? "";

  const bind = (field: VitalField) => ({
    field,
    value: valueOf(field),
    onChange: set(field),
    flags,
    error: fieldError(field),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Vitals"
        description="Observations for this visit. Out-of-range readings are flagged by the clinic's own age-aware ranges."
        backTo={`/visits/${visit.id}`}
        backLabel="Back to the visit"
      />

      <VisitHeader visit={visit} />

      {/* What was actually saved, graded against the patient's record. */}
      {saved && (
        <div className="space-y-3">
          {hasCriticalFlag(saved.flags) && (
            <div
              role="alert"
              className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
              <p>
                <span className="font-medium text-destructive">
                  This set contains a critical reading.
                </span>{" "}
                <span className="text-muted-foreground">
                  The clinic has been notified. Do not leave this patient waiting in the queue —
                  tell the clinician on duty now.
                </span>
              </p>
            </div>
          )}
          <VitalsCard set={saved} highlight />
        </div>
      )}

      {actionData?.message && (
        <div role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionData.message}
        </div>
      )}

      {!canRecord ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Recording vitals is limited to nursing, midwifery and prescribing staff. You can read
            the sets below.
          </CardContent>
        </Card>
      ) : visit.status !== "open" ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            This visit is {visit.status}. Vitals can only be recorded against an open visit.
          </CardContent>
        </Card>
      ) : (
        <Form method="post" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HeartPulseIcon className="size-4 text-muted-foreground" />
                Observations
              </CardTitle>
              <CardDescription>
                Leave anything you did not measure blank. Flags appear as you type.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ReadingField {...bind("temperature")} label="Temperature" />

              {/* Both halves sit together — a blood pressure is one reading. */}
              <div className="grid grid-cols-2 gap-3 sm:col-span-2 lg:col-span-1">
                <ReadingField {...bind("systolic")} label="Systolic" />
                <ReadingField {...bind("diastolic")} label="Diastolic" />
              </div>

              <ReadingField {...bind("pulse")} label="Pulse" />
              <ReadingField {...bind("respiratoryRate")} label="Respiratory rate" />
              <ReadingField {...bind("spo2")} label="SpO₂" />
              <ReadingField {...bind("painScore")} label="Pain score" hint="As the patient reports it." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RulerIcon className="size-4 text-muted-foreground" />
                Measurements
              </CardTitle>
              <CardDescription>
                BMI is computed by the API from weight and height — it is not entered.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ReadingField {...bind("weightKg")} label="Weight" />
              <ReadingField {...bind("heightCm")} label="Height" />
              <ReadingField
                {...bind("muacCm")}
                label="MUAC"
                hint="Mid-upper arm circumference — the malnutrition screen in children."
              />
              <ReadingField {...bind("randomBloodSugar")} label="Random blood sugar" />
              <ReadingField {...bind("fastingBloodSugar")} label="Fasting blood sugar" />

              <Field>
                <FieldLabel>BMI</FieldLabel>
                <output
                  className="flex h-9 items-center rounded-md border border-dashed px-3 text-sm tabular-nums"
                  aria-live="polite"
                >
                  {liveBmi !== undefined ? (
                    liveBmi
                  ) : (
                    <span className="text-muted-foreground">Weight and height</span>
                  )}
                </output>
                <FieldDescription>Computed, not recorded.</FieldDescription>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ActivityIcon className="size-4 text-muted-foreground" />
                Anything else
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field>
                <FieldLabel htmlFor="vitals-notes">Notes</FieldLabel>
                <Textarea
                  id="vitals-notes"
                  name="notes"
                  rows={2}
                  placeholder="Patient unable to stand for height; weight taken seated."
                  aria-invalid={fieldError("notes") ? true : undefined}
                />
                <FieldDescription>
                  How the readings were taken, if it affects how they should be read.
                </FieldDescription>
                <FieldError>{fieldError("notes")}</FieldError>
              </Field>

              {liveFlags.length > 0 && (
                <div className="space-y-2 rounded-lg border bg-muted/40 p-3 dark:bg-muted/20">
                  <p className="text-xs font-medium text-muted-foreground">
                    Flagged so far
                    {preview.data?.ageAware === false && " · graded against adult ranges"}
                  </p>
                  <FlagList flags={liveFlags} />
                </div>
              )}
            </CardContent>
          </Card>

          <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
            <Link
              to={`/visits/${visit.id}`}
              className="text-sm text-muted-foreground hover:underline"
            >
              Cancel
            </Link>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <ClipboardPlusIcon />}
              Save vitals
            </Button>
          </div>
        </Form>
      )}

      {/* Every set on this visit. A recheck is a new set, never an edit. */}
      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold tracking-tight">
          Recorded on this visit
        </h2>
        {sets.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            No vitals recorded yet.
          </p>
        ) : (
          <div className="space-y-3">
            {sets.map((item) => (
              <VitalsCard key={item.id} set={item} highlight={item.id === saved?.id} />
            ))}
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <Link
          to={`/visits/${visit.id}/consultation`}
          className={buttonVariants({ variant: "outline" })}
        >
          Go to the consultation note
        </Link>
      </div>
    </div>
  );
}
