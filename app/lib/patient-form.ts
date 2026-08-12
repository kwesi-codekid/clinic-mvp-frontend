/**
 * The patient form's wire format: the field names the form posts, and the
 * readers that turn a `FormData` back into {@link CreatePatient} /
 * {@link UpdatePatient}.
 *
 * It lives apart from the component because both halves have to agree on
 * every name, and only one of them runs in the browser. Repeating blocks
 * (payers, allergies, conditions) post as **parallel lists** — `allergies` is
 * `allergySubstance[]` + `allergyReaction[]` + `allergySeverity[]` read back
 * by index — which is what lets the form add and remove rows with no client
 * state beyond a row count.
 *
 * Two rules the API imposes on the patch path, encoded here once:
 *
 * - **Arrays are replaced, not merged.** Whatever is sent becomes the whole
 *   list, so the form has to re-post every existing row — including the parts
 *   it does not show, hence the hidden `payerSchemeId`.
 * - **Blanks are ambiguous.** An omitted key means "leave alone", so clearing
 *   a field has to be said out loud with `""`. Only fields the API accepts an
 *   empty string for are in {@link CLEARABLE}; `email` and `dateOfBirth` are
 *   pattern-validated and would be rejected, so a blank there means "unchanged".
 */

import {
  BloodGroups,
  DobAccuracies,
  MaritalStatuses,
  MembershipStatuses,
  NhisExemptionCategories,
  PayerTypes,
  Sexes,
} from "~/models/enums";
import type {
  Allergy,
  ChronicCondition,
  DuplicateSearch,
  NextOfKin,
  PayerProfileInput,
  UpdatePatient,
} from "~/models/patient";
import { isObjectId } from "~/models/primitives";

/* -------------------------------------------------------------------------
   Primitives
   ------------------------------------------------------------------------- */

