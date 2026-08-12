/**
 * The laboratory (T6.2) — `/laboratory`.
 *
 * Two views of the same room, as tabs:
 *
 * - **The bench** — `GET /lab/worklist`, everything awaiting collection,
 *   result entry or verification, urgent first. Rows are *items*, keyed by
 *   accession number, because the bench works sample-first: the worklist
 *   payload deliberately carries no patient names, and the order page is
 *   where a specimen becomes a person again. Lab and admin only — the API
 *   403s everyone else, so the loader does not ask for it on their behalf.
 * - **The patient queue** — the `lab` station's corridor, mounted from
 *   T4.2's {@link StationWorklist} like every other station module. This is
 *   where "who is physically waiting for a draw" lives.
 *
 * Staff who can read orders but not the bench (any signed-in role) get the
 * recent-orders list where the bench would be.
 *
 * Polling lives on this route — one revalidation refreshes both tabs — so
 * the worklist mounts with `pollMs={0}`. The socket events (`lab:ordered`,
 * `lab:updated`) replace the poll when T0.5 lands.
 */

import { format } from "date-fns";
import { FlaskConicalIcon, Loader2Icon, TimerIcon } from "lucide-react";
import { Link, useRevalidator } from "react-router";

import { LabStatusPill, SpecimenBadge } from "~/components/lab-results";
import { StationWorklist } from "~/components/station-worklist";
import { PriorityPill } from "~/components/visit-header";
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
import { getLabWorklist, listLabOrders } from "~/lib/api/lab";
import { getStationCounts, getStationQueue } from "~/lib/api/queues";
import { throwRouteError } from "~/lib/api/route-error";
import { requireStaff } from "~/lib/auth.server";
import { cn } from "~/lib/utils";
import type { Role } from "~/models/enums";
import {
  BENCH_STAGES,
  compareLabOrders,
  itemsAtStage,
  orderProgress,
  type BenchStage,
  type LabOrder,
  type LabOrderItem,
} from "~/models/lab";

import type { Route } from "./+types/laboratory";

export function meta() {
  return [{ title: "Laboratory · Clinic" }];
}

/** Who `GET /lab/worklist` answers. Everyone else reads plain orders. */
const BENCH_ROLES: readonly Role[] = ["lab", "admin"];

/** Same cadence as the station worklists — see `station-worklist.tsx`. */
const POLL_MS = 20_000;

/* -------------------------------------------------------------------------
   Loader
   ------------------------------------------------------------------------- */

export async function loader({ request }: Route.LoaderArgs) {
  const { accessToken, staff } = await requireStaff(request);
  const opts = { token: accessToken };
  const canBench = staff.roles.some((role) => BENCH_ROLES.includes(role));

  try {
    const [queue, counts, worklist] = await Promise.all([
      getStationQueue("lab", {}, opts),
      getStationCounts(opts),
      // The bench for lab staff; the open read for everyone else — asking
      // the API a question it will 403 helps nobody.
      canBench
        ? getLabWorklist(opts)
        : listLabOrders({ limit: 25 }, opts).then((page) => page.items),
    ]);

    return {
      queue,
      counts,
      orders: [...worklist].sort(compareLabOrders),
      canBench,
    };
  } catch (error) {
    throwRouteError(error);
  }
}

/* -------------------------------------------------------------------------
   Bench rows
   ------------------------------------------------------------------------- */

/** One item on the bench, still attached to the order that owns it. */
type BenchRow = { order: LabOrder; item: LabOrderItem };

function benchRows(orders: readonly LabOrder[], stage: BenchStage): BenchRow[] {
  return orders.flatMap((order) =>
    itemsAtStage(order, stage).map((item) => ({ order, item })),
  );
}

