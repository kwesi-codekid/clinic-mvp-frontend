/**
 * Vitals — the observations taken before anyone is seen (T5.1).
 *
 * Modelled from `components.schemas.{Vitals, VitalFlag, RecordVitals,
 * VitalsPreview}`.
 *
 * Three things about this endpoint shape the UI more than the fields do:
 *
 * 1. **Flagging is the server's job.** `Vitals.flags` is computed on write and
 *    is *age-aware* — a pulse of 120 is a warning in an adult and unremarkable
 *    in a toddler. There is no client-side range table here on purpose; the one
 *    in the API is the one the clinic is accountable to. See
 *    {@link VITAL_BOUNDS}, which are input sanity limits, **not** normal ranges.
 * 2. **A flag only exists when something is worth saying.** There is no
 *    `normal` severity — an unremarkable reading simply produces no flag. So
 *    an empty `flags` array means "nothing to report", never "not checked".
 * 3. **Vitals are their own resource.** They are posted to `/vitals` with
 *    `visitId` in the body, not nested under the visit, and one visit can carry
 *    several sets — a fever rechecked an hour later is a second set, not an
 *    edit. Nothing here is updatable.
 */

import type { VitalFlagSeverity } from "./enums";
import type { IsoDateTime, ObjectId } from "./primitives";

/* -------------------------------------------------------------------------
   Leaf objects (L0)
   ------------------------------------------------------------------------- */

/**
 * One reading the API considered worth flagging.
 *
 * `field` names the reading it came from (`temperature`, `systolic`, `spo2` …),
 * which is what lets the form put the flag against the input that caused it
 * rather than in a list at the bottom — see {@link flagsByField}.
 */
export type VitalFlag = {
  /** The {@link RecordVitals} key this flag belongs to. */
  field: string;
  /** Ready-to-render wording, e.g. "Fever". Do not compose your own. */
  label: string;
  severity: VitalFlagSeverity;
  /** The value that triggered it, in the reading's own unit. */
  value: number;
};

/* -------------------------------------------------------------------------
   The reading (L1)
   ------------------------------------------------------------------------- */

/** One complete set of observations, as stored. */
export type Vitals = {
  id: ObjectId;
  visitId: ObjectId;
  patientId: ObjectId;
  /** Degrees Celsius. */
  temperature?: number;
  systolic?: number;
  diastolic?: number;
  /** Pre-formatted `120/80` — render this rather than joining the two. */
  bloodPressure?: string;
  pulse?: number;
  respiratoryRate?: number;
  spo2?: number;
  weightKg?: number;
  heightCm?: number;
  /** Computed by the API from weight and height. Never recompute it here. */
  bmi?: number;
  /** mmol/L. */
  randomBloodSugar?: number;
  /** mmol/L. */
  fastingBloodSugar?: number;
  /** Mid-upper arm circumference, cm — the malnutrition screen in children. */
  muacCm?: number;
  /** 0–10, as the patient reports it. */
  painScore?: number;
  /** Computed on write, age-aware. Empty means nothing was out of range. */
  flags: VitalFlag[];
  notes?: string;
  takenByName?: string;
  takenAt: IsoDateTime;
};

/* -------------------------------------------------------------------------
   Write models
   ------------------------------------------------------------------------- */

/** The observations themselves — every one optional, shared by write and preview. */
export type VitalReadings = {
  /** Degrees Celsius. */
  temperature?: number;
  systolic?: number;
  diastolic?: number;
  pulse?: number;
  respiratoryRate?: number;
  spo2?: number;
  weightKg?: number;
  heightCm?: number;
  randomBloodSugar?: number;
  fastingBloodSugar?: number;
  muacCm?: number;
  /** 0–10. */
  painScore?: number;
  notes?: string;
};

/**
 * Body of `POST /vitals`.
 *
 * Only `visitId` is required: a nurse who could only get a temperature before
 * the patient was called records a temperature, and the set is still valid.
 */
export type RecordVitals = VitalReadings & {
  visitId: ObjectId;
};

/**
 * Body of `POST /vitals/preview`.
 *
 * The same readings without a visit — so the API cannot look the patient up,
 * and **cannot apply paediatric ranges unless you send `ageYears`**. Omitting
 * it silently grades a two-year-old against adult ranges, which is the one way
 * this endpoint can mislead. {@link previewInput} exists so that cannot be
 * forgotten.
 */
