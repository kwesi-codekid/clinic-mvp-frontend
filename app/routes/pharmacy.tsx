/**
 * The pharmacy (T7.2) — `/pharmacy`.
 *
 * Two views of the same counter, as tabs:
 *
 * - **The counter** — `GET /pharmacy/queue`, every script not yet fully
 *   dispensed, with live stock on each line so the counter knows what it can
 *   hand over before calling anyone forward. Pharmacy and admin only; the API
 *   403s everyone else, so the loader does not ask on their behalf.
 * - **The patient queue** — the `pharmacy` station's corridor, mounted from
 *   T4.2's {@link StationWorklist} like every other station module.
 *
 * **Where the names come from.** The queue payload carries ids, not patients —
 * the same script-first shape as the lab bench. Rather than fetch a visit per
 * row on every poll, the counter reads its names off the station queue it has
 * already loaded for the other tab: the patient standing at the pharmacy is
 * the patient whose script is being dispensed. A script whose patient is not
 * in the corridor (they went to the till first, or the queue moved on) simply
 * shows without a name — an honest blank rather than a guess.
 *
 * Polling lives on this route — one revalidation refreshes both tabs — so the
 * worklist mounts with `pollMs={0}`.
 */

import { format } from "date-fns";
import { Loader2Icon, PillIcon } from "lucide-react";
import { Link, useRevalidator } from "react-router";

import { ItemStatusPill, PrescriptionStatusPill, StockLevel } from "~/components/dispensing";
import { StationWorklist } from "~/components/station-worklist";
import { Card } from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { usePoll } from "~/hooks/use-poll";
import { getPharmacyQueue, listPrescriptions } from "~/lib/api/pharmacy";
import { getStationCounts, getStationQueue } from "~/lib/api/queues";
import { throwRouteError } from "~/lib/api/route-error";
import { requireStaff } from "~/lib/auth.server";
import type { Role } from "~/models/enums";
import {
  comparePrescriptions,
  isActiveItem,
  prescriptionProgress,
  type Prescription,
} from "~/models/pharmacy";

import type { Route } from "./+types/pharmacy";

export function meta() {
  return [{ title: "Pharmacy · Clinic" }];
}

/** Who `GET /pharmacy/queue` answers. Everyone else reads plain prescriptions. */
const COUNTER_ROLES: readonly Role[] = ["pharmacy", "admin"];

/** Same cadence as the station worklists — see `station-worklist.tsx`. */
const POLL_MS = 20_000;

/* -------------------------------------------------------------------------
   Loader
   ------------------------------------------------------------------------- */

export async function loader({ request }: Route.LoaderArgs) {
  const { accessToken, staff } = await requireStaff(request);
  const opts = { token: accessToken };
  const canCounter = staff.roles.some((role) => COUNTER_ROLES.includes(role));

  try {
    const [queue, counts, scripts] = await Promise.all([
      getStationQueue("pharmacy", {}, opts),
      getStationCounts(opts),
      // The counter for pharmacy staff; the open read for everyone else —
      // asking the API a question it will 403 helps nobody.
      canCounter
        ? getPharmacyQueue(opts)
        : listPrescriptions({ limit: 25 }, opts).then((page) => page.items),
    ]);

    // See the module note: names come from the corridor, not from a fetch per
    // row. Keyed by visit, which is what both payloads carry.
    const namesByVisit: Record<string, string> = {};
    for (const entry of queue.entries) {
      namesByVisit[entry.visitId] = entry.patient.fullName;
    }

    return {
      queue,
      counts,
      prescriptions: [...scripts].sort(comparePrescriptions),
      namesByVisit,
      canCounter,
    };
  } catch (error) {
    throwRouteError(error);
  }
}

/* -------------------------------------------------------------------------
   The counter
   ------------------------------------------------------------------------- */