function BenchTable({ rows, emptyText }: { rows: BenchRow[]; emptyText: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-10 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Accession
          </TableHead>
          <TableHead className="h-10 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Test
          </TableHead>
          <TableHead className="h-10 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Specimen
          </TableHead>
          <TableHead className="h-10 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Ordered
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={4} className="h-20 text-center text-sm text-muted-foreground">
              {emptyText}
            </TableCell>
          </TableRow>
        )}
        {rows.map(({ order, item }) => (
          <TableRow key={item.id}>
            <TableCell className="px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/laboratory/orders/${order.id}`}
                  className="font-mono text-sm font-semibold hover:underline"
                >
                  {order.accessionNumber}
                </Link>
                <PriorityPill priority={order.priority} />
              </div>
            </TableCell>
            <TableCell className="px-4 py-2.5">
              <span className="font-mono text-xs font-semibold">{item.testCode}</span>{" "}
              <span className="text-sm">{item.testName}</span>
            </TableCell>
            <TableCell className="px-4 py-2.5">
              <SpecimenBadge type={item.specimenType} />
            </TableCell>
            <TableCell className="px-4 py-2.5">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-sm tabular-nums",
                  // The API's own judgement against the test's target, so SSR
                  // and hydration agree — never a client-side clock.
                  item.overdue && "font-medium text-amber-600 dark:text-amber-400",
                )}
                suppressHydrationWarning
              >
                {item.overdue && <TimerIcon className="size-3.5" />}
                {format(new Date(order.orderedAt), "d MMM, HH:mm")}
              </span>
              {order.orderedByName && (
                <div className="text-xs text-muted-foreground">{order.orderedByName}</div>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The bench: one section per stage, urgent first inside each. */
function Bench({ orders }: { orders: readonly LabOrder[] }) {
  return (
    <div className="space-y-6">
      {BENCH_STAGES.map((stage) => {
        const rows = benchRows(orders, stage.status);
        return (
          <section key={stage.status} className="space-y-2">
            <h2 className="flex items-baseline gap-2 font-heading text-base font-semibold tracking-tight">
              {stage.label}
              <span className="text-sm font-normal text-muted-foreground tabular-nums">
                {rows.length}
              </span>
            </h2>
            <Card className="gap-0 overflow-hidden py-0">
              <BenchTable rows={rows} emptyText={`Nothing ${stage.label.toLowerCase()}.`} />
            </Card>
          </section>
        );
      })}
    </div>
  );
}

/** The open read for staff without the bench: recent orders, one row each. */
function OrdersList({ orders }: { orders: readonly LabOrder[] }) {
  if (orders.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-10 text-center text-sm text-muted-foreground">
        <FlaskConicalIcon className="mx-auto mb-2 size-6" strokeWidth={1.5} />
        No laboratory orders yet.
      </p>
    );
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-10 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
              Accession
            </TableHead>
            <TableHead className="h-10 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
              Tests
            </TableHead>
            <TableHead className="h-10 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
              Status
            </TableHead>
            <TableHead className="h-10 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
              Ordered
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => {
            const progress = orderProgress(order);
            return (
              <TableRow key={order.id}>
                <TableCell className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/laboratory/orders/${order.id}`}
                      className="font-mono text-sm font-semibold hover:underline"
                    >
                      {order.accessionNumber}
                    </Link>
                    <PriorityPill priority={order.priority} />
                  </div>
                </TableCell>
                <TableCell className="px-4 py-2.5 text-sm">
                  {order.items.map((item) => item.testCode).join(", ")}
                  <div className="text-xs text-muted-foreground">
                    {progress.verified} of {progress.total} verified
                  </div>
                </TableCell>
                <TableCell className="px-4 py-2.5">
                  <LabStatusPill status={order.status} />
                </TableCell>
                <TableCell className="px-4 py-2.5 text-sm" suppressHydrationWarning>
                  {format(new Date(order.orderedAt), "d MMM, HH:mm")}
                  {order.orderedByName && (
                    <div className="text-xs text-muted-foreground">{order.orderedByName}</div>
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

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

export default function LaboratoryPage({ loaderData }: Route.ComponentProps) {
  const { queue, counts, orders, canBench } = loaderData;
  const revalidator = useRevalidator();

  // One poll for both tabs. Never on top of an in-flight revalidation.
  usePoll(() => revalidator.revalidate(), POLL_MS, revalidator.state === "idle");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Laboratory</h1>
        <p className="text-sm text-muted-foreground">
          {canBench
            ? "The bench worklist by accession number, and the patients waiting at the station."
            : "Recent orders, and the patients waiting at the station."}
        </p>
      </div>

      <Tabs defaultValue="bench">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="bench">{canBench ? "Bench" : "Orders"}</TabsTrigger>
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

        <TabsContent value="bench">
          {canBench ? <Bench orders={orders} /> : <OrdersList orders={orders} />}
        </TabsContent>

        <TabsContent value="queue">
          {/* The route already polls for both tabs — see above. */}
          <StationWorklist queue={queue} counts={counts} pollMs={0} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