/** Trimmed, or `undefined` when the field was left empty. */
function text(form: FormData, key: string): string | undefined {
  const raw = form.get(key);
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

/** Every value posted under `key`, trimmed, with position preserved. */
function textList(form: FormData, key: string): string[] {
  return form.getAll(key).map((value) => (typeof value === "string" ? value.trim() : ""));
}

/** A `YYYY-MM-DD` picker value widened to the UTC datetime the API wants. */
function asDateTime(date: string | undefined): string | undefined {
  return date ? `${date}T00:00:00Z` : undefined;
}

/** Free-text fields the API accepts an empty string for. See the note above. */
const CLEARABLE = [
  "otherNames",
  "occupation",
  "religion",
  "phone",
  "altPhone",
  "residentialAddress",
  "ghanaPostGps",
  "town",
  "district",
  "region",
  "ghanaCardNumber",
  "nhisNumber",
] as const;

/* -------------------------------------------------------------------------
   Repeating blocks
   ------------------------------------------------------------------------- */

/**
 * The payer list.
 *
 * A row with no payer type never existed — the clerk added it and left. The
 * `isPrimary` flag comes from a single radio carrying the row's index; with
 * nothing chosen (or the chosen row dropped) the first surviving row takes it,
 * because the API's `primaryPayer` has to point somewhere.
 */
function readPayerProfiles(form: FormData): PayerProfileInput[] {
  const types = textList(form, "payerType");
  const schemeIds = textList(form, "payerSchemeId");
  const members = textList(form, "payerMemberNumber");
  const exemptions = textList(form, "payerExemption");
  const expiries = textList(form, "payerExpiresOn");
  const statuses = textList(form, "payerStatus");

  const primaryIndex = Number(form.get("payerPrimary"));
  const rows: PayerProfileInput[] = [];

  types.forEach((payerType, index) => {
    if (!PayerTypes.is(payerType)) return;

    const schemeId = schemeIds[index];
    const exemption = exemptions[index];
    const status = statuses[index];

    rows.push({
      payerType,
      schemeId: isObjectId(schemeId) ? schemeId : undefined,
      memberNumber: members[index] || undefined,
      exemptionCategory: NhisExemptionCategories.is(exemption) ? exemption : undefined,
      expiresAt: asDateTime(expiries[index] || undefined),
      status: MembershipStatuses.is(status) ? status : undefined,
      isPrimary: index === primaryIndex,
    });
  });

  if (rows.length > 0 && !rows.some((row) => row.isPrimary)) {
    rows[0].isPrimary = true;
  }

  return rows;
}

/** Allergies, minus the rows the clerk left blank. */
function readAllergies(form: FormData): Allergy[] {
  const substances = textList(form, "allergySubstance");
  const reactions = textList(form, "allergyReaction");
  const severities = textList(form, "allergySeverity");

  return substances.flatMap((substance, index) =>
    substance
      ? [
          {
            substance,
            reaction: reactions[index] || undefined,
            severity: severities[index] || undefined,
          },
        ]
      : [],
  );
}

/** Chronic conditions, minus the rows the clerk left blank. */
function readChronicConditions(form: FormData): ChronicCondition[] {
  const conditions = textList(form, "conditionName");
  const codes = textList(form, "conditionIcd10");
  const diagnosed = textList(form, "conditionDiagnosedOn");

  return conditions.flatMap((condition, index) =>
    condition
      ? [
          {
            condition,
            icd10Code: codes[index] || undefined,
            diagnosedAt: asDateTime(diagnosed[index] || undefined),
          },
        ]
      : [],
  );
}

/**
 * Next of kin, or `undefined` when the block is entirely empty.
 *
 * On a patch the empty block is still sent — a clerk who deleted the details
 * meant to delete them, and only an explicit `{}` says so.
 */
function readNextOfKin(form: FormData, { keepEmpty }: { keepEmpty: boolean }): NextOfKin | undefined {
  const kin: NextOfKin = {
    name: text(form, "kinName") ?? (keepEmpty ? "" : undefined),
    relationship: text(form, "kinRelationship") ?? (keepEmpty ? "" : undefined),
    phone: text(form, "kinPhone") ?? (keepEmpty ? "" : undefined),
    address: text(form, "kinAddress") ?? (keepEmpty ? "" : undefined),
  };

  const filled = Object.values(kin).some((value) => value);
  return filled || keepEmpty ? kin : undefined;
}

/* -------------------------------------------------------------------------
   Age
   ------------------------------------------------------------------------- */

/**
 * Date of birth, as one of the three answers the folder allows: an exact date,
 * a year, or an estimate in whole years.
 *
 * A year-only birth date is stored as 1 January of that year — the API's own
 * convention is to keep `dobAccuracy` alongside it so nothing downstream
 * mistakes the day for a fact.
 */
function readAge(form: FormData): Pick<UpdatePatient, "dateOfBirth" | "dobAccuracy" | "estimatedAgeYears"> {
  const raw = form.get("dobAccuracy");
  const accuracy = DobAccuracies.is(raw) ? raw : "exact";

  if (accuracy === "estimated_age") {
    const years = Number(text(form, "estimatedAgeYears"));
    return {
      dobAccuracy: accuracy,
      estimatedAgeYears: Number.isInteger(years) && years >= 0 && years <= 130 ? years : undefined,
    };
  }

  if (accuracy === "year_only") {
    const year = text(form, "birthYear");
    return {
      dobAccuracy: accuracy,
      dateOfBirth: /^\d{4}$/.test(year ?? "") ? `${year}-01-01` : undefined,
    };
  }

  return { dobAccuracy: accuracy, dateOfBirth: text(form, "dateOfBirth") };
}

/* -------------------------------------------------------------------------
   Readers
   ------------------------------------------------------------------------- */

/**
 * The whole form as a patch body. `undefined` entries drop out of the JSON,
 * which is exactly what a sparse patch wants.
 *
 * `clearBlanks` is the difference between registering and editing: a create
 * has nothing to clear, and posting `""` there would store an empty string
 * where the field should simply be absent.
 *
 * The required fields are *not* validated here — the route does that, because
 * only it knows whether a missing surname is a rejected create or an untouched
 * patch.
 */
export function readPatientInput(
  form: FormData,
  { clearBlanks }: { clearBlanks: boolean },
): UpdatePatient {
  const optional = (key: (typeof CLEARABLE)[number]) =>
    text(form, key) ?? (clearBlanks ? "" : undefined);

  const sex = form.get("sex");
  const maritalStatus = form.get("maritalStatus");
  const bloodGroup = form.get("bloodGroup");

  return {
    surname: text(form, "surname"),
    firstName: text(form, "firstName"),
    otherNames: optional("otherNames"),
    sex: Sexes.is(sex) ? sex : undefined,
    ...readAge(form),
    maritalStatus: MaritalStatuses.is(maritalStatus) ? maritalStatus : undefined,
    occupation: optional("occupation"),
    religion: optional("religion"),
    nationality: text(form, "nationality"),
    phone: optional("phone"),
    altPhone: optional("altPhone"),
    // Pattern-validated: a blank means "unchanged", never "clear it".
    email: text(form, "email"),
    residentialAddress: optional("residentialAddress"),
    ghanaPostGps: optional("ghanaPostGps"),
    town: optional("town"),
    district: optional("district"),
    region: optional("region"),
    ghanaCardNumber: optional("ghanaCardNumber"),
    nhisNumber: optional("nhisNumber"),
    nextOfKin: readNextOfKin(form, { keepEmpty: clearBlanks }),
    payerProfiles: readPayerProfiles(form),
    bloodGroup: BloodGroups.is(bloodGroup) ? bloodGroup : undefined,
    allergies: readAllergies(form),
    chronicConditions: readChronicConditions(form),
  };
}

/**
 * The subset of the same form the duplicate check accepts, for the live
 * search that runs while the clerk types.
 */
export function readDuplicateSearch(form: FormData): DuplicateSearch {
  const sex = form.get("sex");

  return {
    surname: text(form, "surname"),
    firstName: text(form, "firstName"),
    otherNames: text(form, "otherNames"),
    phone: text(form, "phone"),
    ghanaCardNumber: text(form, "ghanaCardNumber"),
    nhisNumber: text(form, "nhisNumber"),
    dateOfBirth: readAge(form).dateOfBirth,
    sex: Sexes.is(sex) ? sex : undefined,
  };
}

/** The form fields the duplicate check reads, in the order it sends them. */
export const DUPLICATE_SEARCH_FIELDS = [
  "surname",
  "firstName",
  "otherNames",
  "phone",
  "ghanaCardNumber",
  "nhisNumber",
  "dobAccuracy",
  "dateOfBirth",
  "birthYear",
  "sex",
] as const;
