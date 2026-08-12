/**
 * The consultation note (T5.2), with the similar-presentations panel beside it
 * (T5.3).
 *
 * The whole screen turns on one fact: **a signed note is not editable.**
 *
 * - No note yet, or an unsigned one → the editor. `POST /consultations` is an
 *   upsert keyed on the visit, so "save and come back" is the same call as
 *   "write it"; the whole note goes up each time, not the changed fields.
 * - Signed → the note reads back, and the only way in is `Amend`, which asks
 *   for a reason and appends to a trail that is never removed. The screen does
 *   not offer an edit affordance on a signed note at all — not a disabled one,
 *   not one behind a confirm. What was written stays written.
 *
 * The last set of vitals and the patient's allergies sit at the top because a
 * consulting room needs them in view, not one screen away.
 */

import { useState } from "react";
import { format } from "date-fns";
import {
  CheckCircle2Icon,
  FileSignatureIcon,
  HistoryIcon,
  Loader2Icon,
  LockIcon,
  PencilLineIcon,
  SaveIcon,
  SirenIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { data, Form, Link, redirect, useNavigation } from "react-router";

import {
  Icd10Picker,
  toDiagnosisDraft,
  toDiagnosisInput,
  type DiagnosisDraft,
} from "~/components/icd10-picker";
import { PageHeader } from "~/components/page-header";
import { SimilarNotes } from "~/components/similar-notes";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { FlagList } from "~/components/vital-flags";
import { VisitHeader } from "~/components/visit-header";
import { ApiError, describeApiError } from "~/lib/api/client";
import {
  amendConsultation,
  getVisitConsultation,
  writeConsultation,
} from "~/lib/api/consultations";
import { getPatient } from "~/lib/api/patients";
import { throwRouteError } from "~/lib/api/route-error";
import { listVitals } from "~/lib/api/vitals";
import { getVisit } from "~/lib/api/visits";
import { requireStaff, requireStaffAction } from "~/lib/auth.server";
import {
  isSigned,
  NOTE_SECTIONS,
  notifiableDiagnoses,
  signingProblems,
  type AmendConsultation,
  type Consultation,
  type ConsultationNarrative,
  type DiagnosisInput,
  type WriteConsultation,
} from "~/models/consultation";
import { DiagnosisTypes, type Role } from "~/models/enums";
import { formatBloodPressure } from "~/models/vitals";
import { parseObjectId } from "~/models/primitives";

import type { Route } from "./+types/visit-consultation";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.visit.patient.fullName;
  return [{ title: name ? `Consultation · ${name} · Clinic` : "Consultation · Clinic" }];
}

/** Who `POST /consultations` and its amendment path accept. */
const WRITING_ROLES: readonly Role[] = ["doctor", "physician_assistant", "midwife", "admin"];

/* -------------------------------------------------------------------------
   Loader
   ------------------------------------------------------------------------- */

