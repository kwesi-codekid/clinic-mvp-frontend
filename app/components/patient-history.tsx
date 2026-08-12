/**
 * Attendance history — the patient's past visits, with what each one
 * concluded (shared by T2.2 and T3.2).
 *
 * Mounted twice: on the patient folder, where it is the record of attendance,
 * and on the visit screen, where it is the context a clinician reads before
 * seeing the patient — when were they last here, and what was found.
 *
 * The diagnosis line is joined from the consultations by `visitId` rather
 * than read off the visit, because a {@link VisitSummary} carries neither the
 * note nor a disposition — and what history is read *for* is what was
 * concluded, not which door the patient left by. A visit with no matching
 * note simply shows without one; the join must never hide an attendance.
 */

import { format } from "date-fns";
import { HistoryIcon } from "lucide-react";
import { Link } from "react-router";

import { StatusPill } from "~/components/directory";
import { VisitStatusPill } from "~/components/visit-header";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { VisitTypes } from "~/models/enums";
import type { Consultation, Diagnosis } from "~/models/consultation";
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
  visits,
  total,
  consultations,
  title = "Attendance history",
  emptyMessage = "No attendance on record yet.",
}: {
  /** Past attendances, newest first. The caller decides scope and limit. */
  visits: VisitSummary[];
  /** Attendances in that scope altogether — the footer's honesty when it exceeds the list. */
  total: number;
  /** Notes to join by `visitId`. Over-fetch rather than under: a missed join loses a diagnosis. */
  consultations: Consultation[];
  title?: string;
  emptyMessage?: string;
}) {
  const noteByVisit = newestNoteByVisit(consultations);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HistoryIcon className="size-4 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {visits.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <>
            <ul className="divide-y">
              {visits.map((visit) => {
                const note = noteByVisit.get(visit.id);
                const diagnoses = note ? orderedDiagnoses(note) : [];

                return (
                  <li key={visit.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <Link
                        to={`/visits/${visit.id}`}
                        className="font-medium hover:underline"
                        suppressHydrationWarning
                      >
                        {format(new Date(visit.arrivedAt), "d MMM yyyy")}
                      </Link>
                      <span className="text-muted-foreground">
                        {VisitTypes.label(visit.type)} ·{" "}
                        <span className="font-mono text-xs">{visit.visitNumber}</span>
                      </span>
                      <VisitStatusPill status={visit.status} />
                      {visit.isNewPatient && <StatusPill tone="muted">First attendance</StatusPill>}
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
                  </li>
                );
              })}
            </ul>

            {total > visits.length && (
              <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                Showing the last {visits.length} of {total} attendances.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
