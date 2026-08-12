/**
 * OPD — the consulting-room worklist (T4.2).
 *
 * OPD is not a second kind of record. The API has no `/opd` path and no OPD
 * schema: `opd` is one of the nine values of `Visit.type`, and as a *place*
 * the outpatient department is the `consulting` {@link Station}. So this
 * screen is that station's queue — who is waiting to be seen by a clinician,
 * in the order they will be seen.
 *
 * It is the same {@link StationWorklist} every other station mounts, pinned to
 * one station and given its own route so the sidebar has a stable home for it.
 * The generic `/queues/:station` covers the rest.
 */

import { StationWorklist } from "~/components/station-worklist";
import { PageHeader } from "~/components/page-header";
import { buttonVariants } from "~/components/ui/button";
import { LogInIcon } from "lucide-react";
import { Link } from "react-router";

import { getStationCounts, getStationQueue } from "~/lib/api/queues";
import { throwRouteError } from "~/lib/api/route-error";
import { requireStaff } from "~/lib/auth.server";
import type { Route } from "./+types/opd";

/** The station the outpatient department *is*. */
const STATION = "consulting" as const;

export function meta(_: Route.MetaArgs) {
  return [{ title: "OPD · Clinic" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { accessToken } = await requireStaff(request);
  const opts = { token: accessToken };

  try {
    const [queue, counts] = await Promise.all([
      getStationQueue(STATION, {}, opts),
      getStationCounts(opts),
    ]);

    return { queue, counts };
  } catch (error) {
    throwRouteError(error);
  }
}

export default function OpdPage({ loaderData }: Route.ComponentProps) {
  const { queue, counts } = loaderData;

  return (
    <div className="space-y-6">
      <PageHeader
        title="OPD"
        description="Patients waiting to be seen at the consulting room, most urgent first."
        backTo="/visits"
        backLabel="Back to visits"
      >
        <Link to="/visits/new" className={buttonVariants()}>
          <LogInIcon />
          Check in patient
        </Link>
      </PageHeader>

      <StationWorklist queue={queue} counts={counts} />
    </div>
  );
}
