/**
 * The sidebar, derived from the API rather than hard-coded (T1.3, T14.2).
 *
 * Two API facts decide what a staff member sees:
 *
 * 1. **What the clinic runs** — `GET /facility` returns the flags the spec
 *    describes as "the settings that switch modules on and off"
 *    (`hasWard`, `hasMaternity`, `hasLab`, `hasPharmacy`). A clinic with no
 *    pharmacy has no Pharmacy module, for anyone, including an administrator.
 * 2. **What this person does** — the `roles[]` on the signed-in {@link Staff},
 *    straight off `POST /auth/login`. A storekeeper has no business on the
 *    claims screen, and hiding it is kinder than letting them find a 403.
 *
 * **This is UX routing, not security.** The API is the authority on every
 * request; this only decides what is worth offering. Two consequences follow,
 * and both are deliberate:
 *
 * - a missing facility falls *open* (see {@link hasFeature}) rather than
 *   stripping someone's modules over a failed request;
 * - `admin` bypasses the role gate, mirroring the API's own
 *   "**Requires role:** records, nurse, admin (or admin)" convention.
 *
 * {@link NAV_CATALOGUE} stays the single source of truth for the module map —
 * every entry the app will ever have, whether or not it is built yet — and
 * {@link buildNav} is the only thing that decides which of them to render.
 * Filtering here rather than in the shell keeps the shell dumb about
 * permissions and keeps the catalogue readable as a map of the product.
 */

import {
  BabyIcon,
  BedDoubleIcon,
  BoxesIcon,
  ChartColumnIcon,
  ClipboardListIcon,
  FileTextIcon,
  FlaskConicalIcon,
  IdCardIcon,
  LayoutDashboardIcon,
  PillIcon,
  ReceiptTextIcon,
  ScanIcon,
  ScissorsIcon,
  SettingsIcon,
  StethoscopeIcon,
  UsersRoundIcon,
} from "lucide-react";

import type { Role } from "~/models/enums";
import { hasFeature, type Facility, type FacilityFeature } from "~/models/facility";
import type { Staff } from "~/models/staff";

/* -------------------------------------------------------------------------
   Shape
   ------------------------------------------------------------------------- */

export type NavItem = {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  /**
   * Roles this module is offered to. Omit for everyone.
   * `admin` never needs listing — it passes every gate.
   */
  roles?: readonly Role[];
  /** The facility flag that switches this module on. Omit when unconditional. */
  feature?: FacilityFeature;
};

export type NavGroup = {
  /** Section heading; `null` for the ungrouped block at the top. */
  label: string | null;
  items: NavItem[];
};

/* -------------------------------------------------------------------------
   Role bundles — named once so the catalogue reads as a map, not a matrix
   ------------------------------------------------------------------------- */

/** Anyone who writes in a patient's record. */
const CLINICAL = ["doctor", "physician_assistant", "nurse", "midwife"] as const;

/** Clinical staff plus the desk that admits and routes them. */
const CLINICAL_AND_DESK = [...CLINICAL, "records"] as const;

/** Everyone who needs to find a patient: clinical, desk, till and claims. */
const PATIENT_FACING = [...CLINICAL_AND_DESK, "cashier", "claims"] as const;

/* -------------------------------------------------------------------------
   The catalogue
   ------------------------------------------------------------------------- */

/**
 * Every module the app has or will have. Unbuilt paths resolve to the
 * `coming-soon` placeholder, which is why this can stay ahead of the build
 * plan without lying to anyone.
 */
