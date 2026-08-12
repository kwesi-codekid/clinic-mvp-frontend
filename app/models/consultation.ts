/**
 * Consultation — the clinical note, its diagnoses, and the trail left by
 * correcting one (T5.2), plus the ICD-10 catalogue and note similarity search
 * that hang off it (T5.3).
 *
 * Modelled from `components.schemas.{Consultation, Diagnosis, DiagnosisInput,
 * Amendment, WriteConsultation, AmendConsultation, Icd10Entry, NoteMatch,
 * NoteSearchResult, NoteIndexResult}`.
 *
 * The rule that shapes every screen here: **a signed note is not editable.**
 * `POST /consultations` writes one and `sign: true` closes it; after that the
 * only way to change what it says is `POST /consultations/{id}/amend`, which
 * appends an {@link Amendment} carrying a reason. There is no `PUT`, and the
 * UI must not offer anything that looks like one — the amendment trail is the
 * record's defence, and silently overwriting a signed note destroys it.
 */

import type { DiagnosisType, NoteSearchMode } from "./enums";
import type { IsoDate, IsoDateTime, ObjectId } from "./primitives";

/* -------------------------------------------------------------------------
   Diagnoses (L0)
   ------------------------------------------------------------------------- */

/**
 * A diagnosis as recorded on a note.
 *
 * `dhims2Group` and `notifiable` are resolved by the API from the ICD-10
 * catalogue — they are not the clinician's to set. Both matter beyond this
 * screen: the group is the line this attendance is tallied under on the DHIMS2
 * return (T13.1), and `notifiable` means the district must be told.
 */
export type Diagnosis = {
  icd10Code: string;
  description: string;
  type: DiagnosisType;
  /** Exactly one diagnosis on a note should carry this. */
  isPrimary: boolean;
  notes?: string;
  /** The DHIMS2 return line this is counted under. Read-only. */
  dhims2Group: string;
  /** Whether the district must be notified. Read-only, and worth shouting. */
  notifiable: boolean;
};

/**
 * A diagnosis being written. Only the code is required — the API fills in the
 * description from the catalogue, and derives `dhims2Group`/`notifiable`.
 */
export type DiagnosisInput = {
  icd10Code: string;
  /** Defaults to the catalogue description. Override only to add specificity. */
  description?: string;
  /** Defaults to `provisional`. */
  type?: DiagnosisType;
  isPrimary?: boolean;
  notes?: string;
};

/** One correction made to a signed note. Append-only; the note keeps them all. */
export type Amendment = {
  at: IsoDateTime;
  byName?: string;
  /** Why the note was corrected. Required by the API — this is the audit. */
  reason: string;
};

/* -------------------------------------------------------------------------
   The note (L1)
   ------------------------------------------------------------------------- */

/** The narrative body of a note — the fields a clinician actually writes. */
export type ConsultationNarrative = {
  presentingComplaint?: string;
  historyOfPresentingComplaint?: string;
  reviewOfSystems?: string;
  pastMedicalHistory?: string;
  examination?: string;
  assessment?: string;
  plan?: string;
};

/** A consultation note. */
export type Consultation = ConsultationNarrative & {
  id: ObjectId;
  visitId: ObjectId;
  patientId: ObjectId;
  clinicianName?: string;
  diagnoses: Diagnosis[];
  /** When the patient is asked back — books the appointment in T12.1. */
  followUpDate?: IsoDate;
  /** Present once signed. Its absence is what makes the note still editable. */
  signedAt?: IsoDateTime;
  /** Oldest first. Non-empty means this note has been corrected since signing. */
  amendments: Amendment[];
  createdAt: IsoDateTime;
};

/* -------------------------------------------------------------------------
   Write models
   ------------------------------------------------------------------------- */

/**
 * Body of `POST /consultations`.
 *
 * `sign: true` closes the note in the same request — the usual case, because a
 * clinician finishing with a patient is finished. Leaving it out saves a draft
 * that can still be written over, which is what the "save and come back" path
 * on a busy clinic day needs.
 */
export type WriteConsultation = ConsultationNarrative & {
  visitId: ObjectId;
  diagnoses?: DiagnosisInput[];
  followUpDate?: IsoDate;
  /** Sign on save. A signed note can only be changed by amendment. */
  sign?: boolean;
};

/**
 * Body of `POST /consultations/{id}/amend`.
 *
 * Same narrative fields, plus a mandatory `reason`. Send the **whole** note as
 * it should now read, not just the changed parts: the amendment replaces the
 * body and records why.
 */
export type AmendConsultation = ConsultationNarrative & {
  diagnoses?: DiagnosisInput[];
  followUpDate?: IsoDate;
  /** Why the note is being corrected. The audit trail is built from this. */
  reason: string;
};

/* -------------------------------------------------------------------------
   ICD-10 catalogue
   ------------------------------------------------------------------------- */

/** One entry in the clinic's ICD-10 subset. */
export type Icd10Entry = {
  code: string;
  description: string;
  category: string;
  /** The line this is tallied under on the DHIMS2 return. */
  dhims2Group: string;
  /** Whether the district must be notified of this diagnosis. */
  notifiable: boolean;
};

/* -------------------------------------------------------------------------
   Note similarity search (T5.3)
   ------------------------------------------------------------------------- */

