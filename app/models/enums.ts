/**
 * Closed value sets from the Clinic Management API.
 *
 * Every set is a const object mapping the **wire value** (the exact string the
 * API sends and accepts) to its **display label**. That gives us three things
 * from one declaration: a union type, an ordered list for rendering selects,
 * and the label — so no component ever hand-writes `tds` → "Three times daily".
 *
 * Wire values are lower_snake_case and must never be changed to suit the UI.
 */

type EnumDef<L extends Record<string, string>> = {
  /** Wire value → display label. */
  readonly labels: L;
  /** Wire values in display order. */
  readonly values: ReadonlyArray<Extract<keyof L, string>>;
  /** Narrows an unknown string coming from a URL param or form field. */
  is(value: unknown): value is Extract<keyof L, string>;
  /** Display label for a known value. */
  label(value: Extract<keyof L, string>): string;
  /** Display label for an unvalidated value; falls back to the raw string. */
  labelOr(value: string): string;
  /** `[{ value, label }]`, ready for a `<Select>` or radio group. */
  options(): ReadonlyArray<{ value: Extract<keyof L, string>; label: string }>;
};

function defineEnum<const L extends Record<string, string>>(labels: L): EnumDef<L> {
  type Value = Extract<keyof L, string>;
  const values = Object.keys(labels) as Value[];

  return {
    labels,
    values,
    is(value: unknown): value is Value {
      return typeof value === "string" && Object.hasOwn(labels, value);
    },
    label(value: Value) {
      return labels[value];
    },
    labelOr(value: string) {
      return Object.hasOwn(labels, value) ? labels[value as Value] : value;
    },
    options() {
      return values.map((value) => ({ value, label: labels[value] }));
    },
  };
}

/* -------------------------------------------------------------------------
   Identity — these drive navigation and permissions everywhere
   ------------------------------------------------------------------------- */

/** A staff role. Staff may hold several. */
export const Roles = defineEnum({
  admin: "Administrator",
  records: "Records",
  nurse: "Nurse",
  doctor: "Doctor",
  physician_assistant: "Physician Assistant",
  midwife: "Midwife",
  lab: "Laboratory",
  pharmacy: "Pharmacy",
  store: "Store",
  cashier: "Cashier",
  claims: "Claims",
});
export type Role = (typeof Roles.values)[number];

/** A physical point in the clinic that holds a patient queue. */
export const Stations = defineEnum({
  records: "Records",
  vitals: "Vitals",
  consulting: "Consulting",
  lab: "Laboratory",
  pharmacy: "Pharmacy",
  cashier: "Cashier",
  injection: "Injection",
  anc: "ANC",
  ward: "Ward",
});
export type Station = (typeof Stations.values)[number];

/**
 * What kind of establishment this deployment serves. Drives copy, not
 * behaviour — what a clinic can actually *do* is `FacilitySettings`.
 */
export const FacilityTypes = defineEnum({
  clinic: "Clinic",
  hospital: "Hospital",
  maternity_home: "Maternity home",
  health_centre: "Health centre",
});
export type FacilityType = (typeof FacilityTypes.values)[number];

/** The council a clinical staff member is registered with, if any. */
export const LicenceCouncils = defineEnum({
  MDC: "Medical & Dental Council",
  NMC: "Nursing & Midwifery Council",
  PC: "Pharmacy Council",
  AHPC: "Allied Health Professions Council",
  none: "None",
});
export type LicenceCouncil = (typeof LicenceCouncils.values)[number];

/* -------------------------------------------------------------------------
   Patient
   ------------------------------------------------------------------------- */

/** Sex as recorded on the folder. The API's set is binary — this is the
 *  clinical field that drives reference ranges, not gender identity. */
export const Sexes = defineEnum({
  male: "Male",
  female: "Female",
});
export type Sex = (typeof Sexes.values)[number];

/**
 * How well the date of birth is known.
 *
 * Not an edge case: plenty of patients have no birth record, so the folder
 * carries an estimate and says so. This value is what `PatientAge.accuracy`
 * reports back, and what makes `PatientAge.display` authoritative.
 */