export async function loader({ request, params }: Route.LoaderArgs) {
  const { accessToken, staff } = await requireStaff(request);
  const visitId = parseObjectId(params.visitId, "visit id");
  const opts = { token: accessToken };

  try {
    const visit = await getVisit(visitId, opts);

    const [note, vitalsPage, patient] = await Promise.all([
      getVisitConsultation(visitId, opts),
      listVitals({ visitId, limit: 1, sort: "-takenAt" }, opts),
      // For the allergy banner. The visit only carries a PatientSummary, and
      // allergies are the one thing that must not be a click away here.
      getPatient(visit.patient.id, opts),
    ]);

    return {
      visit,
      note,
      latestVitals: vitalsPage.items[0],
      allergies: patient.allergies ?? [],
      canWrite: staff.roles.some((role) => WRITING_ROLES.includes(role)),
      amending: new URL(request.url).searchParams.get("amend") === "1",
    };
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

function readNarrative(form: FormData): ConsultationNarrative {
  const narrative: ConsultationNarrative = {};
  for (const { field } of NOTE_SECTIONS) {
    narrative[field] = text(form, field);
  }
  return narrative;
}

/**
 * The coded diagnoses.
 *
 * Posted as parallel lists with a single `primaryIndex` picking the primary —
 * the same shape the check-in and patient forms use for repeating blocks.
 */
function readDiagnoses(form: FormData): DiagnosisInput[] {
  const codes = form.getAll("diagnosisCode");
  const descriptions = form.getAll("diagnosisDescription");
  const types = form.getAll("diagnosisType");
  const notes = form.getAll("diagnosisNotes");
  const primaryIndex = Number(form.get("primaryIndex"));

  return codes.flatMap((code, index) => {
    if (typeof code !== "string" || code.trim() === "") return [];
    const type = types[index];
    const note = notes[index];

    return [
      {
        icd10Code: code,
        description: typeof descriptions[index] === "string" ? descriptions[index] : undefined,
        type: DiagnosisTypes.is(type) ? type : undefined,
        isPrimary: index === primaryIndex,
        notes: typeof note === "string" && note.trim() !== "" ? note.trim() : undefined,
      },
    ];
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { accessToken, setCookie } = await requireStaffAction(request);
  const visitId = parseObjectId(params.visitId, "visit id");
  const form = await request.formData();

  const opts = { token: accessToken };
  const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;
  const fail = (message: string, fieldErrors: Record<string, string> = {}, status = 400) =>
    data({ message, fieldErrors }, { status, headers });

  const intent = form.get("intent");
  const narrative = readNarrative(form);
  const diagnoses = readDiagnoses(form);
  const followUpDate = text(form, "followUpDate");

  // Signing is the point of no return, so the note has to hold together first.
  // A draft is not checked at all — a half-written note is a legitimate thing
  // to save when a patient is called away.
  if (intent === "sign" || intent === "amend") {
    const problems = signingProblems({ narrative, diagnoses });
    if (problems.length > 0) {
      return fail(problems.join(" "));
    }
  }

  try {
    if (intent === "amend") {
      const noteId = form.get("noteId");
      const reason = text(form, "reason");
      if (typeof noteId !== "string" || noteId === "") {
        return fail("There is no note to amend.");
      }
      if (!reason) {
        return fail("Say why the note is being corrected.", {
          "body.reason": "A reason is required — it is what the amendment records.",
        });
      }

      const input: AmendConsultation = { ...narrative, diagnoses, followUpDate, reason };
      await amendConsultation(parseObjectId(noteId, "note id"), input, opts);

      return redirect(`/visits/${visitId}/consultation?amended=1`, { headers });
    }

    const input: WriteConsultation = {
      visitId,
      ...narrative,
      diagnoses,
      followUpDate,
      sign: intent === "sign",
    };
    await writeConsultation(input, opts);

    return redirect(`/visits/${visitId}/consultation?${intent === "sign" ? "signed=1" : "saved=1"}`, {
      headers,
    });
  } catch (error) {
    if (!ApiError.is(error)) throw error;

    const message =
      error.status === 409
        ? "This note has already been signed. Use Amend to correct it."
        : describeApiError(error).description;

    return fail(message, error.fieldErrors(), error.status >= 400 ? error.status : 502);
  }
}

/* -------------------------------------------------------------------------
   Pieces
   ------------------------------------------------------------------------- */

/** The note as it reads back, once signed. */
function NoteReadView({ note }: { note: Consultation }) {
  const written = NOTE_SECTIONS.filter(({ field }) => (note[field] ?? "").trim() !== "");

  return (
    <div className="space-y-5">
      {written.length === 0 ? (
        <p className="text-sm text-muted-foreground">This note has no narrative.</p>
      ) : (
        written.map(({ field, label }) => (
          <div key={field} className="space-y-1">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {label}
            </h3>
            <p className="text-sm whitespace-pre-wrap">{note[field]}</p>
          </div>
        ))
      )}

      {note.diagnoses.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Diagnoses
          </h3>
          <ul className="space-y-2">
            {note.diagnoses.map((diagnosis) => (
              <li key={diagnosis.icd10Code} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold">{diagnosis.icd10Code}</span>
                  {diagnosis.isPrimary && <Badge variant="secondary">Primary</Badge>}
                  <Badge variant="outline">{DiagnosisTypes.labelOr(diagnosis.type)}</Badge>
                  {diagnosis.notifiable && (
                    <Badge variant="destructive" className="gap-1">
                      <SirenIcon className="size-3" />
                      Notifiable
                    </Badge>
                  )}
                </div>
                <p className="pt-1 text-sm font-medium">{diagnosis.description}</p>
                {diagnosis.notes && (
                  <p className="text-sm text-muted-foreground">{diagnosis.notes}</p>
                )}
                <p className="pt-1 text-xs text-muted-foreground">
                  DHIMS2: {diagnosis.dhims2Group}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {note.followUpDate && (
        <div className="space-y-1">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Review
          </h3>
          <p className="text-sm" suppressHydrationWarning>
            {format(new Date(note.followUpDate), "d MMM yyyy")}
          </p>
        </div>
      )}
    </div>
  );
}

/** Every correction made since signing. Append-only, and never hidden. */
function AmendmentTrail({ note }: { note: Consultation }) {
  if (note.amendments.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HistoryIcon className="size-4 text-muted-foreground" />
          Amendments
        </CardTitle>
        <CardDescription>
          This note has been corrected since it was signed. Each entry says why.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {note.amendments.map((amendment, index) => (
            <li key={`${amendment.at}-${index}`} className="border-l-2 pl-3 text-sm">
              <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                {format(new Date(amendment.at), "d MMM yyyy, HH:mm")}
                {amendment.byName ? ` · ${amendment.byName}` : ""}
              </p>
              <p>{amendment.reason}</p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

export default function VisitConsultationPage({ loaderData, actionData }: Route.ComponentProps) {
  const { visit, note, latestVitals, allergies, canWrite, amending } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.formData != null;
  const submitting = navigation.formData?.get("intent");

  const signed = note !== undefined && isSigned(note);
  const editing = !signed || amending;

  const [diagnoses, setDiagnoses] = useState<DiagnosisDraft[]>(
    () => note?.diagnoses.map(toDiagnosisDraft) ?? [],
  );

  const fieldError = (field: string) => actionData?.fieldErrors?.[`body.${field}`];
  const notifiable = note ? notifiableDiagnoses(note) : [];
  const bloodPressure = latestVitals ? formatBloodPressure(latestVitals) : undefined;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Consultation"
        description={
          signed && !amending
            ? "This note is signed. Corrections are recorded as amendments."
            : "The clinical record for this attendance."
        }
        backTo={`/visits/${visit.id}`}
        backLabel="Back to the visit"
      />

      <VisitHeader visit={visit}>
        <Link
          to={`/visits/${visit.id}/vitals`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Vitals
        </Link>
      </VisitHeader>

      {/* Allergies first: the one thing that must never be a click away. */}
      {allergies.length > 0 && (
        <div
          role="alert"
          className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-destructive">Allergies on this folder</p>
            <p className="text-muted-foreground">
              {allergies
                .map((allergy) =>
                  [allergy.substance, allergy.reaction].filter(Boolean).join(" — "),
                )
                .join(" · ")}
            </p>
          </div>
        </div>
      )}

      {actionData?.message && (
        <div role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionData.message}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {/* Vitals in view rather than one screen away. */}
          {latestVitals && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Latest vitals</CardTitle>
                <CardDescription suppressHydrationWarning>
                  {format(new Date(latestVitals.takenAt), "d MMM, HH:mm")}
                  {latestVitals.takenByName ? ` · ${latestVitals.takenByName}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <FlagList flags={latestVitals.flags} />
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                  {[
                    ["Temp", latestVitals.temperature && `${latestVitals.temperature} °C`],
                    ["BP", bloodPressure],
                    ["Pulse", latestVitals.pulse && `${latestVitals.pulse} bpm`],
                    ["SpO₂", latestVitals.spo2 && `${latestVitals.spo2}%`],
                  ]
                    .filter((row): row is [string, string] => Boolean(row[1]))
                    .map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-xs text-muted-foreground">{label}</dt>
                        <dd className="font-medium tabular-nums">{value}</dd>
                      </div>
                    ))}
                </dl>
              </CardContent>
            </Card>
          )}

          {signed && !amending ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <LockIcon className="size-4 text-muted-foreground" />
                    Signed note
                    {note.amendments.length > 0 && (
                      <Badge variant="outline">
                        Amended {note.amendments.length}{" "}
                        {note.amendments.length === 1 ? "time" : "times"}
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription suppressHydrationWarning>
                    {note.clinicianName ? `${note.clinicianName} · ` : ""}
                    signed {note.signedAt && format(new Date(note.signedAt), "d MMM yyyy, HH:mm")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {notifiable.length > 0 && (
                    <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                      <SirenIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                      <p>
                        <span className="font-medium text-destructive">
                          Notifiable {notifiable.length === 1 ? "diagnosis" : "diagnoses"}.
                        </span>{" "}
                        <span className="text-muted-foreground">
                          The district must be told: {notifiable.map((d) => d.description).join(", ")}.
                        </span>
                      </p>
                    </div>
                  )}

                  <NoteReadView note={note} />

                  {canWrite && (
                    <div className="flex justify-end border-t pt-4">
                      <Link
                        to={`/visits/${visit.id}/consultation?amend=1`}
                        className={buttonVariants({ variant: "outline" })}
                      >
                        <PencilLineIcon />
                        Amend this note
                      </Link>
                    </div>
                  )}
                </CardContent>
              </Card>

              <AmendmentTrail note={note} />
            </>
          ) : !canWrite ? (
            <Card>
              <CardContent className="py-6 text-sm text-muted-foreground">
                Writing consultation notes is limited to prescribing clinicians. Nothing has been
                written for this visit yet.
              </CardContent>
            </Card>
          ) : (
            <Form method="post" className="space-y-6">
              {amending && note && <input type="hidden" name="noteId" value={note.id} />}

              {amending && (
                <Card className="border-amber-500/40">
                  <CardHeader>
                    <CardTitle className="text-base">Amending a signed note</CardTitle>
                    <CardDescription>
                      The text below replaces what the note says. The previous wording is kept, and
                      the reason you give is recorded against it permanently.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Field>
                      <FieldLabel htmlFor="note-reason">Reason for the correction</FieldLabel>
                      <Input
                        id="note-reason"
                        name="reason"
                        placeholder="Lab result returned after signing; assessment revised."
                        aria-invalid={fieldError("reason") ? true : undefined}
                      />
                      <FieldError>{fieldError("reason")}</FieldError>
                    </Field>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">The note</CardTitle>
                  <CardDescription>
                    Written in the order it is taken. Nothing here is required to save a draft.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {NOTE_SECTIONS.map(({ field, label, hint }) => (
                    <Field key={field}>
                      <FieldLabel htmlFor={`note-${field}`}>{label}</FieldLabel>
                      <Textarea
                        id={`note-${field}`}
                        name={field}
                        rows={field === "presentingComplaint" ? 2 : 3}
                        defaultValue={note?.[field] ?? ""}
                        aria-invalid={fieldError(field) ? true : undefined}
                      />
                      <FieldDescription>{hint}</FieldDescription>
                      <FieldError>{fieldError(field)}</FieldError>
                    </Field>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Diagnoses</CardTitle>
                  <CardDescription>
                    Coded to ICD-10. The primary one is what this attendance is claimed and
                    reported on.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Icd10Picker value={diagnoses} onChange={setDiagnoses} disabled={busy} />

                  {diagnoses.some((diagnosis) => diagnosis.notifiable) && (
                    <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                      <SirenIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                      <p>
                        <span className="font-medium text-destructive">Notifiable diagnosis.</span>{" "}
                        <span className="text-muted-foreground">
                          The district has to be told about this one. Start that now rather than at
                          month end.
                        </span>
                      </p>
                    </div>
                  )}

                  <Field className="sm:max-w-xs">
                    <FieldLabel htmlFor="note-followup">Review date</FieldLabel>
                    <Input
                      id="note-followup"
                      name="followUpDate"
                      type="date"
                      defaultValue={note?.followUpDate ?? ""}
                      aria-invalid={fieldError("followUpDate") ? true : undefined}
                    />
                    <FieldDescription>
                      When the patient should come back. Books the appointment in Phase 12.
                    </FieldDescription>
                    <FieldError>{fieldError("followUpDate")}</FieldError>
                  </Field>
                </CardContent>
              </Card>

              <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
                {amending ? (
                  <>
                    <Link
                      to={`/visits/${visit.id}/consultation`}
                      className="text-sm text-muted-foreground hover:underline"
                    >
                      Cancel
                    </Link>
                    <Button type="submit" name="intent" value="amend" disabled={busy}>
                      {busy ? <Loader2Icon className="animate-spin" /> : <FileSignatureIcon />}
                      Record the amendment
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="mr-auto text-xs text-muted-foreground">
                      A draft can be changed. Signing closes the note.
                    </span>
                    <Button
                      type="submit"
                      name="intent"
                      value="draft"
                      variant="outline"
                      disabled={busy}
                    >
                      {busy && submitting === "draft" ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <SaveIcon />
                      )}
                      Save draft
                    </Button>
                    <Button type="submit" name="intent" value="sign" disabled={busy}>
                      {busy && submitting === "sign" ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <CheckCircle2Icon />
                      )}
                      Sign and close
                    </Button>
                  </>
                )}
              </div>
            </Form>
          )}
        </div>

        {/* T5.3 — beside the note, not buried under it. */}
        <aside className="space-y-6 lg:sticky lg:top-4 lg:self-start">
          <SimilarNotes seed={note?.presentingComplaint ?? visit.chiefComplaint} />
        </aside>
      </div>
    </div>
  );
}
