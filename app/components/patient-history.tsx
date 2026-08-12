/**
 * Attendance history — the patient's past visits, with what each one
 * concluded (shared by T2.2 and T3.2).
 *
 * Mounted twice: on the patient folder, where it is the record of attendance,
 * and on the visit screen, where it is the context a clinician reads before
 * seeing the patient — when were they last here, and what was found.
 *
 * The scope is enforced here, not merely requested upstream: the loaders ask
 * the API for one patient's visits, but a row belonging to anyone else is
 * dropped before it renders. Another patient's attendance appearing in this
 * card is a privacy breach, so the guarantee cannot live on the API alone.
 *
 * The diagnosis line is joined from the consultations by `visitId` rather
 * than read off the visit, because a {@link VisitSummary} carries neither the
 * note nor a disposition — and what history is read *for* is what was
 * concluded, not which door the patient left by. A visit with no matching
 * note simply shows without one; the join must never hide an attendance.
 */

import { format } from "date-fns";
import { ChevronRightIcon, HistoryIcon } from "lucide-react";
import { Link } from "react-router";

import { StatusPill } from "~/components/directory";
import { VisitStatusPill } from "~/components/visit-header";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { VisitTypes } from "~/models/enums";
import type { Consultation, Diagnosis } from "~/models/consultation";
import type { ObjectId } from "~/models/primitives";
import type { VisitSummary } from "~/models/visit";

/**
 * The newest note per visit.
 *
 * The caller fetches notes newest-first, and a visit is expected to carry one
 * — but drafts and amendments can leave more, so first-wins keeps the current
 * reading of each attendance.
 */
function newestNoteByVisit(consultations: readonly Consultation[]): Map<string, Consultation> {
  const byVisit = new Map<string, Consultation>();
  for (const note of consultations) {
    if (!byVisit.has(note.visitId)) byVisit.set(note.visitId, note);
  }
  return byVisit;
}

/** Primary first — it is the conclusion the attendance was reported on. */
function orderedDiagnoses(note: Consultation): Diagnosis[] {
  return [...note.diagnoses].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}

export function PatientHistory({
  patientId,
  visits,
  total,
  consultations,
  title = "Attendance history",
  emptyMessage = "No attendance on record yet.",
}: {
  /** Whose history this is. Rows for any other patient are never rendered. */
  patientId: ObjectId;
  /** Past attendances, newest first. The caller decides sort and limit. */
  visits: VisitSummary[];
  /** Attendances in that scope altogether — the footer's honesty when it exceeds the list. */
  total: number;
  /** Notes to join by `visitId`. Over-fetch rather than under: a missed join loses a diagnosis. */
  consultations: Consultation[];
  title?: string;
  emptyMessage?: string;
}) {
  const noteByVisit = newestNoteByVisit(consultations);

  const own = visits.filter((visit) => visit.patient.id === patientId);
  // A dropped row means the server counted strangers too, so its total is
  // no longer this patient's — fall back to what is actually shown.
  const ownTotal = own.length === visits.length ? total : own.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HistoryIcon className="size-4 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {own.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <>
            <ul className="divide-y">
              {own.map((visit) => {
                const note = noteByVisit.get(visit.id);
                const diagnoses = note ? orderedDiagnoses(note) : [];

                return (
                  // The whole row opens the visit — the overlay link keeps the
                  // markup free of nested anchors while the pills stay inert.
                  <li
                    key={visit.id}
                    className="group relative flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className="font-medium group-hover:underline" suppressHydrationWarning>
                          {format(new Date(visit.arrivedAt), "d MMM yyyy")}
                        </span>
                        <span className="text-muted-foreground">
                          {VisitTypes.label(visit.type)} ·{" "}
                          <span className="font-mono text-xs">{visit.visitNumber}</span>
                        </span>
                        <VisitStatusPill status={visit.status} />
                        {visit.isNewPatient && (
                          <StatusPill tone="muted">First attendance</StatusPill>
                        )}
                      </div>

                      {visit.chiefComplaint && (
                        <p className="text-sm text-muted-foreground">{visit.chiefComplaint}</p>
                      )}

                      {diagnoses.length > 0 && (
                        <p className="text-sm">
                          {diagnoses.map((diagnosis, index) => (
                            <span key={diagnosis.icd10Code}>
                              {index > 0 && <span className="text-muted-foreground"> · </span>}
                              <span className={diagnosis.isPrimary ? "font-medium" : undefined}>
                                {diagnosis.description}
                              </span>
                              <span className="font-mono text-xs text-muted-foreground">
                                {" "}
                                {diagnosis.icd10Code}
                              </span>
                            </span>
                          ))}
                        </p>
                      )}
                    </div>

                    <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />

                    <Link
                      to={`/visits/${visit.id}`}
                      aria-label={`Open visit ${visit.visitNumber}`}
                      className="absolute inset-0"
                    />
                  </li>
                );
              })}
            </ul>

            {ownTotal > own.length && (
              <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                Showing the last {own.length} of {ownTotal} attendances.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
