/**
 * Queue writes, as a resource route (T4.2).
 *
 * The worklist is meant to be mounted by every station module in Phases 5–7.
 * If its buttons posted to the route they happen to be rendered on, each of
 * those modules would have to grow the same action — six copies of one switch
 * statement, drifting apart. Instead the component submits here with a
 * `useFetcher`, and a host route mounts `<StationWorklist />` with no server
 * code of its own.
 *
 * A fetcher submission revalidates the loaders of whatever page it was fired
 * from, so the worklist refreshes itself after every action without this route
 * knowing which screen it was serving.
 *
 * Action-only: no `default` export, so nothing renders at `/queues/actions`.
 */

import { data } from "react-router";

import { ApiError, describeApiError } from "~/lib/api/client";
import {
  callEntry,
  callNext,
  completeEntry,
  enqueuePatient,
  requeueEntry,
  skipEntry,
} from "~/lib/api/queues";
import { requireStaffAction } from "~/lib/auth.server";
import { Priorities, Stations } from "~/models/enums";
import { isObjectId } from "~/models/primitives";
import type { Route } from "./+types/queue-actions";

/** Trimmed, or `undefined` when the field was left empty. */
function text(form: FormData, key: string): string | undefined {
  const raw = form.get(key);
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

export async function action({ request }: Route.ActionArgs) {
  const { accessToken, setCookie } = await requireStaffAction(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const opts = { token: accessToken };
  // A rotated token has to ride out on every exit, success or not.
  const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;

  const ok = (message: string) => data({ ok: true as const, message }, { headers });
  const fail = (message: string, status = 400) =>
    data({ ok: false as const, message }, { status, headers });

  // Validated rather than asserted: this is the boundary the brand exists for.
  const rawEntryId = form.get("entryId");
  const entryId = isObjectId(rawEntryId) ? rawEntryId : undefined;
  const rawStation = form.get("station");
  const station = Stations.is(rawStation) ? rawStation : undefined;
  const note = text(form, "note");

  try {
    switch (intent) {
      case "call-next": {
        if (!station) return fail("That station could not be identified.");

        const entry = await callNext(station, opts);
        // An empty queue is not a failure — the button stays pressable all day.
        return entry
          ? ok(`Called ${entry.patient.fullName}.`)
          : ok(`Nobody is waiting at ${Stations.label(station)}.`);
      }

      case "call": {
        if (!entryId) return fail("That patient could not be identified.");
        const entry = await callEntry(entryId, opts);
        return ok(`Called ${entry.patient.fullName}.`);
      }

      case "complete": {
        if (!entryId) return fail("That patient could not be identified.");
        const entry = await completeEntry(entryId, { note }, opts);
        return ok(`${entry.patient.fullName} is done here.`);
      }

      case "skip": {
        if (!entryId) return fail("That patient could not be identified.");
        const entry = await skipEntry(entryId, { note }, opts);
        return ok(`Skipped ${entry.patient.fullName} — they can be put back.`);
      }

      case "requeue": {
        if (!entryId) return fail("That patient could not be identified.");
        const entry = await requeueEntry(entryId, opts);
        return ok(`${entry.patient.fullName} is back on the list.`);
      }

      case "enqueue": {
        const rawVisitId = form.get("visitId");
        const rawPriority = form.get("priority");

        if (!isObjectId(rawVisitId) || !station) {
          return fail("Choose a visit and a station.");
        }

        const entry = await enqueuePatient(
          {
            visitId: rawVisitId,
            station,
            priority: Priorities.is(rawPriority) ? rawPriority : undefined,
            note,
          },
          opts,
        );

        return ok(`${entry.patient.fullName} added to ${Stations.label(station)}.`);
      }

      default:
        return fail("That action is not one this route can perform.");
    }
  } catch (error) {
    if (!ApiError.is(error)) throw error;

    // 409 here is always the same race: two people served the same patient.
    const message =
      error.status === 409
        ? "Someone else already moved that patient. The list has been refreshed."
        : describeApiError(error).description;

    return fail(message, error.status >= 400 ? error.status : 502);
  }
}
