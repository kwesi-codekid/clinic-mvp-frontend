/**
 * Laboratory orders for one visit (T6.2) — `/visits/:visitId/lab`.
 *
 * The clinician's side of the lab: order tests mid-consultation, then read the
 * results back on the same screen. The bench's side — collection, entry,
 * verification — lives under `/laboratory`, keyed by accession number.
 *
 * Two rules the layout encodes:
 *
 * 1. **Results show once verified.** The API returns entered-but-unverified
 *    values, but verification is "the second pair of eyes before a result
 *    reaches a clinician" — so an unverified item shows its status here, not
 *    its numbers. The bench screen is where unreleased values belong.
 * 2. **Ordering bills.** `POST /lab/orders` raises the charges in the same
 *    call, and the form says so above the submit button rather than after the
 *    fact.
 */

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { FlaskConicalIcon, Loader2Icon, SendIcon } from "lucide-react";
import { data, Form, Link, useNavigation } from "react-router";
import { toast } from "sonner";

import { LabStatusPill, ResultsTable, SpecimenBadge } from "~/components/lab-results";
import { LabTestPicker } from "~/components/lab-test-picker";
import { PageHeader } from "~/components/page-header";
import { PriorityPill, VisitHeader } from "~/components/visit-header";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { ApiError, describeApiError } from "~/lib/api/client";
import { createLabOrder, listLabOrders } from "~/lib/api/lab";
import { throwRouteError } from "~/lib/api/route-error";
import { getVisit } from "~/lib/api/visits";
import { requireStaff, requireStaffAction } from "~/lib/auth.server";
import { Priorities, type Role } from "~/models/enums";
import { compareLabOrders, orderProgress, type LabOrder, type LabTest } from "~/models/lab";
import { isObjectId, parseObjectId } from "~/models/primitives";
import type { Route } from "./+types/visit-lab";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.visit.patient.fullName;
  return [{ title: name ? `Lab · ${name} · Clinic` : "Lab · Clinic" }];
}

/** Who `POST /lab/orders` accepts — ordering is a clinical act. */
const ORDERING_ROLES: readonly Role[] = ["doctor", "physician_assistant", "midwife", "admin"];

/* -------------------------------------------------------------------------
   Loader
   ------------------------------------------------------------------------- */

export async function loader({ request, params }: Route.LoaderArgs) {
  const { accessToken, staff } = await requireStaff(request);
  const visitId = parseObjectId(params.visitId, "visit id");
  const opts = { token: accessToken };

  try {
    const [visit, ordersPage] = await Promise.all([
      getVisit(visitId, opts),
      listLabOrders({ visitId, limit: 50 }, opts),
    ]);

    return {
      visit,
      orders: [...ordersPage.items].sort(compareLabOrders),
      canOrder: staff.roles.some((role) => ORDERING_ROLES.includes(role)),
    };
  } catch (error) {
    throwRouteError(error);
  }
}

/* -------------------------------------------------------------------------
   Write
   ------------------------------------------------------------------------- */

export async function action({ request, params }: Route.ActionArgs) {
  const { accessToken, setCookie } = await requireStaffAction(request);
  const visitId = parseObjectId(params.visitId, "visit id");
  const form = await request.formData();

  const opts = { token: accessToken };
  // A rotated token has to ride out on every exit, success or not.
  const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;

  const ok = (message: string) => data({ ok: true as const, message }, { headers });
  const fail = (message: string, status = 400) =>
    data({ ok: false as const, message }, { status, headers });

  // Validated rather than asserted: this is the boundary the brand exists for.
  const testIds = form.getAll("testId").filter(isObjectId);
  if (testIds.length === 0) {
    return fail("Choose at least one test to order.");
  }

  const rawPriority = form.get("priority");
  const rawNotes = form.get("clinicalNotes");

  try {
    const order = await createLabOrder(
      {
        visitId,
        testIds,
        priority: Priorities.is(rawPriority) ? rawPriority : undefined,
        clinicalNotes:
          typeof rawNotes === "string" && rawNotes.trim() !== "" ? rawNotes.trim() : undefined,
      },
      opts,
    );

    return ok(
      `Ordered ${order.items.length} ${order.items.length === 1 ? "test" : "tests"} — accession ${order.accessionNumber}. The charges have been raised.`,
    );
  } catch (error) {
    if (!ApiError.is(error)) throw error;

    const message =
      error.status === 409
        ? "This visit is not open to new orders. Reload to see where it stands."
        : describeApiError(error).description;

    return fail(message, error.status >= 400 ? error.status : 502);
  }
}

/* -------------------------------------------------------------------------
   Pieces
   ------------------------------------------------------------------------- */

const PRIORITY_ITEMS = Priorities.options();