export type PreviewVitals = VitalReadings & {
  ageYears?: number;
};

/**
 * Response of `POST /vitals/preview` — what *would* be flagged, without saving.
 *
 * The spec leaves `flags[]` unschema'd; it carries {@link VitalFlag} objects,
 * the same ones a saved set comes back with.
 */
export type VitalsPreview = {
  bmi?: number;
  flags: VitalFlag[];
};

/* -------------------------------------------------------------------------
   Input bounds
   ------------------------------------------------------------------------- */

/**
 * Accepted range per reading, from the API's own request schema.
 *
 * **These are not normal ranges** — they are the limits outside which a value
 * is a typo rather than an observation (a temperature of 4°C, a pulse of 2000).
 * Use them for `min`/`max` on the inputs so a slipped decimal is caught at the
 * keyboard; leave every judgement about what is *clinically* out of range to
 * the flags the server returns.
 */
export const VITAL_BOUNDS = {
  temperature: { min: 25, max: 45, step: 0.1, unit: "°C" },
  systolic: { min: 40, max: 300, step: 1, unit: "mmHg" },
  diastolic: { min: 20, max: 200, step: 1, unit: "mmHg" },
  pulse: { min: 20, max: 250, step: 1, unit: "bpm" },
  respiratoryRate: { min: 4, max: 90, step: 1, unit: "/min" },
  spo2: { min: 30, max: 100, step: 1, unit: "%" },
  weightKg: { min: 0.3, max: 400, step: 0.1, unit: "kg" },
  heightCm: { min: 20, max: 250, step: 0.5, unit: "cm" },
  randomBloodSugar: { min: 0.5, max: 50, step: 0.1, unit: "mmol/L" },
  fastingBloodSugar: { min: 0.5, max: 50, step: 0.1, unit: "mmol/L" },
  muacCm: { min: 5, max: 50, step: 0.1, unit: "cm" },
  painScore: { min: 0, max: 10, step: 1, unit: "/10" },
} as const satisfies Record<
  keyof Omit<VitalReadings, "notes">,
  { min: number; max: number; step: number; unit: string }
>;

export type VitalField = keyof typeof VITAL_BOUNDS;

/* -------------------------------------------------------------------------
   Derived views
   ------------------------------------------------------------------------- */

/**
 * Flags grouped by the reading that produced them, so an input can render its
 * own. A reading can carry more than one.
 */
export function flagsByField(flags: readonly VitalFlag[]): Map<string, VitalFlag[]> {
  const grouped = new Map<string, VitalFlag[]>();
  for (const flag of flags) {
    const existing = grouped.get(flag.field);
    if (existing) existing.push(flag);
    else grouped.set(flag.field, [flag]);
  }
  return grouped;
}

/**
 * The loudest severity in a set, or `undefined` when nothing was flagged.
 *
 * What the worklist row and the visit header key their tint off — one glance
 * has to say whether this patient can wait.
 */
export function worstSeverity(flags: readonly VitalFlag[]): VitalFlagSeverity | undefined {
  if (flags.some((flag) => flag.severity === "critical")) return "critical";
  if (flags.some((flag) => flag.severity === "warning")) return "warning";
  return flags.length > 0 ? "info" : undefined;
}

/**
 * Whether this set contains a reading that should not be left in a queue.
 *
 * The API pushes these to the ordering clinician over the socket; until T0.5
 * lands, this is what the entry screen uses to say so on the spot.
 */
export function hasCriticalFlag(flags: readonly VitalFlag[]): boolean {
  return flags.some((flag) => flag.severity === "critical");
}

/** `120/80`, falling back to the parts when the API sent no formatted string. */
export function formatBloodPressure(vitals: Pick<Vitals, "bloodPressure" | "systolic" | "diastolic">): string | undefined {
  if (vitals.bloodPressure) return vitals.bloodPressure;
  if (vitals.systolic === undefined || vitals.diastolic === undefined) return undefined;
  return `${vitals.systolic}/${vitals.diastolic}`;
}

/** True when no observation at all was recorded — only a note, or nothing. */
export function isEmptyReading(readings: VitalReadings): boolean {
  return (Object.keys(VITAL_BOUNDS) as VitalField[]).every(
    (field) => readings[field] === undefined,
  );
}
