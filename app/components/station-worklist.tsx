/**
 * The station worklist (T4.2) — one component, every station.
 *
 * Vitals, consulting, lab, pharmacy, cashier, injection, ANC and the ward all
 * work the same way: a list ordered by priority then arrival, five counters,
 * and four things you can do to a patient — call them, finish with them, skip
 * them when they do not answer, and put them back when they reappear. Phases
 * 5–7 mount this rather than each rolling its own list, so a change to how a
 * queue behaves lands at every station at once.
 *
 * It carries no server code. The buttons post to the `/queues/actions`
 * resource route through a `useFetcher`, which revalidates the host page's
 * loaders — so mounting it costs a host route one `getStationQueue` call in
 * its loader and nothing else.
 *
 * **Staying current.** The spec broadcasts `queue:updated` over Socket.io but
 * documents no socket URL, namespace or handshake, so this polls the loader on
 * an interval instead (see `~/hooks/use-poll`, and the note in
 * `~/lib/api/queues`). Polling pauses while the tab is hidden and resumes on
 * return. When the socket is documented, it replaces {@link usePoll} here and
 * nothing else changes.
 */

import { useEffect } from "react";
import {
  BellRingIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  Loader2Icon,
  PhoneCallIcon,
  RotateCcwIcon,
  SkipForwardIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
} from "lucide-react";
import { Link, useFetcher, useRevalidator } from "react-router";
import { toast } from "sonner";

import { avatarTint, initialsOf, StatusPill } from "~/components/directory";
import { PriorityPill } from "~/components/visit-header";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { usePoll } from "~/hooks/use-poll";
import { cn } from "~/lib/utils";
import { QueueStatuses, Sexes, Stations, type Station } from "~/models/enums";
import { formatMinutes } from "~/models/visit";
import { isLongWait, type QueueEntry, type StationCount, type StationQueue } from "~/models/queue";

/** Where the queue writes are handled. See `routes/queue-actions.tsx`. */
const ACTIONS = "/queues/actions";

/**
 * How often the worklist re-reads its station.
 *
 * TASK.md suggests 15–30s; 20s is the middle of that. Fast enough that a
 * patient called at the next desk disappears from this one before anyone acts
 * on stale information, slow enough not to punish a clinic's network.
 */
const POLL_MS = 20_000;

/* -------------------------------------------------------------------------
   Counters
   ------------------------------------------------------------------------- */

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warning";
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd
        className={cn(
          "font-heading text-2xl font-semibold tracking-tight tabular-nums",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------
   Rows
   ------------------------------------------------------------------------- */

type QueueResult = { ok: boolean; message: string };

/**
 * A fetcher that says what happened.
 *
 * Every queue action is a one-click write with no screen of its own to report
 * back on, and a `409` ("someone else already called that patient") is a
 * normal race in a room with four terminals — so the answer has to be a toast
 * or it is nothing at all.
 */
function useQueueFetcher() {
  const fetcher = useFetcher<QueueResult>();

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const notify = fetcher.data.ok ? toast.success : toast.error;
    notify(fetcher.data.message);
  }, [fetcher.data, fetcher.state]);

  return fetcher;
}

/** The actions available against one entry, given where it stands. */
function RowActions({ entry }: { entry: QueueEntry }) {
  const fetcher = useQueueFetcher();
  const busy = fetcher.state !== "idle";

  return (
    <fetcher.Form method="post" action={ACTIONS} className="flex justify-end gap-1.5">
      <input type="hidden" name="entryId" value={entry.id} />

      {entry.status === "waiting" && (
        <>
          <Button type="submit" name="intent" value="call" size="sm" disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : <PhoneCallIcon />}
            Call
          </Button>
          <Button
            type="submit"
            name="intent"
            value="skip"
            size="sm"
            variant="outline"
            disabled={busy}
            aria-label={`Skip ${entry.patient.fullName}`}
          >
            <SkipForwardIcon />
          </Button>
        </>
      )}

      {entry.status === "in_service" && (
        <>
          <Button type="submit" name="intent" value="complete" size="sm" disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
            Done
          </Button>
          <Button
            type="submit"
            name="intent"
            value="skip"
            size="sm"
            variant="outline"
            disabled={busy}
            aria-label={`Skip ${entry.patient.fullName}`}
          >
            <SkipForwardIcon />
          </Button>
        </>
      )}

      {entry.status === "skipped" && (
        <Button
          type="submit"
          name="intent"
          value="requeue"
          size="sm"
          variant="outline"
          disabled={busy}
        >
          {busy ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />}
          Put back
        </Button>
      )}

      {/* `done` and `left` are terminal — nothing to offer. The intent always
          rides on the submit button, never a hidden input, so one form can
          carry several actions without them shadowing each other. */}
      {(entry.status === "done" || entry.status === "left") && (
        <span className="text-xs text-muted-foreground">—</span>
      )}
    </fetcher.Form>
  );
}

function StatusCell({ entry }: { entry: QueueEntry }) {
  switch (entry.status) {
    case "in_service":
      return <StatusPill tone="positive">Being seen</StatusPill>;
    case "waiting":
      return <StatusPill tone="muted">Waiting</StatusPill>;
    case "skipped":
      return <StatusPill tone="warning">Skipped</StatusPill>;
    default:
      return (
        <span className="text-sm text-muted-foreground">
          {QueueStatuses.label(entry.status)}
        </span>
      );
  }
}

/* -------------------------------------------------------------------------
   Station switcher
   ------------------------------------------------------------------------- */

/**
 * Every station's waiting count, as links.
 *
 * `GET /queues` is described in the spec as "the dashboard strip", and it earns
 * its place here too: a nurse needs to see that the lab is backing up without
 * leaving her own worklist.
 */
