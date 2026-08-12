/**
 * Queues tag — `/queues/*`.
 *
 * Note the API's vocabulary, which differs from the sketch in TASK.md: a
 * patient is enqueued with a plain `POST /queues` (the station rides in the
 * body), the per-patient actions live under `/queues/entries/{id}/…` rather
 * than `/queues/{id}/…`, there is a station-level `call-next`, and a skipped
 * patient can be put back with `requeue` — which TASK.md does not mention at
 * all and which is the difference between a missed call and a lost patient.
 *
 * **On realtime.** TASK.md records "no websocket in the spec". The spec says
 * otherwise: `StationQueue` is "broadcast on `queue:updated`", `GET /queues`
 * is "also pushed live on the `queue:counters` socket event", and
 * `GET /queues/{station}` documents a `queue:subscribe` room. What is *not*
 * documented anywhere is the socket URL, namespace or auth handshake, so this
 * client polls — a fallback the spec itself endorses elsewhere ("poll this …
 * if not using the socket"). See `~/hooks/use-poll`. Swapping in Socket.io
 * later replaces the transport, not these functions.
 */

import type { Station } from "~/models/enums";
import type { ObjectId } from "~/models/primitives";
import type {
  EnqueuePatient,
  QueueAction,
  QueueEntry,
  StationCount,
  StationQueue,
} from "~/models/queue";
import { request, type RequestOptions } from "./client";

/** Filters accepted by `GET /queues/{station}`. */
export type StationQueueQuery = {
  /** Narrow to one status. Omitted, the API returns the active list. */
  status?: QueueEntry["status"];
  /** Include entries already finished today. Defaults to false. */
  includeCompleted?: boolean;
};

/**
 * Waiting counts for every station — the dashboard strip.
 *
 * Cheap enough to sit alongside a worklist: it is what tells a nurse the lab
 * is backing up without leaving her own screen.
 */
export function getStationCounts(options: RequestOptions): Promise<StationCount[]> {
  return request<StationCount[]>("/queues", options);
}

/**
 * One station's worklist, ordered by priority then arrival.
 *
 * Any signed-in staff member may read any queue — the front desk needs to see
 * where the crowd is. Serving one is what the API restricts.
 */
export function getStationQueue(
  station: Station,
  query: StationQueueQuery,
  options: RequestOptions,
): Promise<StationQueue> {
  return request<StationQueue>(`/queues/${station}`, {
    ...options,
    query: { ...options.query, ...query },
  });
}

/**
 * Put a visit on a station worklist.
 *
 * For side-trips off the default route — sending a patient to the lab and
 * back. To move a visit *along* its route, use `moveVisit`, which also closes
 * the station-history entry and so keeps turnaround reporting honest.
 */
export function enqueuePatient(
  input: EnqueuePatient,
  options: RequestOptions,
): Promise<QueueEntry> {
  return request<QueueEntry>("/queues", { ...options, method: "POST", body: input });
}

/**
 * Call the next patient at a station.
 *
 * Resolves to `null` when nobody is waiting — an empty queue is not an error,
 * and the button that triggers this stays pressable all day.
 */
export function callNext(
  station: Station,
  options: RequestOptions,
): Promise<QueueEntry | null> {
  return request<QueueEntry | null>(`/queues/${station}/call-next`, {
    ...options,
    method: "POST",
  });
}

/** Call one patient out of turn. A `409` means they are no longer waiting. */
export function callEntry(id: ObjectId, options: RequestOptions): Promise<QueueEntry> {
  return request<QueueEntry>(`/queues/entries/${id}/call`, { ...options, method: "POST" });
}

/** Mark an entry done — the patient has been seen at this station. */
export function completeEntry(
  id: ObjectId,
  input: QueueAction,
  options: RequestOptions,
): Promise<QueueEntry> {
  return request<QueueEntry>(`/queues/entries/${id}/complete`, {
    ...options,
    method: "POST",
    body: input,
  });
}

/** Skip a patient who did not answer. Recoverable — see {@link requeueEntry}. */
export function skipEntry(
  id: ObjectId,
  input: QueueAction,
  options: RequestOptions,
): Promise<QueueEntry> {
  return request<QueueEntry>(`/queues/entries/${id}/skip`, {
    ...options,
    method: "POST",
    body: input,
  });
}

/**
 * Return a skipped patient to the queue.
 *
 * The counterpart to {@link skipEntry}, and the reason skipping is safe: a
 * patient who stepped out to the toilet when called has not lost their place
 * in the clinic, only their turn.
 */
export function requeueEntry(id: ObjectId, options: RequestOptions): Promise<QueueEntry> {
  return request<QueueEntry>(`/queues/entries/${id}/requeue`, { ...options, method: "POST" });
}
