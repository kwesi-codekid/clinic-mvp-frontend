/**
 * Patient — the folder, and everything the records desk writes into it.
 *
 * Modelled from `components.schemas.{PatientAge, NextOfKin, Allergy,
 * ChronicCondition, PayerProfile, PatientSummary, Patient, …}` (T2.1).
 *
 * Two conventions in here are easy to get wrong:
 *
 * 1. **Age is not derived.** `PatientAge` carries its own `display` and an
 *    explicit `accuracy`, because many patients do not know their date of
 *    birth. Render `display`; never recompute from `dateOfBirth`.
 * 2. **Read and write shapes differ.** `PayerProfile` (read) carries the
 *    API-computed `label` and `valid`; `PayerProfileInput` (write) carries
 *    neither. The same split applies to `PatientAge` — there is no age input.
 */

import type {
  BloodGroup,
  DobAccuracy,
  MaritalStatus,
  MembershipStatus,
  MobileNetwork,
  NhisExemptionCategory,
  PayerType,
  Sex,
} from "./enums";
import type { IsoDate, IsoDateTime, ObjectId } from "./primitives";

/* -------------------------------------------------------------------------
   Leaf objects (L0)
   ------------------------------------------------------------------------- */

/**
 * Age with an explicit accuracy.
 *
 * `years`/`months` are absent when the folder only holds an estimate, which is
 * exactly why `display` exists and is required.
 */
export type PatientAge = {
  years?: number;
  months?: number;
  /** How age is written on the folder, e.g. `34y` or `7m`. Render this. */
  display: string;
  accuracy: DobAccuracy;
};

/** Who to call. Every field is optional — often only a name and a phone. */
export type NextOfKin = {
  name?: string;
  relationship?: string;
  phone?: string;
  address?: string;
};

/** A recorded allergy. Only the substance is mandatory. */
export type Allergy = {
  substance: string;
  reaction?: string;
  severity?: string;
};

/** A standing diagnosis carried across visits. */
export type ChronicCondition = {
  condition: string;
  icd10Code?: string;
  diagnosedAt?: IsoDateTime;
};

/* -------------------------------------------------------------------------
   Payer (L1)
   ------------------------------------------------------------------------- */

/**
 * One way this patient can be billed.
 *
 * `label` and `valid` are the API's to compute — `valid` is false once cover
 * has lapsed or been suspended, which is not the same as `status` being
 * anything in particular. Show `valid` at the till; do not re-derive it from
 * `expiresAt`.
 */
export type PayerProfile = {
  payerType: PayerType;
  schemeId?: ObjectId;
  schemeName?: string;
  /** Human-readable payer name — render this rather than the enum label. */
  label: string;
  memberNumber?: string;
  exemptionCategory?: NhisExemptionCategory;
  expiresAt?: IsoDateTime;
  status: MembershipStatus;
  isPrimary: boolean;
  /** False when cover has lapsed or been suspended. */
  valid: boolean;
};

/** A payer as submitted. No `label`, no `valid` — both are computed. */
export type PayerProfileInput = {
  payerType: PayerType;
  schemeId?: ObjectId;
  memberNumber?: string;
  exemptionCategory?: NhisExemptionCategory;
  expiresAt?: IsoDateTime;
  status?: MembershipStatus;
  isPrimary?: boolean;
};

/* -------------------------------------------------------------------------
   The patient (L2)
   ------------------------------------------------------------------------- */

/** Compact patient record for lists and queues. */
export type PatientSummary = {
  id: ObjectId;
  folderNumber: string;
  /** Preassembled by the API — render this, never rejoin the name parts. */
  fullName: string;
  surname: string;
  firstName: string;
  sex: Sex;
  age: PatientAge;
  /** Normalised to `+233…`. */
  phone?: string;
  /** The same number spaced for reading. Prefer it in the UI. */
  phoneFormatted?: string;
  nhisNumber?: string;
  primaryPayer: PayerProfile;
  photoUrl?: string;
  lastVisitAt?: IsoDateTime;
};

/**
 * A full patient folder.
 *
 * `maritalStatus` and `bloodGroup` come back as plain strings — the API
 * constrains them on the way in, not on the way out, so read them through
 * `MaritalStatuses.labelOr()` / `BloodGroups.labelOr()` rather than assuming
 * the union.
 */