/** One order: its items, and the verified results in report form. */
function OrderCard({ order }: { order: LabOrder }) {
  const progress = orderProgress(order);
  const verified = order.items.filter((item) => item.status === "verified");
  const pending = order.items.filter((item) => item.status !== "verified");

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/laboratory/orders/${order.id}`}
              className="font-mono text-sm font-semibold hover:underline"
            >
              {order.accessionNumber}
            </Link>
            <PriorityPill priority={order.priority} />
            <LabStatusPill status={order.status} />
          </div>
          <p className="text-xs text-muted-foreground" suppressHydrationWarning>
            Ordered {format(new Date(order.orderedAt), "d MMM, HH:mm")}
            {order.orderedByName ? ` by ${order.orderedByName}` : ""}
            {progress.total > 0 ? ` · ${progress.verified} of ${progress.total} verified` : ""}
          </p>
        </div>
        <Link
          to={`/laboratory/orders/${order.id}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Open order
        </Link>
      </div>

      {order.clinicalNotes && (
        <p className="border-b px-4 py-2 text-sm text-muted-foreground">
          {order.clinicalNotes}
        </p>
      )}

      {pending.length > 0 && (
        <ul className="divide-y border-b">
          {pending.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
              <span className="font-mono text-xs font-semibold">{item.testCode}</span>
              <span className="min-w-0 flex-1 truncate">{item.testName}</span>
              <SpecimenBadge type={item.specimenType} />
              {item.status === "rejected" && item.rejectionReason && (
                <span className="text-xs text-destructive">{item.rejectionReason}</span>
              )}
              <LabStatusPill status={item.status} />
            </li>
          ))}
        </ul>
      )}

      {/* Only released results reach the clinician — see the module comment. */}
      {verified.map((item) => (
        <div key={item.id} className="border-b last:border-b-0">
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3 text-sm">
            <span className="font-mono text-xs font-semibold">{item.testCode}</span>
            <span className="font-medium">{item.testName}</span>
            <span className="text-xs text-muted-foreground" suppressHydrationWarning>
              verified {item.verifiedAt && format(new Date(item.verifiedAt), "d MMM, HH:mm")}
              {item.verifiedByName ? ` · ${item.verifiedByName}` : ""}
            </span>
          </div>
          <ResultsTable results={item.results} />
          {item.comment && (
            <p className="px-4 pb-3 text-xs text-muted-foreground">{item.comment}</p>
          )}
        </div>
      ))}
    </Card>
  );
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

export default function VisitLabPage({ loaderData, actionData }: Route.ComponentProps) {
  const { visit, orders, canOrder } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.formData != null;

  const [tests, setTests] = useState<LabTest[]>([]);

  // A placed order clears the form; a failure keeps it for another go.
  useEffect(() => {
    if (!actionData) return;
    if (actionData.ok) {
      toast.success(actionData.message);
      setTests([]);
    } else {
      toast.error(actionData.message);
    }
  }, [actionData]);

  const open = visit.status === "open";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Laboratory orders"
        description="Tests ordered on this attendance, and their released results."
        backTo={`/visits/${visit.id}`}
        backLabel="Back to the visit"
      />

      <VisitHeader visit={visit}>
        <Link
          to={`/visits/${visit.id}/consultation`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Consultation
        </Link>
        <Link
          to={`/visits/${visit.id}/vitals`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Vitals
        </Link>
      </VisitHeader>

      {canOrder && open && (
        <Form method="post">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Order tests</CardTitle>
              <CardDescription>
                Each test shows the specimen it needs and how long the bench takes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <LabTestPicker value={tests} onChange={setTests} disabled={busy} />

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="order-priority">Priority</FieldLabel>
                  <Select
                    id="order-priority"
                    name="priority"
                    // An emergency patient's bloods are emergency bloods.
                    defaultValue={visit.priority}
                    items={PRIORITY_ITEMS}
                  >
                    <SelectTrigger className="h-8 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITY_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Urgent and emergency orders jump the bench queue.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="order-notes">Clinical notes for the lab</FieldLabel>
                  <Textarea
                    id="order-notes"
                    name="clinicalNotes"
                    rows={2}
                    placeholder="?malaria in a febrile child; on artesunate since yesterday."
                  />
                </Field>
              </div>

              <div className="flex items-center justify-end gap-3 border-t pt-4">
                <span className="mr-auto text-xs text-muted-foreground">
                  Ordering raises the charges for these tests on the visit bill.
                </span>
                <Button type="submit" disabled={busy || tests.length === 0}>
                  {busy ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                  Place the order
                </Button>
              </div>
            </CardContent>
          </Card>
        </Form>
      )}

      {!open && (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          This visit is no longer open, so nothing new can be ordered.
        </p>
      )}

      {orders.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
          <FlaskConicalIcon className="mx-auto mb-2 size-6" strokeWidth={1.5} />
          No laboratory work has been ordered on this visit.
        </p>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  );
}