function StationSwitcher({
  current,
  counts,
}: {
  current: Station;
  counts: StationCount[];
}) {
  if (counts.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {counts.map((count) => {
        const active = count.station === current;
        const busy = count.waiting + count.inService;

        return (
          <Link
            key={count.station}
            to={`/queues/${count.station}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {Stations.label(count.station)}
            <span
              className={cn(
                "rounded-full px-1.5 text-[11px] font-medium tabular-nums",
                active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
              )}
            >
              {busy}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------
   The worklist
   ------------------------------------------------------------------------- */

export function StationWorklist({
  queue,
  counts = [],
  pollMs = POLL_MS,
}: {
  queue: StationQueue;
  /** Waiting counts for the switcher. Omit to hide it. */
  counts?: StationCount[];
  /** Override the polling interval; `0` disables it. */
  pollMs?: number;
}) {
  const revalidator = useRevalidator();
  const callNext = useQueueFetcher();

  // Never poll on top of an in-flight revalidation — the requests would stack
  // up on exactly the slow network that made one slow in the first place.
  usePoll(() => revalidator.revalidate(), pollMs, revalidator.state === "idle");

  const calling = callNext.state !== "idle";
  const nothingWaiting = queue.waiting === 0;

  return (
    <div className="space-y-4">
      <StationSwitcher current={queue.station} counts={counts} />

      <Card className="gap-0 overflow-hidden py-0">
        {/* Counters — the API's own, never a recount of `entries`. */}
        <div className="flex flex-wrap items-end justify-between gap-4 border-b p-4">
          <dl className="flex flex-wrap gap-x-8 gap-y-3">
            <Counter label="Waiting" value={String(queue.waiting)} />
            <Counter label="Being seen" value={String(queue.inService)} />
            <Counter label="Done today" value={String(queue.completedToday)} />
            <Counter
              label="Longest wait"
              value={formatMinutes(queue.longestWaitMinutes)}
              tone={isLongWait(queue.longestWaitMinutes) ? "warning" : undefined}
            />
            <Counter label="Average wait" value={formatMinutes(queue.averageWaitMinutes)} />
          </dl>

          <callNext.Form method="post" action={ACTIONS}>
            <input type="hidden" name="intent" value="call-next" />
            <input type="hidden" name="station" value={queue.station} />
            <Button type="submit" disabled={calling || nothingWaiting}>
              {calling ? <Loader2Icon className="animate-spin" /> : <BellRingIcon />}
              Call next
            </Button>
          </callNext.Form>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-11 w-14 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                #
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Patient
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Visit
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Waiting
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Status
              </TableHead>
              <TableHead className="h-11 px-4 text-right text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {queue.entries.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  <UsersRoundIcon className="mx-auto mb-2 size-6" strokeWidth={1.5} />
                  Nobody is waiting at {Stations.label(queue.station)}.
                </TableCell>
              </TableRow>
            )}

            {queue.entries.map((entry) => {
              const serving = entry.status === "in_service";
              const waited = isLongWait(entry.waitingMinutes) && entry.status === "waiting";

              return (
                <TableRow key={entry.id} className={cn(serving && "bg-primary/5")}>
                  <TableCell className="w-14 px-4 py-3">
                    {/* 0 means "being seen" — a number nobody in the waiting
                        room is listening for. */}
                    {entry.position > 0 ? (
                      <span className="font-heading text-lg font-semibold tabular-nums">
                        {entry.position}
                      </span>
                    ) : (
                      <ChevronRightIcon className="size-5 text-primary" />
                    )}
                  </TableCell>

                  <TableCell className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarFallback
                          className={cn(
                            "text-xs font-semibold uppercase",
                            avatarTint(entry.patient.id),
                          )}
                        >
                          {initialsOf(entry.patient.firstName, entry.patient.surname)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={`/visits/${entry.visitId}`}
                            className="truncate font-medium hover:underline"
                          >
                            {entry.patient.fullName}
                          </Link>
                          <PriorityPill priority={entry.priority} />
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          <span className="font-mono">{entry.patient.folderNumber}</span> ·{" "}
                          {entry.patient.age.display} {Sexes.label(entry.patient.sex)}
                        </div>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="px-4 py-3">
                    {entry.visitNumber ? (
                      <Link
                        to={`/visits/${entry.visitId}`}
                        className="font-mono text-xs hover:underline"
                      >
                        {entry.visitNumber}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {entry.servedByName && (
                      <div className="text-xs text-muted-foreground">{entry.servedByName}</div>
                    )}
                  </TableCell>

                  <TableCell className="px-4 py-3">
                    {/* Server-computed, so SSR and hydration agree. */}
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 tabular-nums",
                        waited && "font-medium text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {waited ? (
                        <TriangleAlertIcon className="size-3.5" />
                      ) : (
                        <ClockIcon className="size-3.5 text-muted-foreground" />
                      )}
                      {formatMinutes(entry.waitingMinutes)}
                    </span>
                    {entry.note && (
                      <div className="truncate text-xs text-muted-foreground">{entry.note}</div>
                    )}
                  </TableCell>

                  <TableCell className="px-4 py-3">
                    <StatusCell entry={entry} />
                  </TableCell>

                  <TableCell className="px-4 py-3 text-right">
                    <RowActions entry={entry} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-sm text-muted-foreground">
          <span>
            {queue.entries.length === 0
              ? "Nobody on this list"
              : `${queue.entries.length} on this list · ordered by priority, then arrival`}
          </span>
          <span className="flex items-center gap-1.5">
            {revalidator.state === "idle" ? (
              <>Updates every {Math.round(pollMs / 1000)}s</>
            ) : (
              <>
                <Loader2Icon className="size-3.5 animate-spin" />
                Refreshing…
              </>
            )}
          </span>
        </div>
      </Card>
    </div>
  );
}