/** One note the index considered similar to the query. */
export type NoteMatch = {
  consultationId: string;
  patientId: string;
  patientName?: string;
  folderNumber?: string;
  /** Cosine similarity when semantic, text score when lexical. Not comparable across modes. */
  score: number;
  presentingComplaint?: string;
  assessment?: string;
  diagnoses: { icd10Code?: string; description?: string }[];
  recordedAt: IsoDateTime;
};

/**
 * Response of `POST /analytics/notes/search`.
 *
 * `available: false` is a normal state, not an error — the index has not been
 * built yet, and the panel has to say so rather than showing an empty list that
 * reads as "no similar patients". `mode` says how the question was answered;
 * see {@link NoteSearchMode} for why that has to be visible.
 */
export type NoteSearchResult = {
  available: boolean;
  mode: NoteSearchMode;
  query: string;
  /** How many notes were in scope — the denominator behind the result. */
  searchedNotes: number;
  matches: NoteMatch[];
  /** Why nothing came back, when `available` is false. */
  message?: string;
};

/** Response of `POST /analytics/notes/index` — an admin-only reindex. */
export type NoteIndexResult = {
  available: boolean;
  indexed: number;
  /** Notes still unindexed. Non-zero means run it again. */
  remaining: number;
  message: string;
};

/* -------------------------------------------------------------------------
   Derived views
   ------------------------------------------------------------------------- */

/**
 * The narrative fields in the order a clinician works through them, with the
 * labels and prompts both the editor and the read view use.
 *
 * One declaration so the two cannot drift: a note rendered back must read in
 * the same order it was written.
 */
export const NOTE_SECTIONS = [
  {
    field: "presentingComplaint",
    label: "Presenting complaint",
    hint: "What brought the patient in, in their words.",
  },
  {
    field: "historyOfPresentingComplaint",
    label: "History of presenting complaint",
    hint: "Onset, duration, character, what makes it better or worse.",
  },
  {
    field: "reviewOfSystems",
    label: "Review of systems",
    hint: "Anything else found on systematic enquiry.",
  },
  {
    field: "pastMedicalHistory",
    label: "Past medical history",
    hint: "Previous illnesses, surgery, medication, family and social history.",
  },
  {
    field: "examination",
    label: "Examination",
    hint: "General and system-specific findings. Vitals are recorded separately.",
  },
  {
    field: "assessment",
    label: "Assessment",
    hint: "The clinical impression. Code it below as a diagnosis.",
  },
  {
    field: "plan",
    label: "Plan",
    hint: "Investigations, treatment, advice and follow-up.",
  },
] as const satisfies ReadonlyArray<{
  field: keyof ConsultationNarrative;
  label: string;
  hint: string;
}>;

/**
 * Whether the note is closed to direct editing.
 *
 * The single check every screen keys off — an unsigned note is a draft and can
 * be written over; a signed one may only be amended.
 */
export function isSigned(note: Pick<Consultation, "signedAt">): boolean {
  return note.signedAt !== undefined;
}

/** The primary diagnosis, if one was marked. */
export function primaryDiagnosis(note: Pick<Consultation, "diagnoses">): Diagnosis | undefined {
  return note.diagnoses.find((diagnosis) => diagnosis.isPrimary);
}

/**
 * Diagnoses the district has to be told about.
 *
 * Surfaced at entry time rather than left to Phase 13 reporting: the point of
 * notifying is that it happens while the patient is still reachable.
 */
export function notifiableDiagnoses(note: Pick<Consultation, "diagnoses">): Diagnosis[] {
  return note.diagnoses.filter((diagnosis) => diagnosis.notifiable);
}

/** True when nothing has been written in the note body yet. */
export function isNarrativeEmpty(narrative: ConsultationNarrative): boolean {
  return NOTE_SECTIONS.every(({ field }) => (narrative[field] ?? "").trim() === "");
}

/**
 * Problems that should stop a note being **signed**, in the clinician's words.
 *
 * Kept here rather than in the route so the same rules apply to writing and to
 * amending. Deliberately not enforced on an unsigned draft — a half-written
 * note is a legitimate thing to save when a patient is called away.
 */
export function signingProblems(input: {
  narrative: ConsultationNarrative;
  diagnoses: readonly DiagnosisInput[];
}): string[] {
  const problems: string[] = [];
  const { narrative, diagnoses } = input;

  if (isNarrativeEmpty(narrative)) {
    problems.push("The note is empty.");
  }
  if ((narrative.assessment ?? "").trim() === "") {
    problems.push("An assessment is needed before signing.");
  }
  if (diagnoses.length === 0) {
    problems.push("Code at least one diagnosis — the claim and the DHIMS2 return are built from it.");
  }

  const primaries = diagnoses.filter((diagnosis) => diagnosis.isPrimary);
  if (diagnoses.length > 0 && primaries.length === 0) {
    problems.push("Mark one diagnosis as primary.");
  }
  if (primaries.length > 1) {
    problems.push("Only one diagnosis can be primary.");
  }
  // A differential is one of several possibilities under consideration, so it
  // cannot also be the conclusion this attendance is reported and claimed on.
  if (primaries.some((diagnosis) => diagnosis.type === "differential")) {
    problems.push("A differential cannot be the primary diagnosis.");
  }

  const codes = diagnoses.map((diagnosis) => diagnosis.icd10Code);
  if (new Set(codes).size !== codes.length) {
    problems.push("The same diagnosis has been added twice.");
  }

  return problems;
}
