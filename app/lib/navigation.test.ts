import { describe, expect, it } from "vitest";

import { buildNav, findNavItem, NAV_CATALOGUE } from "./navigation";
import type { Role } from "~/models/enums";
import type { Facility, FacilitySettings } from "~/models/facility";
import type { ObjectId } from "~/models/primitives";
import type { Staff } from "~/models/staff";

/* -------------------------------------------------------------------------
   Fixtures
   ------------------------------------------------------------------------- */

function staffWith(...roles: Role[]): Staff {
  return {
    id: "65f000000000000000000001" as ObjectId,
    staffNumber: "S-001",
    firstName: "Ama",
    surname: "Mensah",
    fullName: "Ama Mensah",
    email: "ama@example.test",
    roles,
    station: null,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function facilityWith(settings: Partial<FacilitySettings>): Facility {
  return {
    id: "65f000000000000000000002" as ObjectId,
    name: "Test Clinic",
    type: "clinic",
    region: "Greater Accra",
    district: "Ayawaso",
    settings: {
      currency: "GHS",
      timezone: "Africa/Accra",
      folderFeePesewas: 500,
      consultationFeePesewas: 3000,
      hasWard: true,
      hasMaternity: true,
      hasLab: true,
      hasPharmacy: true,
      ...settings,
    },
  };
}

/** Every path offered, flattened — order does not matter to these assertions. */
function pathsFor(staff: Staff, facility: Facility | null): string[] {
  return buildNav(staff, facility).flatMap((group) => group.items.map((item) => item.to));
}

const fullyEquipped = facilityWith({});

/* -------------------------------------------------------------------------
   Facility feature flags
   ------------------------------------------------------------------------- */

describe("facility feature flags", () => {
  it("hides the modules the clinic does not run", () => {
    const paths = pathsFor(
      staffWith("admin"),
      facilityWith({ hasLab: false, hasPharmacy: false, hasWard: false, hasMaternity: false }),
    );

    expect(paths).not.toContain("/laboratory");
    expect(paths).not.toContain("/pharmacy");
    expect(paths).not.toContain("/ipd");
    expect(paths).not.toContain("/maternity");
    // Modules with no flag are unaffected.
    expect(paths).toContain("/patients");
    expect(paths).toContain("/visits");
  });

  it("shows them when the clinic does run them", () => {
    const paths = pathsFor(staffWith("admin"), fullyEquipped);

    expect(paths).toEqual(
      expect.arrayContaining(["/laboratory", "/pharmacy", "/ipd", "/maternity"]),
    );
  });

  it("outranks the role gate — an admin of a clinic with no ward has no ward", () => {
    expect(pathsFor(staffWith("admin"), facilityWith({ hasWard: false }))).not.toContain("/ipd");
  });

  it("falls open when the facility could not be read", () => {
    // A failed GET /facility must not strip a nurse of her modules mid-shift:
    // navigation is UX routing, and the API refuses what the clinic lacks.
    const paths = pathsFor(staffWith("admin"), null);

    expect(paths).toEqual(
      expect.arrayContaining(["/laboratory", "/pharmacy", "/ipd", "/maternity"]),
    );
  });
});

/* -------------------------------------------------------------------------
   Roles
   ------------------------------------------------------------------------- */

describe("role gating", () => {
  it("gives an administrator everything the clinic runs", () => {
    const offered = pathsFor(staffWith("admin"), fullyEquipped);
    const everything = NAV_CATALOGUE.flatMap((group) => group.items).map((item) => item.to);

    expect(offered.sort()).toEqual(everything.sort());
  });

  it("keeps a storekeeper to the stores", () => {
    const paths = pathsFor(staffWith("store"), fullyEquipped);

    expect(paths).toContain("/inventory");
    expect(paths).not.toContain("/patients");
    expect(paths).not.toContain("/billing");
    expect(paths).not.toContain("/staff");
  });

  it("reserves staff admin and settings for administrators", () => {
    for (const role of ["records", "doctor", "cashier", "claims", "lab"] as const) {
      const paths = pathsFor(staffWith(role), fullyEquipped);
      expect(paths).not.toContain("/staff");
      expect(paths).not.toContain("/settings");
    }

    expect(pathsFor(staffWith("admin"), fullyEquipped)).toEqual(
      expect.arrayContaining(["/staff", "/settings"]),
    );
  });

  it("gives the records desk the patient-facing modules but not the clinical ones", () => {
    const paths = pathsFor(staffWith("records"), fullyEquipped);

    expect(paths).toEqual(expect.arrayContaining(["/visits", "/patients", "/opd", "/billing"]));
    expect(paths).not.toContain("/emr");
    expect(paths).not.toContain("/operation-theatre");
  });

  it("unions the modules of a staff member holding several roles", () => {
    const paths = pathsFor(staffWith("lab", "pharmacy"), fullyEquipped);

    expect(paths).toEqual(expect.arrayContaining(["/laboratory", "/pharmacy", "/inventory"]));
  });

  it("always offers the dashboard", () => {
    for (const role of ["store", "claims", "cashier", "lab", "pharmacy"] as const) {
      expect(pathsFor(staffWith(role), fullyEquipped)).toContain("/");
    }
  });
});

/* -------------------------------------------------------------------------
   Groups
   ------------------------------------------------------------------------- */

describe("groups", () => {
  it("puts Visits in Clinical, immediately above OPD", () => {
    // A patient is checked in before they can reach any station, so the visit
    // register is the door into the clinical modules rather than a directory
    // alongside Patients and Staff. OPD itself stays a placeholder until T4.2
    // turns it into the `consulting` station worklist.
    const clinical = buildNav(staffWith("admin"), fullyEquipped).find(
      (group) => group.label === "Clinical",
    );

    expect(clinical?.items.map((item) => item.to).slice(0, 2)).toEqual(["/visits", "/opd"]);
  });

  it("drops a section left with nothing in it", () => {
    const groups = buildNav(staffWith("store"), fullyEquipped);
    const labels = groups.map((group) => group.label);

    expect(labels).not.toContain("Clinical");
    expect(labels).not.toContain("Diagnostics");
    expect(labels).toContain("Operations");
    expect(groups.every((group) => group.items.length > 0)).toBe(true);
  });

  it("leaves the catalogue itself untouched", () => {
    const before = NAV_CATALOGUE.map((group) => group.items.length);
    buildNav(staffWith("store"), facilityWith({ hasLab: false }));

    expect(NAV_CATALOGUE.map((group) => group.items.length)).toEqual(before);
  });
});

/* -------------------------------------------------------------------------
   Path matching
   ------------------------------------------------------------------------- */

describe("findNavItem", () => {
  it("matches a module by its path prefix, so child routes stay highlighted", () => {
    expect(findNavItem("/visits")?.label).toBe("Visits");
    expect(findNavItem("/visits/new")?.label).toBe("Visits");
    expect(findNavItem("/patients/65f000000000000000000001/edit")?.label).toBe("Patients");
  });

  it("matches the dashboard exactly, never as a prefix of everything", () => {
    expect(findNavItem("/")?.label).toBe("Dashboard");
    expect(findNavItem("/patients")?.label).toBe("Patients");
  });

  it("searches the whole catalogue, not one person's menu", () => {
    // The "coming soon" placeholder has to name a module whether or not the
    // reader is offered it.
    expect(findNavItem("/laboratory")?.label).toBe("Laboratory");
  });

  it("prefers the most specific module when two of them prefix the path", () => {
    expect(findNavItem("/analytics")?.label).toBe("Analytics");
    expect(findNavItem("/analytics/assistant")?.label).toBe("Ask AI");
  });

  it("returns nothing for a path no module owns", () => {
    expect(findNavItem("/nowhere")).toBeUndefined();
  });
});
