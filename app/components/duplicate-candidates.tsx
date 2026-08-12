/**
 * Candidate folders that may already belong to the patient being registered
 * (T2.3).
 *
 * The same list appears twice in the flow: quietly, while the clerk is still
 * typing (`POST /patients/check-duplicates`), and firmly, when the API refuses
 * the registration with a `409`. Only the framing changes, so the rows
 * themselves live here.
 *
 * Each row leads with the API's `reasons` rather than its `score`, because a
 * clerk can judge "same Ghana Card number" and cannot judge "0.82". Folders
 * open in a new tab — checking one must never cost someone the form they have
 * half-filled.
 */

import type { ReactNode } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { Link } from "react-router";

import { avatarTint, initialsOf } from "~/components/directory";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";
import { Sexes } from "~/models/enums";
import type { DuplicateCandidate } from "~/models/patient";

/** The API's 0–1 confidence, in the register a clerk reads. */
function confidence(score: number): { label: string; tone: "strong" | "possible" } {
  const percent = Math.round(Math.max(0, Math.min(score, 1)) * 100);
  return { label: `${percent}% match`, tone: score >= 0.8 ? "strong" : "possible" };
}

export function CandidateRow({
  candidate,
  action,
}: {
  candidate: DuplicateCandidate;
  /** Whatever this screen lets the clerk do with the folder. */
  action?: ReactNode;
}) {
  const { patient, reasons } = candidate;
  const { label, tone } = confidence(candidate.score);

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-3">
      <Avatar>
        <AvatarFallback className={cn("text-xs font-semibold uppercase", avatarTint(patient.id))}>
          {initialsOf(patient.firstName, patient.surname)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-48 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{patient.fullName}</span>
          <Badge variant={tone === "strong" ? "default" : "secondary"}>{label}</Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          <span className="font-mono">{patient.folderNumber}</span>
          {" · "}
          {patient.age.display} {Sexes.label(patient.sex)}
          {patient.phoneFormatted ? ` · ${patient.phoneFormatted}` : ""}
          {patient.nhisNumber ? ` · NHIS ${patient.nhisNumber}` : ""}
        </div>
        {reasons.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 pt-0.5">
            {reasons.map((reason) => (
              <li
                key={reason}
                className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {reason}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2">
        {action}
        <Link
          to={`/patients/${patient.id}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          Open folder
          <ExternalLinkIcon className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}

export function CandidatePanel({
  tone,
  title,
  description,
  candidates,
  footer,
  renderAction,
}: {
  tone: "notice" | "blocking";
  title: string;
  description: ReactNode;
  candidates: DuplicateCandidate[];
  /** Actions that apply to the panel as a whole, e.g. the override. */
  footer?: ReactNode;
  renderAction?: (candidate: DuplicateCandidate) => ReactNode;
}) {
  return (
    <section
      className={cn(
        "space-y-3 rounded-xl border p-4",
        tone === "blocking" ? "border-destructive/40 bg-destructive/5" : "bg-muted/40",
      )}
    >
      <div className="space-y-1">
        <h2
          className={cn(
            "font-heading text-sm font-semibold",
            tone === "blocking" && "text-destructive",
          )}
        >
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <div className="space-y-2">
        {candidates.map((candidate) => (
          <CandidateRow
            key={candidate.patient.id}
            candidate={candidate}
            action={renderAction?.(candidate)}
          />
        ))}
      </div>

      {footer}
    </section>
  );
}
