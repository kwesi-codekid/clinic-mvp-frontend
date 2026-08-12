/**
 * Queues — the corridor, modelled (T4.1).
 *
 * Modelled from `components.schemas.{QueueEntry, StationQueue, StationCount,
 * EnqueuePatient, QueueAction}`.
 *
 * A {@link QueueEntry} is one patient on one station's worklist. A visit
 * generates several over its life — vitals, then consulting, then perhaps lab
 * and back — which is why the entry carries `visitId` rather than the visit
 * carrying the queue.
 *
 * Two conventions worth stating up front:
 *
 * 1. **Order is priority, then arrival.** The API returns entries already
 *    sorted "so an emergency jumps the queue exactly as it does in the
 *    corridor". {@link compareQueueEntries} reproduces that rule for any code
 *    that re-sorts client-side — never sort on the raw priority string, which
 *    would order alphabetically: emergency, routine, urgent.
 * 2. **`position` is 1-based, and 0 means "being seen".** It is the number
 *    called out in the waiting room, not an array index.
 */

import type { Priority, QueueStatus, Station } from "./enums";
import { comparePriority } from "./enums";
import type { PatientSummary } from "./patient";
import type { IsoDateTime, ObjectId } from "./primitives";

/* -------------------------------------------------------------------------
   The entry (L3)
   ------------------------------------------------------------------------- */

/** One patient on one station worklist. */
export type QueueEntry = {
  id: ObjectId;
  visitId: ObjectId;
  visitNumber?: string;
  patient: PatientSummary;
  station: Station;
  priority: Priority;
  status: QueueStatus;
  /** 1-based place in the queue; `0` once the patient is being served. */
  position: number;
  enqueuedAt: IsoDateTime;
  calledAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  /** Minutes waited, or still waiting. Computed by the API. */
  waitingMinutes: number;
  servedByName?: string;
  note?: string;
};

/* -------------------------------------------------------------------------
   The worklist (L4)
   ------------------------------------------------------------------------- */

/**
 * A station worklist plus its live counters.
 *
 * The counters are the API's, not a count of `entries` — `completedToday`
 * covers patients who have long since left the list, and by default `entries`
 * holds only those still active. Render the counters; never recount the array.
 */
export type StationQueue = {
  station: Station;
  waiting: number;
  inService: number;
  completedToday: number;
  longestWaitMinutes: number;
  averageWaitMinutes: number;
  entries: QueueEntry[];
};

/** Waiting counts for one station, as returned by `GET /queues`. */
export type StationCount = {
  station: Station;
  waiting: number;
  inService: number;
};

/* -------------------------------------------------------------------------
   Write models
   ------------------------------------------------------------------------- */

/**
 * Body of `POST /queues` — puts a visit on a station worklist.
 *
 * For **side-trips off the default route**: sending a patient to the lab and
 * back mid-consultation. Moving a visit *along* its route is
 * `POST /visits/{id}/move`, which closes the current station-history entry;
 * this does not.
 */
export type EnqueuePatient = {
  visitId: ObjectId;
  station: Station;
  /** Defaults to the visit's own priority. */
  priority?: Priority;
  note?: string;
};

/** Body of the complete and skip actions. */
export type QueueAction = {
  note?: string;
};

/* -------------------------------------------------------------------------
   Derived views
   ------------------------------------------------------------------------- */

/** Still on the list: waiting to be called, or being seen right now. */
export function isActiveEntry(entry: QueueEntry): boolean {
  return entry.status === "waiting" || entry.status === "in_service";
}

/**
 * The corridor's sort: emergency before urgent before routine, and within a
 * priority, whoever arrived first.
 *
 * The API already returns entries in this order — this exists so a client-side
 * re-sort (a filtered view, an optimistic insert) cannot quietly disagree with
 * the queue the patients can see.
 */
export function compareQueueEntries(a: QueueEntry, b: QueueEntry): number {
  const byPriority = comparePriority(a.priority, b.priority);
  if (byPriority !== 0) return byPriority;
  return new Date(a.enqueuedAt).getTime() - new Date(b.enqueuedAt).getTime();
}

/**
 * The patient currently being seen at this station, if any.
 *
 * A station serves one at a time in the ordinary case; where it does not,
 * this is the one called longest ago.
 */
export function inServiceEntry(queue: StationQueue): QueueEntry | undefined {
  return queue.entries
    .filter((entry) => entry.status === "in_service")
    .sort((a, b) => new Date(a.calledAt ?? a.enqueuedAt).getTime() - new Date(b.calledAt ?? b.enqueuedAt).getTime())[0];
}

/** Everyone still waiting to be called, in the order they will be. */
export function waitingEntries(queue: StationQueue): QueueEntry[] {
  return queue.entries
    .filter((entry) => entry.status === "waiting")
    .sort(compareQueueEntries);
}

/**
 * True when someone has been waiting longer than a clinic should let them.
 *
 * Not an API field: the spec reports `longestWaitMinutes` without judging it.
 * This is the UI's own threshold, kept in one place so every station screen
 * draws the same line.
 */
export const LONG_WAIT_MINUTES = 60;

export function isLongWait(minutes: number): boolean {
  return minutes >= LONG_WAIT_MINUTES;
}
