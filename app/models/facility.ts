/**
 * Facility — the clinic this deployment serves.
 *
 * Modelled from `components.schemas.{FacilitySettings, Facility}`.
 *
 * This is a late *screen* but an early *dependency* (T14.2): the four boolean
 * flags on {@link FacilitySettings} are what the API calls "the settings that
 * switch modules on and off", so they gate navigation from the moment there is
 * a shell to navigate. A clinic with no lab must not be offered a Laboratory
 * module it cannot use.
 *
 * The write models (`UpdateFacility`, `InsuranceScheme` and friends) land with
 * the admin UI in T14.2 — nothing needs them yet.
 */

import type { FacilityType } from "./enums";
import type { IsoDateTime, ObjectId } from "./primitives";

/**
 * Per-deployment configuration.
 *
 * `folderFeePesewas` and `consultationFeePesewas` are integer pesewas like
 * every other money field — read them through `~/lib/money`, never as floats.
 */
export type FacilitySettings = {
  /** ISO 4217, e.g. `GHS`. */
  currency: string;
  /** IANA zone, e.g. `Africa/Accra`. The clinic day is defined in this zone. */
  timezone: string;
  folderFeePesewas: number;
  consultationFeePesewas: number;
  /** Runs an inpatient ward. */
  hasWard: boolean;
  /** Runs ANC, delivery and postnatal services. */
  hasMaternity: boolean;
  hasLab: boolean;
  hasPharmacy: boolean;
};

/**
 * The flags that switch a module on. Narrowed to the booleans on
 * {@link FacilitySettings} so a nav entry cannot be gated on `currency`.
 */
export type FacilityFeature = {
  [K in keyof FacilitySettings]: FacilitySettings[K] extends boolean ? K : never;
}[keyof FacilitySettings];

/** The clinic this deployment serves. */
export type Facility = {
  id: ObjectId;
  name: string;
  type: FacilityType;
  /** Health Facilities Regulatory Agency licence. */
  hefraLicenceNumber?: string;
  hefraLicenceExpiry?: IsoDateTime;
  /** Provider code claims are submitted under. */
  nhisProviderCode?: string;
  region: string;
  district: string;
  town?: string;
  addressLine?: string;
  ghanaPostGps?: string;
  phone?: string;
  altPhone?: string;
  email?: string;
  logoUrl?: string;
  settings: FacilitySettings;
};

/**
 * Whether a module the facility can switch off is switched on.
 *
 * Deliberately **open** when the facility is unknown: a failed or missing
 * `GET /facility` must not strip a nurse of her modules mid-shift. Navigation
 * is UX routing, not security — the API refuses what the clinic does not run,
 * and showing a module that 404s is a far smaller failure than hiding one the
 * clinic depends on.
 */
export function hasFeature(facility: Facility | null, feature: FacilityFeature): boolean {
  return facility === null || facility.settings[feature];
}