export const DobAccuracies = defineEnum({
  exact: "Exact date",
  year_only: "Year of birth only",
  estimated_age: "Estimated age",
});
export type DobAccuracy = (typeof DobAccuracies.values)[number];

export const MaritalStatuses = defineEnum({
  single: "Single",
  married: "Married",
  divorced: "Divorced",
  widowed: "Widowed",
  unknown: "Unknown",
});
export type MaritalStatus = (typeof MaritalStatuses.values)[number];

/** ABO/Rh group. `unknown` is a real, common answer at registration. */
export const BloodGroups = defineEnum({
  "A+": "A+",
  "A-": "A−",
  "B+": "B+",
  "B-": "B−",
  "AB+": "AB+",
  "AB-": "AB−",
  "O+": "O+",
  "O-": "O−",
  unknown: "Unknown",
});
export type BloodGroup = (typeof BloodGroups.values)[number];

/**
 * Mobile network, derived by the API from the phone prefix. Read-only —
 * it is never posted; it exists to preselect the mobile money network at the
 * till.
 */
export const MobileNetworks = defineEnum({
  mtn: "MTN",
  telecel: "Telecel",
  airteltigo: "AirtelTigo",
  glo: "Glo",
  unknown: "Unknown",
});
export type MobileNetwork = (typeof MobileNetworks.values)[number];

/* -------------------------------------------------------------------------
   Payer
   ------------------------------------------------------------------------- */

/** Cash, NHIS, a private insurance scheme, or a corporate account. */
export const PayerTypes = defineEnum({
  cash: "Cash",
  nhis: "NHIS",
  private_scheme: "Private scheme",
  corporate: "Corporate",
});
export type PayerType = (typeof PayerTypes.values)[number];

/** NHIS premium exemption group, if any. */
export const NhisExemptionCategories = defineEnum({
  none: "None",
  under_18: "Under 18",
  pregnant: "Pregnant",
  aged_70_plus: "70 and over",
  indigent: "Indigent",
  ssnit_contributor: "SSNIT contributor",
  ssnit_pensioner: "SSNIT pensioner",
  lep_beneficiary: "LEAP beneficiary",
});
export type NhisExemptionCategory = (typeof NhisExemptionCategories.values)[number];

export const MembershipStatuses = defineEnum({
  active: "Active",
  expired: "Expired",
  suspended: "Suspended",
  unverified: "Unverified",
});
export type MembershipStatus = (typeof MembershipStatuses.values)[number];

/* -------------------------------------------------------------------------
   Visit
   ------------------------------------------------------------------------- */

export const VisitTypes = defineEnum({
  opd: "OPD",
  review: "Review",
  emergency: "Emergency",
  anc: "ANC",
  postnatal: "Postnatal",
  immunization: "Immunization",
  admission: "Admission",
  walk_in_lab: "Walk-in lab",
  walk_in_pharmacy: "Walk-in pharmacy",
});
export type VisitType = (typeof VisitTypes.values)[number];

/**
 * Where a visit stands.
 *
 * `cancelled` is not a failed `closed`: it is the patient who left before
 * anyone saw them, so it carries no {@link Disposition} and nothing was
 * clinically recorded. Only an `open` visit accepts work.
 */
export const VisitStatuses = defineEnum({
  open: "Open",
  closed: "Closed",
  cancelled: "Cancelled",
});
export type VisitStatus = (typeof VisitStatuses.values)[number];

/**
 * Queue and visit urgency. Declared most-urgent first, which is also the order
 * worklists sort in — see {@link comparePriority}.
 */
export const Priorities = defineEnum({
  emergency: "Emergency",
  urgent: "Urgent",
  routine: "Routine",
});
export type Priority = (typeof Priorities.values)[number];

const PRIORITY_RANK: Record<Priority, number> = {
  emergency: 0,
  urgent: 1,
  routine: 2,
};

/**
 * Sort comparator putting emergency before urgent before routine.
 * Every worklist must use this rather than sorting the raw strings, which
 * would order them alphabetically — emergency, routine, urgent.
 */