export const NAV_CATALOGUE: NavGroup[] = [
  {
    label: null,
    items: [{ label: "Dashboard", to: "/", icon: LayoutDashboardIcon }],
  },
  {
    label: "Clinical",
    items: [
      // The door into everything clinical: a patient is checked in here before
      // they can reach any station, so it sits above OPD rather than beside
      // the directories in Operations.
      { label: "Visits", to: "/visits", icon: ClipboardListIcon, roles: PATIENT_FACING },
      /*
       * OPD is **not** a second kind of record — the API has no `/opd` path and
       * no OPD schema; `opd` is one of the nine values of `Visit.type`. As a
       * *place* it is the `consulting` station, so this is that station's
       * worklist over `GET /queues/consulting` (T4.2).
       */
      { label: "OPD", to: "/opd", icon: StethoscopeIcon, roles: CLINICAL_AND_DESK },
      {
        label: "IPD & Beds",
        to: "/ipd",
        icon: BedDoubleIcon,
        roles: CLINICAL,
        feature: "hasWard",
      },
      {
        label: "Maternity",
        to: "/maternity",
        icon: BabyIcon,
        roles: ["midwife", "nurse", "doctor", "physician_assistant"],
        feature: "hasMaternity",
      },
      { label: "EMR/EHR", to: "/emr", icon: FileTextIcon, roles: CLINICAL },
      {
        label: "Operation Theatre",
        to: "/operation-theatre",
        icon: ScissorsIcon,
        roles: ["doctor"],
      },
    ],
  },
  {
    label: "Diagnostics",
    items: [
      {
        label: "Laboratory",
        to: "/laboratory",
        icon: FlaskConicalIcon,
        roles: [...CLINICAL, "lab"],
        feature: "hasLab",
      },
      { label: "Radiology", to: "/radiology", icon: ScanIcon, roles: CLINICAL },
      {
        label: "Pharmacy",
        to: "/pharmacy",
        icon: PillIcon,
        roles: [...CLINICAL, "pharmacy"],
        feature: "hasPharmacy",
      },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Patients", to: "/patients", icon: UsersRoundIcon, roles: PATIENT_FACING },
      { label: "Staff", to: "/staff", icon: IdCardIcon, roles: [] },
      { label: "Inventory", to: "/inventory", icon: BoxesIcon, roles: ["store", "pharmacy"] },
    ],
  },
  {
    label: "Finance & Insights",
    items: [
      {
        label: "Billing",
        to: "/billing",
        icon: ReceiptTextIcon,
        roles: ["cashier", "claims", "records"],
      },
      { label: "Analytics", to: "/analytics", icon: ChartColumnIcon, roles: ["claims"] },
      { label: "Settings", to: "/settings", icon: SettingsIcon, roles: [] },
    ],
  },
];

/* -------------------------------------------------------------------------
   Filtering
   ------------------------------------------------------------------------- */

function isOffered(item: NavItem, staff: Staff, facility: Facility | null): boolean {
  // A module the clinic does not run is offered to nobody — an administrator
  // of a clinic with no ward still has no ward.
  if (item.feature && !hasFeature(facility, item.feature)) return false;

  if (!item.roles) return true;
  // `roles: []` means administrators only, which is why this sits after the
  // feature gate and before the membership test.
  if (staff.roles.includes("admin")) return true;

  return item.roles.some((role) => staff.roles.includes(role));
}

/**
 * The sidebar for this staff member, at this clinic.
 *
 * Runs in the component rather than a loader on purpose: `NavItem.icon` is a
 * React component, which cannot survive serialisation across the loader
 * boundary. The loader ships the two plain-JSON inputs; this turns them into
 * the menu.
 *
 * Groups left with nothing in them are dropped, so a storekeeper does not see
 * an empty "Clinical" heading.
 */
export function buildNav(staff: Staff, facility: Facility | null): NavGroup[] {
  return NAV_CATALOGUE.map((group) => ({
    ...group,
    items: group.items.filter((item) => isOffered(item, staff, facility)),
  })).filter((group) => group.items.length > 0);
}

/**
 * The module that owns `pathname`, searched over the whole catalogue rather
 * than one person's menu — the "coming soon" placeholder has to be able to
 * name a module whether or not the reader is offered it.
 */
export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_CATALOGUE.flatMap((group) => group.items).find((item) =>
    item.to === "/" ? pathname === "/" : pathname.startsWith(item.to),
  );
}
