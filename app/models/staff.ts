/**
 * Staff — the people who sign in and act in the system.
 *
 * Modelled from `components.schemas.Staff` and `ProfessionalLicence` in the
 * OpenAPI document. `roles[]` and `station` drive navigation and permissions
 * everywhere; treat the API as the authority and this as UX routing input.
 */

import type { LicenceCouncil, Role, Station } from "./enums";
import type { IsoDateTime, ObjectId } from "./primitives";

/** Registration with the council that licences this staff member. */
export type ProfessionalLicence = {
  council: LicenceCouncil;
  number?: string;
  expiresAt?: IsoDateTime;
  /** Computed by the API — do not re-derive from `expiresAt`. */
  expired: boolean;
};

/** A member of clinic staff. */
export type Staff = {
  id: ObjectId;
  staffNumber: string;
  title?: string;
  firstName: string;
  surname: string;
  otherNames?: string;
  /** Preassembled by the API — render this, never rejoin the name parts. */
  fullName: string;
  email: string;
  phone?: string;
  /** A staff member may hold several roles. */
  roles: Role[];
  /** Home station, or `null` for staff not tied to one (e.g. admin). */
  station: Station | null;
  specialty?: string;
  licence?: ProfessionalLicence;
  /** Inactive staff cannot sign in; keep them visible in admin lists. */
  active: boolean;
  lastLoginAt?: IsoDateTime;
  createdAt: IsoDateTime;
};