export function comparePriority(a: Priority, b: Priority): number {
  return PRIORITY_RANK[a] - PRIORITY_RANK[b];
}

/**
 * Where one patient stands on one station worklist.
 *
 * `skipped` is recoverable — a patient who did not answer when called is
 * skipped, not discharged, and `POST /queues/entries/{id}/requeue` puts them
 * back. `left` is the one that means they are gone.
 */
export const QueueStatuses = defineEnum({
  waiting: "Waiting",
  in_service: "In service",
  done: "Done",
  skipped: "Skipped",
  left: "Left",
});
export type QueueStatus = (typeof QueueStatuses.values)[number];

/** How a visit ended. */
export const Dispositions = defineEnum({
  discharged: "Discharged",
  admitted: "Admitted",
  referred: "Referred",
  absconded: "Absconded",
  died: "Died",
  dama: "Discharged against medical advice",
});
export type Disposition = (typeof Dispositions.values)[number];

/* -------------------------------------------------------------------------
   Clinical capture
   ------------------------------------------------------------------------- */

/**
 * How loudly a vitals reading is out of range.
 *
 * Note this is **not** the lab result flag set (low/normal/high/critical_*):
 * a `VitalFlag` only ever exists for a reading worth mentioning, so there is no
 * `normal` member — an unflagged observation simply produces no flag at all.
 * Declared most-urgent first, which is the order the flag list renders in.
 */
export const VitalFlagSeverities = defineEnum({
  critical: "Critical",
  warning: "Warning",
  info: "Note",
});
export type VitalFlagSeverity = (typeof VitalFlagSeverities.values)[number];

const VITAL_SEVERITY_RANK: Record<VitalFlagSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** Sorts flags critical-first, so the reading that matters leads the list. */
export function compareVitalSeverity(a: VitalFlagSeverity, b: VitalFlagSeverity): number {
  return VITAL_SEVERITY_RANK[a] - VITAL_SEVERITY_RANK[b];
}

/**
 * How settled a diagnosis is.
 *
 * `differential` is one of several being considered, not a conclusion — it must
 * never be the primary diagnosis, and Phase 10 does not claim against it.
 */
export const DiagnosisTypes = defineEnum({
  provisional: "Provisional",
  final: "Final",
  differential: "Differential",
});
export type DiagnosisType = (typeof DiagnosisTypes.values)[number];

/**
 * How the note index answered a similarity search.
 *
 * `semantic` compares meaning through embeddings and is what makes "burning on
 * passing urine" find a note that says dysuria. `lexical` is the fallback when
 * the AI provider is unreachable: plain text matching, so the same query finds
 * far less. The panel must say which one ran — the two produce very different
 * result sets and a clinician should know which they are reading.
 */
export const NoteSearchModes = defineEnum({
  semantic: "Semantic",
  lexical: "Text match",
});
export type NoteSearchMode = (typeof NoteSearchModes.values)[number];

/* -------------------------------------------------------------------------
   Payments
   ------------------------------------------------------------------------- */

export const PaymentMethods = defineEnum({
  cash: "Cash",
  momo: "Mobile money",
  card: "Card",
  bank_transfer: "Bank transfer",
  insurance: "Insurance",
  waiver: "Waiver",
});
export type PaymentMethod = (typeof PaymentMethods.values)[number];

/* -------------------------------------------------------------------------
   Pharmacy
   ------------------------------------------------------------------------- */

/**
 * Dosing frequency as written on a Ghanaian prescription. The wire value is
 * the abbreviation a prescriber writes; the label spells it out. Prescribing
 * and dispensing screens should show both.
 */
export const Frequencies = defineEnum({
  od: "Once daily",
  bd: "Twice daily",
  tds: "Three times daily",
  qid: "Four times daily",
  nocte: "At night",
  mane: "In the morning",
  q4h: "Every 4 hours",
  q6h: "Every 6 hours",
  q8h: "Every 8 hours",
  q12h: "Every 12 hours",
  weekly: "Once weekly",
  stat: "Immediately, once",
  prn: "As required",
});
export type Frequency = (typeof Frequencies.values)[number];