function CounterTable({
  prescriptions,
  namesByVisit,
}: {
  prescriptions: readonly Prescription[];
  namesByVisit: Record<string, string>;
}) {
  if (prescriptions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-10 text-center text-sm text-muted-foreground">
        <PillIcon className="mx-auto mb-2 size-6" strokeWidth={1.5} />
        Nothing waiting to be dispensed.
      </p>
    );
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-10 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
              Patient
            </TableHead>
            <TableHead className="h-10 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
              Drugs
            </TableHead>
            <TableHead className="h-10 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
              Outstanding
            </TableHead>
            <TableHead className="h-10 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
              Prescribed
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {prescriptions.map((prescription) => {
            const progress = prescriptionProgress(prescription);
            const name = namesByVisit[prescription.visitId];
            const outstanding = prescription.items.filter(isActiveItem);
            // The one line most likely to stop the counter: what is short.
            const short = outstanding.find(
              (item) =>
                item.stockOnHand !== undefined && item.stockOnHand < item.quantityOutstanding,
            );

            return (
              <TableRow key={prescription.id}>
                <TableCell className="px-4 py-2.5">
                  <Link
                    to={`/pharmacy/prescriptions/${prescription.id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {name ?? "Open script"}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {name ? (
                      <Link to={`/visits/${prescription.visitId}`} className="hover:underline">
                        View the visit
                      </Link>
                    ) : (
                      "Patient is not in the pharmacy queue"
                    )}
                  </div>
                </TableCell>
                <TableCell className="px-4 py-2.5 text-sm">
                  {prescription.items.map((item) => item.drugName).join(", ")}
                  {short && (
                    <div className="pt-0.5">
                      <StockLevel
                        stockOnHand={short.stockOnHand}
                        required={short.quantityOutstanding}
                      />
                    </div>
                  )}
                </TableCell>
                <TableCell className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <PrescriptionStatusPill status={prescription.status} />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {progress.outstanding} of {progress.total} left
                    </span>
                  </div>
                </TableCell>
                <TableCell className="px-4 py-2.5 text-sm" suppressHydrationWarning>
                  {format(new Date(prescription.prescribedAt), "d MMM, HH:mm")}
                  {prescription.prescribedByName && (
                    <div className="text-xs text-muted-foreground">
                      {prescription.prescribedByName}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

/** The open read for staff without the counter: recent scripts, one row each. */
function ScriptsList({ prescriptions }: { prescriptions: readonly Prescription[] }) {
  if (prescriptions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-10 text-center text-sm text-muted-foreground">
        <PillIcon className="mx-auto mb-2 size-6" strokeWidth={1.5} />
        Nothing has been prescribed yet.
      </p>
    );
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <ul className="divide-y">
        {prescriptions.map((prescription) => (
          <li key={prescription.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Link
              to={`/pharmacy/prescriptions/${prescription.id}`}
              className="min-w-0 flex-1 text-sm hover:underline"
            >
              {prescription.items.map((item) => item.drugName).join(", ")}
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              {prescription.items.map((item) => (
                <ItemStatusPill key={item.id} status={item.status} />
              ))}
            </div>
            <span
              className="text-xs text-muted-foreground tabular-nums"
              suppressHydrationWarning
            >
              {format(new Date(prescription.prescribedAt), "d MMM, HH:mm")}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

export default function PharmacyPage({ loaderData }: Route.ComponentProps) {
  const { queue, counts, prescriptions, namesByVisit, canCounter } = loaderData;
  const revalidator = useRevalidator();

  // One poll for both tabs. Never on top of an in-flight revalidation.
  usePoll(() => revalidator.revalidate(), POLL_MS, revalidator.state === "idle");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Pharmacy</h1>
        <p className="text-sm text-muted-foreground">
          {canCounter
            ? "Scripts waiting to be dispensed, and the patients waiting at the counter."
            : "Recent prescriptions, and the patients waiting at the counter."}
        </p>
      </div>

      <Tabs defaultValue="counter">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="counter">{canCounter ? "Counter" : "Prescriptions"}</TabsTrigger>
            <TabsTrigger value="queue">Patient queue</TabsTrigger>
          </TabsList>
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {revalidator.state === "idle" ? (
              <>Updates every {Math.round(POLL_MS / 1000)}s</>
            ) : (
              <>
                <Loader2Icon className="size-3.5 animate-spin" />
                Refreshing…
              </>
            )}
          </span>
        </div>

        <TabsContent value="counter">
          {canCounter ? (
            <CounterTable prescriptions={prescriptions} namesByVisit={namesByVisit} />
          ) : (
            <ScriptsList prescriptions={prescriptions} />
          )}
        </TabsContent>

        <TabsContent value="queue">
          {/* The route already polls for both tabs — see above. */}
          <StationWorklist queue={queue} counts={counts} pollMs={0} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