export type Patient = PatientSummary & {
  otherNames?: string;
  dateOfBirth?: IsoDate;
  maritalStatus?: string;
  occupation?: string;
  religion?: string;
  nationality: string;
  /** Derived from the phone prefix; preselects the mobile money network. */
  mobileNetwork: MobileNetwork;
  altPhone?: string;
  email?: string;
  residentialAddress?: string;
  ghanaPostGps?: string;
  town?: string;
  district?: string;
  region?: string;
  ghanaCardNumber?: string;
  nextOfKin?: NextOfKin;
  /** Always present; the primary one is also mirrored on `primaryPayer`. */
  payerProfiles: PayerProfile[];
  bloodGroup?: string;
  allergies: Allergy[];
  chronicConditions: ChronicCondition[];
  isDeceased: boolean;
  /** Set once this folder has been merged away — follow it to the survivor. */
  mergedInto?: ObjectId;
  registeredAt: IsoDateTime;
};

/* -------------------------------------------------------------------------
   Write models
   ------------------------------------------------------------------------- */

/**
 * Body of `POST /patients`.
 *
 * Date of birth is submitted as a date **plus** an accuracy, or — when the
 * patient has no idea — as `estimatedAgeYears` with
 * `dobAccuracy: "estimated_age"`. The API turns whichever arrives into the
 * {@link PatientAge} it hands back.
 */
export type CreatePatient = {
  surname: string;
  firstName: string;
  otherNames?: string;
  sex: Sex;
  dateOfBirth?: IsoDate;
  dobAccuracy?: DobAccuracy;
  /** 0–130. Use when the patient does not know their date of birth. */
  estimatedAgeYears?: number;
  maritalStatus?: MaritalStatus;
  occupation?: string;
  religion?: string;
  nationality?: string;
  /** Any local format; the API normalises it to `+233…`. */
  phone?: string;
  altPhone?: string;
  email?: string;
  residentialAddress?: string;
  ghanaPostGps?: string;
  town?: string;
  district?: string;
  region?: string;
  /** `GHA-XXXXXXXXX-X`. */
  ghanaCardNumber?: string;
  nhisNumber?: string;
  nextOfKin?: NextOfKin;
  payerProfiles?: PayerProfileInput[];
  bloodGroup?: BloodGroup;
  allergies?: Allergy[];
  chronicConditions?: ChronicCondition[];
  photoUrl?: string;
  /**
   * Register even though the API found candidate folders.
   *
   * Only ever send this after the clerk has seen those candidates and said
   * this is a different person — it is the override, not a default.
   */
  forceCreate?: boolean;
};

/**
 * Body of `PATCH /patients/{id}` — a **sparse** patch: only the keys present
 * are touched, so omit a field to leave it as it is.
 *
 * Arrays are replaced wholesale, not appended to: sending `allergies` means
 * "these are now the allergies".
 */
export type UpdatePatient = Partial<Omit<CreatePatient, "forceCreate">>;

/* -------------------------------------------------------------------------
   Duplicates and merge (T2.3)
   ------------------------------------------------------------------------- */

/**
 * Body of `POST /patients/check-duplicates` — meant to be called *while the
 * clerk is still typing*. Every field is optional; the more you send, the
 * better the match.
 */
export type DuplicateSearch = {
  surname?: string;
  firstName?: string;
  otherNames?: string;
  phone?: string;
  ghanaCardNumber?: string;
  nhisNumber?: string;
  dateOfBirth?: IsoDate;
  sex?: Sex;
};

/**
 * An existing folder that may already belong to this patient.
 *
 * `score` is the API's confidence, 0–1: matches on Ghana Card, NHIS number and
 * phone are decisive, while names are compared by similarity because Ghanaian
 * spellings vary legitimately and name order is not fixed. `reasons` is what
 * to show the clerk — it says *why*, which is what they can actually judge.
 */
export type DuplicateCandidate = {
  patient: PatientSummary;
  score: number;
  reasons: string[];
};

/** Body of `POST /patients/merge`. */
export type MergePatients = {
  /** The duplicate folder, which will be retired. */
  sourceId: ObjectId;
  /** The folder to keep. */
  targetId: ObjectId;
  reason?: string;
};

/* -------------------------------------------------------------------------
   Derived views
   ------------------------------------------------------------------------- */

/**
 * True when the folder carries something a clinician must see before
 * prescribing — the trigger for the banner on the patient folder.
 */
export function hasClinicalAlerts(patient: Patient): boolean {
  return patient.allergies.length > 0 || patient.chronicConditions.length > 0;
}

/** An allergy written the way it belongs on a banner: substance (reaction). */
export function describeAllergy(allergy: Allergy): string {
  const detail = [allergy.reaction, allergy.severity].filter(Boolean).join(", ");
  return detail ? `${allergy.substance} (${detail})` : allergy.substance;
}
