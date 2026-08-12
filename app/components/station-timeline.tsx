/**
 * The station-history timeline (T3.2) — the patient's route through the clinic
 * with the time each leg took.
 *
 * `Visit.stationHistory` is the API's own turnaround record: it opens an entry
 * when a patient arrives at a station and closes it on the move, filling in
 * `exitedAt` and `minutes`. So the **open** entry — the one with no `exitedAt`
 * — is where the patient is standing right now, and its elapsed time is a live
 * wait, not a recorded one. The two are drawn differently on purpose: one is a
 * fact, the other is still running.
 */

import { format } from "date-fns";
import { CircleDotIcon, CircleIcon } from "lucide-react";

import { Stations } from "~/models/enums";
import { formatMinutes, type StationVisitRecord } from "~/models/visit";
import { cn } from "~/lib/utils";

export function StationTimeline({
  history,
  now = Date.now(),
}: {
  history: readonly StationVisitRecord[];
  /** Timestamp the live leg is measured against; see {@link VisitHeader}. */
  now?: number;
}) {
  if (history.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
        This visit has not reached a station yet.
      </p>
    );
  }

  return (
    <ol className="space-y-0">
      {history.map((record, index) => {
        const open = record.exitedAt === undefined;
        const last = index === history.length - 1;
        const minutes = open
          ? Math.max(0, Math.round((now - new Date(record.enteredAt).getTime()) / 60_000))
          : record.minutes;

        return (
          <li key={`${record.station}-${record.enteredAt}`} className="flex gap-3">
            {/* Rail: the marker, then the line down to the next leg. */}
            <div className="flex flex-col items-center">
              {open ? (
                <CircleDotIcon className="size-4 shrink-0 text-primary" />
              ) : (
                <CircleIcon className="size-4 shrink-0 text-muted-foreground" />
              )}
              {!last && <span aria-hidden className="w-px flex-1 bg-border" />}
            </div>

            <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-5")}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className={cn("font-medium", open && "text-primary")}>
                  {Stations.label(record.station)}
                </span>
                <span
                  className="text-sm tabular-nums text-muted-foreground"
                  suppressHydrationWarning
                >
                  {minutes !== undefined && (open ? `${formatMinutes(minutes)} so far` : formatMinutes(minutes))}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                {format(new Date(record.enteredAt), "HH:mm")}
                {record.exitedAt && ` – ${format(new Date(record.exitedAt), "HH:mm")}`}
                {record.servedByName && ` · ${record.servedByName}`}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
