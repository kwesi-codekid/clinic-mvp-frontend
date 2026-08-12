/**
 * Visit — one attendance at the clinic, and the spine everything clinical
 * hangs off (T3.1).
 *
 * Modelled from `components.schemas.{PayerSnapshot, StationVisitRecord,
 * VisitSummary, Visit, CheckIn, MoveStation, CloseVisit}`.
 *
 * Three conventions in here are easy to get wrong:
 *
 * 1. **The payer is frozen.** {@link PayerSnapshot} is the cover as it stood
 *    at check-in, copied onto the visit so pricing and claims stay
 *    reconcilable after tariffs change or membership lapses. Never render a
 *    visit — or its bill — using the patient's *current* `PayerProfile`.
 * 2. **The station history is the clock.** `Visit.stationHistory` is what
 *    turnaround reporting reads; the API closes an entry when the patient
 *    moves, so an open entry (no `exitedAt`) is where they are standing now.
 * 3. **Read and write shapes differ.** {@link Visit} carries computed fields
 *    (`visitNumber`, `totalMinutes`, the snapshot's `label`/`valid`); the
 *    write models carry none of them.
 */

import type {
  Disposition,
  MembershipStatus,
  NhisExemptionCategory,
  PayerType,
  Priority,
  Station,
  VisitStatus,
  VisitType,
} from "./enums";
import type { PatientSummary } from "./patient";
import type { IsoDate, IsoDateTime, ObjectId } from "./primitives";

/* -------------------------------------------------------------------------
   Leaf objects (L1)
   ------------------------------------------------------------------------- */

/**
 * The payer as it stood at check-in.
 *
 * Frozen onto the visit deliberately: a scheme that lapses on Tuesday must not
 * retroactively change what Monday's attendance cost, and a claim vetted in
 * March has to price against the tariff that applied in February.
 *
 * `copayPercent` is the share the patient owes on top of what the scheme
 * covers — 0 for full cover, 100 for a cash visit. Phase 8 splits every charge
 * line on it.
 */
export type PayerSnapshot = {
  payerType: PayerType;
  schemeId?: ObjectId;
  schemeName?: string;
  /** Human-readable payer name — render this rather than the enum label. */
  label: string;
  memberNumber?: string;
  exemptionCategory?: NhisExemptionCategory;
  status: MembershipStatus;
  expiresAt?: IsoDateTime;
  /** The patient's share, 0–100. */
  copayPercent: number;
  /** Whether the cover was good **at check-in**. Not re-derived since. */
  valid: boolean;
};

/**
 * One leg of a patient's route through the clinic.
 *
 * `exitedAt` and `minutes` are absent while the patient is still at that
 * station — which is what makes the open entry the current one.
 */
export type StationVisitRecord = {
  station: Station;
  enteredAt: IsoDateTime;
  exitedAt?: IsoDateTime;
  servedByName?: string;
  /** Time spent at this station, filled in on exit. */
  minutes?: number;
};

/* -------------------------------------------------------------------------
   The visit (L3)
   ------------------------------------------------------------------------- */

/** Compact visit record for lists and worklists. */
export type VisitSummary = {
  id: ObjectId;
  /** The number written on the day sheet, e.g. `V2026-0142`. */
  visitNumber: string;
  patient: PatientSummary;
  type: VisitType;
  priority: Priority;
  status: VisitStatus;
  /** Cover as at check-in — see {@link PayerSnapshot}. */
  payer: PayerSnapshot;
  /** Where the patient is now; `null` once the visit is closed or cancelled. */
  currentStation: Station | null;
  chiefComplaint?: string;
  arrivedAt: IsoDateTime;
  closedAt?: IsoDateTime;
  /** True when this attendance is the patient's first. */
  isNewPatient: boolean;
};

/** A full visit, including every station it passed through. */
export type Visit = VisitSummary & {
  /** Ordered oldest-first; the last entry is the current station. */
  stationHistory: StationVisitRecord[];
  /** How the visit ended. Absent while it is open, and on a cancellation. */
  disposition?: Disposition;
  reviewDate?: IsoDate;
  referredTo?: string;
  referralReason?: string;
  /** The bill raised for this visit (Phase 8). */
  invoiceId?: ObjectId;
  /** Set when the disposition was `admitted`. */
  admissionId?: ObjectId;
  /** Arrival to closure, in minutes. Only on a closed visit. */
  totalMinutes?: number;
};

