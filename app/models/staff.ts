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

/* -------------------------------------------------------------------------
   Write models
   ------------------------------------------------------------------------- */

/**
 * A licence as submitted. Deliberately not {@link ProfessionalLicence}:
 * `expired` is the API's to compute and must never be sent back.
 */
export type ProfessionalLicenceInput = {
  council: LicenceCouncil;
  number?: string;
  /** Full ISO datetime — widen a `YYYY-MM-DD` picker value before sending. */
  expiresAt?: IsoDateTime;
};

/**
 * Body of `POST /staff`.
 *
 * `password` is set once, here; afterwards it can only be reset through
 * {@link UpdateStaff}. Omitting `staffNumber` lets the API assign one.
 */
export type CreateStaff = {
  staffNumber?: string;
  title?: string;
  firstName: string;
  surname: string;
  otherNames?: string;
  email: string;
  phone?: string;
  password: string;
  /** At least one — the API rejects an empty list. */
  roles: Role[];
  station?: Station | null;
  specialty?: string;
  licence?: ProfessionalLicenceInput;
};

/**
 * Body of `PATCH /staff/{id}` — a **sparse** patch: only the keys present are
 * touched. Omit a field to leave it as it is.
 *
 * `active: false` is what `DELETE /staff/{id}` does, and `active: true` is the
 * only way back from it.
 */
export type UpdateStaff = Partial<CreateStaff> & {
  active?: boolean;
};
