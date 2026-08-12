/**
 * Any station's worklist (T4.2) — `/queues/:station`.
 *
 * A thin host: it resolves the station from the URL, loads the queue and the
 * counts strip, and mounts {@link StationWorklist}. Everything the screen
 * actually does lives in that component and in the `/queues/actions` resource
 * route, which is what lets Phases 5–7 give lab, pharmacy and the till their
 * own richer screens without any of them re-implementing a queue.
 *
 * `/opd` is the same worklist pinned to `consulting`; see `routes/opd.tsx`.
 */

import { StationWorklist } from "~/components/station-worklist";
import { PageHeader } from "~/components/page-header";
import { getStationCounts, getStationQueue } from "~/lib/api/queues";
import { throwRouteError } from "~/lib/api/route-error";
import { requireStaff } from "~/lib/auth.server";
import { Stations } from "~/models/enums";
import type { Route } from "./+types/station-queue";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: loaderData
        ? `${Stations.label(loaderData.queue.station)} queue · Clinic`
        : "Queue · Clinic",
    },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { accessToken } = await requireStaff(request);

  const station = params.station;
  if (!Stations.is(station)) {
    // Not a station the clinic has — a 404 the route boundary can render.
    throw new Response("Unknown station", { status: 404, statusText: "Not Found" });
  }

  const opts = { token: accessToken };

  try {
    const [queue, counts] = await Promise.all([
      getStationQueue(station, {}, opts),
      // Cheap, and it is what tells a nurse the lab is backing up without
      // leaving her own worklist.
      getStationCounts(opts),
    ]);

    return { queue, counts };
  } catch (error) {
    throwRouteError(error);
  }
}

export default function StationQueuePage({ loaderData }: Route.ComponentProps) {
  const { queue, counts } = loaderData;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${Stations.label(queue.station)} queue`}
        description="Ordered by priority, then arrival — an emergency jumps the queue here exactly as it does in the corridor."
        backTo="/visits"
        backLabel="Back to visits"
      />

      <StationWorklist queue={queue} counts={counts} />
    </div>
  );
}
