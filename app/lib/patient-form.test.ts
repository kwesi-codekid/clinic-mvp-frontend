/**
 * The patient form's wire format.
 *
 * Two things here are worth a test rather than a careful read: the repeating
 * blocks are reassembled from **parallel lists**, so a row that fails to post
 * one of its fields would silently shift every row after it; and the patch
 * path distinguishes "left alone" from "cleared", which is invisible in the
 * markup and destructive to get wrong.
 */

import { describe, expect, it } from "vitest";

import { readDuplicateSearch, readPatientInput } from "./patient-form";

/** A form with the fields every submission carries, plus whatever is passed. */
function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

const IDENTITY: Array<[string, string]> = [
  ["surname", "Mensah"],
  ["firstName", "Akua"],
  ["sex", "female"],
];

describe("readPatientInput", () => {
  it("keeps a registration to the fields that were filled in", () => {
    const input = readPatientInput(form(IDENTITY), { clearBlanks: false });

    expect(input.surname).toBe("Mensah");
    expect(input.firstName).toBe("Akua");
    expect(input.sex).toBe("female");
    // Untouched on a create means absent, not empty.
    expect(input.town).toBeUndefined();
    expect(input.occupation).toBeUndefined();
    expect(input.nextOfKin).toBeUndefined();
  });

  it("trims what it reads", () => {
    const input = readPatientInput(
      form([...IDENTITY, ["town", "  Ejisu  "]]),
      { clearBlanks: false },
    );

    expect(input.town).toBe("Ejisu");
  });

  it("rejects a sex the API would not accept", () => {
    const input = readPatientInput(form([["surname", "Mensah"], ["sex", "other"]]), {
      clearBlanks: false,
    });

    expect(input.sex).toBeUndefined();
  });

  describe("age", () => {
    it("takes an exact date as given", () => {
      const input = readPatientInput(
        form([...IDENTITY, ["dobAccuracy", "exact"], ["dateOfBirth", "1990-04-12"]]),
        { clearBlanks: false },
      );

      expect(input.dobAccuracy).toBe("exact");
      expect(input.dateOfBirth).toBe("1990-04-12");
    });

    it("stores a year-only birth date as 1 January", () => {
      const input = readPatientInput(
        form([...IDENTITY, ["dobAccuracy", "year_only"], ["birthYear", "1985"]]),
        { clearBlanks: false },
      );

      expect(input.dobAccuracy).toBe("year_only");
      expect(input.dateOfBirth).toBe("1985-01-01");
      expect(input.estimatedAgeYears).toBeUndefined();
    });

    it("sends an estimate as years, with no date at all", () => {
      const input = readPatientInput(
        form([
          ...IDENTITY,
          ["dobAccuracy", "estimated_age"],
          ["estimatedAgeYears", "45"],
          // Left over from the date input the clerk switched away from.
          ["dateOfBirth", "1990-04-12"],
        ]),
        { clearBlanks: false },
      );

      expect(input.estimatedAgeYears).toBe(45);
      expect(input.dateOfBirth).toBeUndefined();
    });

    it("drops an age outside the range the API accepts", () => {
      const input = readPatientInput(
        form([...IDENTITY, ["dobAccuracy", "estimated_age"], ["estimatedAgeYears", "900"]]),
        { clearBlanks: false },
      );

      expect(input.estimatedAgeYears).toBeUndefined();
    });
  });

  describe("repeating rows", () => {
    it("zips the parallel allergy lists by position", () => {
      const input = readPatientInput(
        form([
          ...IDENTITY,
          ["allergySubstance", "Penicillin"],
          ["allergyReaction", "Rash"],
          ["allergySeverity", "Severe"],
          ["allergySubstance", "Peanuts"],
          ["allergyReaction", ""],
          ["allergySeverity", ""],
        ]),
        { clearBlanks: false },
      );

      expect(input.allergies).toEqual([
        { substance: "Penicillin", reaction: "Rash", severity: "Severe" },
        { substance: "Peanuts", reaction: undefined, severity: undefined },
      ]);
    });

    it("drops a row the clerk added and left blank, without shifting the rest", () => {
      const input = readPatientInput(
        form([
          ...IDENTITY,
          ["allergySubstance", ""],
          ["allergyReaction", "orphaned"],
          ["allergySeverity", ""],
          ["allergySubstance", "Sulfa"],
          ["allergyReaction", "Hives"],
          ["allergySeverity", ""],
        ]),
        { clearBlanks: false },
      );

      expect(input.allergies).toEqual([
        { substance: "Sulfa", reaction: "Hives", severity: undefined },
      ]);
    });

    it("widens a condition's date to the datetime the API demands", () => {
      const input = readPatientInput(
        form([
          ...IDENTITY,
          ["conditionName", "Type 2 diabetes"],
          ["conditionIcd10", "E11"],
          ["conditionDiagnosedOn", "2019-06-01"],
        ]),
        { clearBlanks: false },
      );

      expect(input.chronicConditions).toEqual([
        { condition: "Type 2 diabetes", icd10Code: "E11", diagnosedAt: "2019-06-01T00:00:00Z" },
      ]);
    });
  });

  describe("payer profiles", () => {
    const twoPayers: Array<[string, string]> = [
      ["payerType", "nhis"],
      ["payerSchemeId", ""],
      ["payerMemberNumber", "NHIS-1"],
      ["payerExemption", "pregnant"],
      ["payerExpiresOn", "2027-01-31"],
      ["payerStatus", "active"],
      ["payerType", "cash"],
      ["payerSchemeId", "507f1f77bcf86cd799439011"],
      ["payerMemberNumber", ""],
      ["payerExemption", "none"],
      ["payerExpiresOn", ""],
      ["payerStatus", "unverified"],
    ];

    it("marks the row the radio points at as primary", () => {
      const input = readPatientInput(form([...IDENTITY, ...twoPayers, ["payerPrimary", "1"]]), {
        clearBlanks: false,
      });

      expect(input.payerProfiles?.map((profile) => profile.isPrimary)).toEqual([false, true]);
    });

    it("falls back to the first row when nothing is marked", () => {
      const input = readPatientInput(form([...IDENTITY, ...twoPayers]), { clearBlanks: false });

      expect(input.payerProfiles?.map((profile) => profile.isPrimary)).toEqual([true, false]);
    });

    it("carries the scheme id through untouched and drops an empty one", () => {
      const input = readPatientInput(form([...IDENTITY, ...twoPayers]), { clearBlanks: false });

      expect(input.payerProfiles?.[0].schemeId).toBeUndefined();
      expect(input.payerProfiles?.[1].schemeId).toBe("507f1f77bcf86cd799439011");
    });

    it("reads the rest of the row as the API expects it", () => {
      const input = readPatientInput(form([...IDENTITY, ...twoPayers]), { clearBlanks: false });

      expect(input.payerProfiles?.[0]).toMatchObject({
        payerType: "nhis",
        memberNumber: "NHIS-1",
        exemptionCategory: "pregnant",
        expiresAt: "2027-01-31T00:00:00Z",
        status: "active",
      });
    });

    it("ignores a row whose payer type is not one the API knows", () => {
      const input = readPatientInput(
        form([
          ...IDENTITY,
          ["payerType", "barter"],
          ["payerSchemeId", ""],
          ["payerMemberNumber", ""],
          ["payerExemption", "none"],
          ["payerExpiresOn", ""],
          ["payerStatus", "unverified"],
        ]),
        { clearBlanks: false },
      );

      expect(input.payerProfiles).toEqual([]);
    });
  });

  describe("clearing on a patch", () => {
    const blanks: Array<[string, string]> = [
      ["town", ""],
      ["phone", ""],
      ["email", ""],
      ["dateOfBirth", ""],
    ];

    it("says a cleared field out loud, because an omitted key means unchanged", () => {
      const input = readPatientInput(form([...IDENTITY, ...blanks]), { clearBlanks: true });

      expect(input.town).toBe("");
      expect(input.phone).toBe("");
    });

    it("leaves the pattern-validated fields alone rather than sending an empty string", () => {
      const input = readPatientInput(form([...IDENTITY, ...blanks]), { clearBlanks: true });

      // The API's own patterns would reject "" for either of these.
      expect(input.email).toBeUndefined();
      expect(input.dateOfBirth).toBeUndefined();
    });

    it("sends an emptied next of kin as an empty block, not as nothing", () => {
      const input = readPatientInput(form([...IDENTITY, ["kinName", ""]]), {
        clearBlanks: true,
      });

      expect(input.nextOfKin).toEqual({
        name: "",
        relationship: "",
        phone: "",
        address: "",
      });
    });
  });
});

describe("readDuplicateSearch", () => {
  it("sends only the fields the duplicate check accepts", () => {
    const search = readDuplicateSearch(
      form([
        ...IDENTITY,
        ["ghanaCardNumber", "GHA-123456789-0"],
        ["nhisNumber", "NH-99"],
        ["phone", "0244000000"],
        ["dobAccuracy", "exact"],
        ["dateOfBirth", "1990-04-12"],
        ["occupation", "Trader"],
        ["town", "Ejisu"],
      ]),
    );

    expect(search).toEqual({
      surname: "Mensah",
      firstName: "Akua",
      otherNames: undefined,
      sex: "female",
      phone: "0244000000",
      ghanaCardNumber: "GHA-123456789-0",
      nhisNumber: "NH-99",
      dateOfBirth: "1990-04-12",
    });
  });

  it("carries no date when the age is only an estimate", () => {
    const search = readDuplicateSearch(
      form([...IDENTITY, ["dobAccuracy", "estimated_age"], ["estimatedAgeYears", "45"]]),
    );

    expect(search.dateOfBirth).toBeUndefined();
  });
});