export const DosageForms = defineEnum({
  tablet: "Tablet",
  capsule: "Capsule",
  syrup: "Syrup",
  suspension: "Suspension",
  injection: "Injection",
  infusion: "Infusion",
  cream: "Cream",
  ointment: "Ointment",
  drops: "Drops",
  suppository: "Suppository",
  inhaler: "Inhaler",
  sachet: "Sachet",
  pessary: "Pessary",
  none: "None",
});
export type DosageForm = (typeof DosageForms.values)[number];

/**
 * Route of administration — the API calls this field `route`.
 *
 * Deliberately **not** exported as `Route`: every React Router route module
 * imports its own generated `Route` namespace (`import type { Route } from
 * "./+types/…"`), and a second `Route` in scope is a guaranteed collision.
 */
export const AdministrationRoutes = defineEnum({
  oral: "Oral",
  iv: "Intravenous",
  im: "Intramuscular",
  sc: "Subcutaneous",
  topical: "Topical",
  rectal: "Rectal",
  inhalation: "Inhalation",
  ophthalmic: "Ophthalmic (eye)",
  otic: "Otic (ear)",
  nasal: "Nasal",
  sublingual: "Sublingual",
  vaginal: "Vaginal",
});
export type AdministrationRoute = (typeof AdministrationRoutes.values)[number];

/* -------------------------------------------------------------------------
   Lab
   ------------------------------------------------------------------------- */

export const SpecimenTypes = defineEnum({
  blood_edta: "Blood (EDTA)",
  blood_serum: "Blood (serum)",
  blood_fluoride: "Blood (fluoride)",
  whole_blood: "Whole blood",
  urine: "Urine",
  stool: "Stool",
  swab: "Swab",
  sputum: "Sputum",
  none: "None",
});
export type SpecimenType = (typeof SpecimenTypes.values)[number];

/**
 * Where one lab test — or the order holding several — stands.
 *
 * Declared in lifecycle order: ordered → collected → resulted → verified.
 * `rejected` is a **specimen** verdict (haemolysed, insufficient, mislabelled),
 * not a result: a fresh specimen restarts that item. An order's own status is
 * its **least-advanced** item, so one pending test holds the whole order back.
 *
 * TASK.md's enum table predates the live spec, which adds `cancelled`.
 */
export const LabOrderStatuses = defineEnum({
  ordered: "Ordered",
  collected: "Collected",
  resulted: "Resulted",
  verified: "Verified",
  rejected: "Rejected",
  cancelled: "Cancelled",
});
export type LabOrderStatus = (typeof LabOrderStatuses.values)[number];

/** How an analyte's value is captured: a number, free text, or one of a list. */
export const LabResultTypes = defineEnum({
  numeric: "Numeric",
  text: "Text",
  select: "Choice",
});
export type LabResultType = (typeof LabResultTypes.values)[number];

/**
 * How a result sits against its reference range.
 *
 * Computed by the API — never typed by the bench. Unlike `VitalFlagSeverities`
 * this set **does** include `normal`, because a lab report states every value's
 * standing explicitly; an unflagged lab value would read as ungraded, not fine.
 * `abnormal` is the non-numeric verdict (a positive film, a growth on culture).
 */
export const LabResultFlags = defineEnum({
  critical_low: "Critically low",
  critical_high: "Critically high",
  low: "Low",
  high: "High",
  abnormal: "Abnormal",
  normal: "Normal",
});
export type LabResultFlag = (typeof LabResultFlags.values)[number];

/** The flags that mean the ordering clinician is being paged over the socket. */
export function isCriticalLabFlag(flag: LabResultFlag): boolean {
  return flag === "critical_low" || flag === "critical_high";
}

/** Anything worth a coloured pill — everything except `normal`. */
export function isAbnormalLabFlag(flag: LabResultFlag): boolean {
  return flag !== "normal";
}