/* -------------------------------------------------------------------------
   Write models
   ------------------------------------------------------------------------- */

/**
 * Body of `POST /visits`.
 *
 * Only `patientId` is required — the API defaults the type, the priority and
 * the payer, and places the patient on the first station queue for that visit
 * type. Send the payer fields to check in against something other than the
 * folder's primary cover.
 *
 * Note what the API does with lapsed cover: it checks the visit in as **cash**
 * rather than accruing charges a scheme would later refuse. That decision
 * lands in {@link PayerSnapshot}, so read the response rather than assuming
 * the payer that was sent.
 */
export type CheckIn = {
  patientId: ObjectId;
  /** Defaults to `opd`. */
  type?: VisitType;
  /** Defaults to `routine`. */
  priority?: Priority;
  chiefComplaint?: string;
  /** Overrides the folder's primary payer for this visit only. */
  payerType?: PayerType;
  schemeId?: ObjectId;
  memberNumber?: string;
  /** Overrides the first station of the default route for this visit type. */
  station?: Station;
};

/**
 * Body of `POST /visits/{id}/move`.
 *
 * Omit `station` to follow the default route for the visit type — the usual
 * case, and the one that keeps the clinic's own routing authoritative. The
 * move closes the current station-history entry, which is what captures time
 * spent for turnaround reporting.
 */
export type MoveStation = {
  station?: Station;
  /** Re-triages the patient on the receiving queue. */
  priority?: Priority;
  note?: string;
};

/**
 * Body of `POST /visits/{id}/close`.
 *
 * `referredTo`/`referralReason` belong to a `referred` disposition, and
 * `reviewDate` to a patient being asked back — the API does not enforce that
 * pairing, so the UI is what keeps it honest.
 */
export type CloseVisit = {
  disposition?: Disposition;
  reviewDate?: IsoDate;
  referredTo?: string;
  referralReason?: string;
};

/**
 * Body of `POST /visits/{id}/cancel` — for a patient who left before being
 * seen. Distinct from closing: nothing clinical happened, so there is no
 * disposition to record.
 */
export type CancelVisit = {
  reason?: string;
};

/* -------------------------------------------------------------------------
   Derived views
   ------------------------------------------------------------------------- */

/** True while the visit still accepts work. */
export function isVisitOpen(visit: VisitSummary): boolean {
  return visit.status === "open";
}

/**
 * The station-history entry the patient is standing in — the open one, i.e.
 * the leg with no `exitedAt`. Absent on a closed or cancelled visit.
 */
export function currentStationRecord(visit: Visit): StationVisitRecord | undefined {
  return visit.stationHistory.find((record) => record.exitedAt === undefined);
}

/**
 * Minutes since the patient arrived, for an open visit; `totalMinutes` for one
 * that has ended.
 *
 * Takes a {@link VisitSummary} so worklist rows can call it too — `totalMinutes`
 * only rides on the full {@link Visit}, and its absence simply means "still
 * running". Computed against `now` rather than the clock so a caller can keep
 * SSR and hydration agreeing on a single timestamp.
 */
export function visitElapsedMinutes(
  visit: VisitSummary & Pick<Partial<Visit>, "totalMinutes">,
  now: number,
): number {
  if (visit.totalMinutes !== undefined) return visit.totalMinutes;
  const arrived = new Date(visit.arrivedAt).getTime();
  return Math.max(0, Math.round((now - arrived) / 60_000));
}

/** `2h 15m`, `45m` — a wait written the way a triage desk says it. */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * Whether this visit's cover was already bad when it started.
 *
 * The trigger for the notice on the visit header: the visit is accruing
 * charges the scheme is likely to refuse, and the till needs to know before
 * the patient reaches it — not after.
 */
export function hasLapsedCover(visit: VisitSummary): boolean {
  return visit.payer.payerType !== "cash" && !visit.payer.valid;
}
