/**
 * One lab order (T6.2) — `/laboratory/orders/:orderId`.
 *
 * The bench's screen: collection, result entry, verification and rejection
 * all happen here. The one structural rule, straight from the API: **the
 * order is a container; every action below the collect step is per item.**
 * A four-test panel part-results, and one haemolysed tube is rejected while
 * the rest run — so this page renders a card per item, each carrying only
 * the actions its own status allows.
 *
 * Discipline the layout enforces:
 *
 * - **Flags are computed, never typed.** The entry form shows the reference
 *   range for this patient's sex and age beside each input as a courtesy
 *   ({@link rangeForPatient}), but the grading — and the critical-value page
 *   to the ordering clinician — happens server-side on save.
 * - **Unverified values stay on the bench.** Staff without the lab role see
 *   an item's status, not its numbers, until verification releases them.
 *   Verification is deliberately a separate act from entry.
 */

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  CheckCheckIcon,
  FlaskConicalIcon,
  Loader2Icon,
  SaveIcon,
  TestTubeIcon,
  TimerIcon,
} from "lucide-react";
import { data, Link, useFetcher, type FetcherWithComponents } from "react-router";
import { toast } from "sonner";

import { LabStatusPill, ResultsTable, SpecimenBadge } from "~/components/lab-results";
import { PageHeader } from "~/components/page-header";
import { PriorityPill, VisitHeader } from "~/components/visit-header";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ApiError, describeApiError } from "~/lib/api/client";
import {
  collectSpecimen,
  enterResults,
  getLabOrder,
  getLabTest,
  rejectSpecimen,
  verifyResults,
} from "~/lib/api/lab";
import { throwRouteError } from "~/lib/api/route-error";
import { getVisit } from "~/lib/api/visits";
import { requireStaff, requireStaffAction } from "~/lib/auth.server";
import { SpecimenTypes, type Role, type Sex } from "~/models/enums";
import {
  formatReferenceRange,
  rangeForPatient,
  specimensToCollect,
  type Analyte,
  type LabOrderItem,
  type LabTest,
  type ResultEntry,
} from "~/models/lab";
import { isObjectId, parseObjectId } from "~/models/primitives";
import { formatMinutes } from "~/models/visit";

import type { Route } from "./+types/lab-order";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: loaderData
        ? `${loaderData.order.accessionNumber} · Laboratory · Clinic`
        : "Lab order · Clinic",
    },
  ];
}

/** Who may record a collection — whoever actually holds the needle. */
const COLLECT_ROLES: readonly Role[] = ["lab", "nurse", "midwife", "admin"];

/** Who may enter, verify and reject results. */
const BENCH_ROLES: readonly Role[] = ["lab", "admin"];

/* -------------------------------------------------------------------------
   Loader
   ------------------------------------------------------------------------- */

export async function loader({ request, params }: Route.LoaderArgs) {
  const { accessToken, staff } = await requireStaff(request);
  const orderId = parseObjectId(params.orderId, "order id");
  const opts = { token: accessToken };

  try {
    const order = await getLabOrder(orderId, opts);
    const canBench = staff.roles.some((role) => BENCH_ROLES.includes(role));

    // The catalogue entries behind the items awaiting entry — they carry the
    // analytes the form is built from. Only fetched when this user can enter.
    const entryTestIds = canBench
      ? [
          ...new Set(
            order.items
              .filter((item) => item.status === "collected")
              .map((item) => item.testId),
          ),
        ]
      : [];

    const [visit, ...tests] = await Promise.all([
      // The worklist works sample-first; this is where the specimen becomes a
      // person again — and where sex and age come from for the range hints.
      getVisit(order.visitId, opts),
      ...entryTestIds.map((id) => getLabTest(id, opts)),
    ]);

    return {
      order,
      visit,
      testsById: Object.fromEntries(tests.map((test) => [test.id, test])),
      canCollect: staff.roles.some((role) => COLLECT_ROLES.includes(role)),
      canBench,
    };
  } catch (error) {
    throwRouteError(error);
  }
}

/* -------------------------------------------------------------------------
   Writes — one action, four intents, each posted from its own fetcher
   ------------------------------------------------------------------------- */

/** `result:{analyteCode}` form fields, turned back into the write shape. */
function readResults(form: FormData): ResultEntry[] {
  const results: ResultEntry[] = [];
  for (const [key, raw] of form.entries()) {
    if (!key.startsWith("result:") || typeof raw !== "string") continue;
    const value = raw.trim();
    if (value === "") continue; // A part-run panel is a legitimate entry.

    const numeric = Number(value);
    results.push({
      analyteCode: key.slice("result:".length),
      value: Number.isFinite(numeric) && value !== "" ? numeric : value,
    });
  }
  return results;
}

export async function action({ request, params }: Route.ActionArgs) {
  const { accessToken, setCookie } = await requireStaffAction(request);
  const orderId = parseObjectId(params.orderId, "order id");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const opts = { token: accessToken };
  // A rotated token has to ride out on every exit, success or not.
  const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;

  const ok = (message: string) => data({ ok: true as const, message }, { headers });
  const fail = (message: string, status = 400) =>
    data({ ok: false as const, message }, { status, headers });

  const rawItemId = form.get("itemId");
  const itemId = isObjectId(rawItemId) ? rawItemId : undefined;

  try {
    switch (intent) {
      case "collect": {
        const itemIds = form.getAll("collectItemId").filter(isObjectId);
        if (itemIds.length === 0) {
          return fail("Tick at least one specimen to record.");
        }
        const order = await collectSpecimen(orderId, { itemIds }, opts);
        return ok(`Collection recorded on ${order.accessionNumber}.`);
      }

      case "results": {
        if (!itemId) return fail("That test could not be identified.");

        const results = readResults(form);
        if (results.length === 0) {
          return fail("Enter at least one value before saving.");
        }

        const rawComment = form.get("comment");
        const order = await enterResults(
          orderId,
          itemId,
          {
            results,
            comment:
              typeof rawComment === "string" && rawComment.trim() !== ""
                ? rawComment.trim()
                : undefined,
          },
          opts,
        );

        const item = order.items.find((entry) => entry.id === itemId);
        return ok(
          item?.hasCritical
            ? "Results saved — a critical value was flagged and the ordering clinician is being told."
            : "Results saved. They release to the clinician once verified.",
        );
      }

      case "verify": {
        if (!itemId) return fail("That test could not be identified.");
        await verifyResults(orderId, itemId, opts);
        return ok("Verified and released to the clinician.");
      }

      case "reject": {
        if (!itemId) return fail("That test could not be identified.");

        const rawReason = form.get("reason");
        const reason = typeof rawReason === "string" ? rawReason.trim() : "";
        if (reason === "") {
          return fail("Say why the specimen is being rejected — it is what the record keeps.");
        }

        await rejectSpecimen(orderId, itemId, { reason }, opts);
        return ok("Specimen rejected. A fresh order restarts the test.");
      }

      default:
        return fail("That action is not one this screen can perform.");
    }
  } catch (error) {
    if (!ApiError.is(error)) throw error;

    // 409 here is the bench's own race: two people worked the same item.
    const message =
      error.status === 409
        ? "This item has already moved on. The order has been refreshed."
        : describeApiError(error).description;

    return fail(message, error.status >= 400 ? error.status : 502);
  }
}

/* -------------------------------------------------------------------------
   Fetcher plumbing
   ------------------------------------------------------------------------- */

type LabActionResult = { ok: boolean; message: string };

/**
 * A fetcher that reports what happened. Every write here is a one-click (or
 * one-card) act with no screen of its own to land on, so the answer is a
 * toast — and a `409` from a colleague's parallel work is normal on a bench.
 */
function useLabFetcher(): FetcherWithComponents<LabActionResult> {
  const fetcher = useFetcher<LabActionResult>();

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const notify = fetcher.data.ok ? toast.success : toast.error;
    notify(fetcher.data.message);
  }, [fetcher.data, fetcher.state]);

  return fetcher;
}

/* -------------------------------------------------------------------------
   Collection
   ------------------------------------------------------------------------- */

function CollectionCard({ pending }: { pending: LabOrderItem[] }) {
  const fetcher = useLabFetcher();
  const busy = fetcher.state !== "idle";
  const tubes = specimensToCollect(pending);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TestTubeIcon className="size-4 text-muted-foreground" />
          Record collection
        </CardTitle>
        <CardDescription>
          {tubes.length > 0
            ? `Needed: ${tubes.map((tube) => SpecimenTypes.label(tube)).join(", ")} — one tube covers every test that shares it.`
            : "These tests need no specimen."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <fetcher.Form method="post" className="space-y-4">
          <ul className="space-y-2">
            {pending.map((item) => (
              <li key={item.id} className="flex items-center gap-3 rounded-lg border p-3">
                <Checkbox
                  id={`collect-${item.id}`}
                  name="collectItemId"
                  value={item.id}
                  defaultChecked
                  disabled={busy}
                />
                <Label
                  htmlFor={`collect-${item.id}`}
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-2 font-normal"
                >
                  <span className="font-mono text-xs font-semibold">{item.testCode}</span>
                  <span className="truncate text-sm">{item.testName}</span>
                  <SpecimenBadge type={item.specimenType} />
                </Label>
              </li>
            ))}
          </ul>

          <div className="flex justify-end">
            <Button type="submit" name="intent" value="collect" disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <TestTubeIcon />}
              Specimens collected
            </Button>
          </div>
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
   Result entry
   ------------------------------------------------------------------------- */

function AnalyteInput({
  analyte,
  sex,
  ageYears,
  disabled,
}: {
  analyte: Analyte;
  sex: Sex;
  ageYears: number | undefined;
  disabled: boolean;
}) {
  // Display only — the API resolves the range again when it grades.
  const range = formatReferenceRange(rangeForPatient(analyte, sex, ageYears), analyte.unit);
  const id = `analyte-${analyte.code}`;

  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {analyte.name}
        {analyte.unit ? (
          <span className="font-normal text-muted-foreground"> · {analyte.unit}</span>
        ) : null}
      </FieldLabel>

      {analyte.resultType === "select" ? (
        <Select
          id={id}
          name={`result:${analyte.code}`}
          defaultValue=""
          items={[
            { value: "", label: "Not run" },
            ...(analyte.options ?? []).map((option) => ({ value: option, label: option })),
          ]}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Not run</SelectItem>
            {(analyte.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={id}
          name={`result:${analyte.code}`}
          type={analyte.resultType === "numeric" ? "number" : "text"}
          step={analyte.resultType === "numeric" ? "any" : undefined}
          inputMode={analyte.resultType === "numeric" ? "decimal" : undefined}
          disabled={disabled}
        />
      )}

      {range && <FieldDescription>Reference: {range}</FieldDescription>}
    </Field>
  );
}

function ResultEntryForm({
  item,
  test,
  sex,
  ageYears,
}: {
  item: LabOrderItem;
  test: LabTest | undefined;
  sex: Sex;
  ageYears: number | undefined;
}) {
  const fetcher = useLabFetcher();
  const busy = fetcher.state !== "idle";

  if (!test) {
    // The item names a test the catalogue no longer returns — say so rather
    // than rendering an empty form that cannot be filled.
    return (
      <p className="text-sm text-muted-foreground">
        The catalogue entry for this test could not be loaded, so results cannot be entered
        here.
      </p>
    );
  }

  return (
    <fetcher.Form method="post" className="space-y-4">
      <input type="hidden" name="itemId" value={item.id} />

      <div className="grid gap-4 sm:grid-cols-2">
        {test.analytes.map((analyte) => (
          <AnalyteInput
            key={analyte.code}
            analyte={analyte}
            sex={sex}
            ageYears={ageYears}
            disabled={busy}
          />
        ))}
      </div>

      <Field>
        <FieldLabel htmlFor={`comment-${item.id}`}>Comment</FieldLabel>
        <Input
          id={`comment-${item.id}`}
          name="comment"
          placeholder="Slight haemolysis noted; potassium interpreted with caution."
          disabled={busy}
        />
      </Field>

      <div className="flex items-center justify-end gap-3">
        <span className="mr-auto text-xs text-muted-foreground">
          Analytes left blank are recorded as not run. Flags are graded by the system, not
          typed.
        </span>
        <Button type="submit" name="intent" value="results" disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
          Save results
        </Button>
      </div>
    </fetcher.Form>
  );
}

/* -------------------------------------------------------------------------
   Verify and reject
   ------------------------------------------------------------------------- */

function VerifyButton({ item }: { item: LabOrderItem }) {
  const fetcher = useLabFetcher();
  const busy = fetcher.state !== "idle";

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="itemId" value={item.id} />
      <Button type="submit" name="intent" value="verify" disabled={busy}>
        {busy ? <Loader2Icon className="animate-spin" /> : <CheckCheckIcon />}
        Verify and release
      </Button>
    </fetcher.Form>
  );
}

function RejectDialog({ item }: { item: LabOrderItem }) {
  const [open, setOpen] = useState(false);
  const fetcher = useLabFetcher();
  const busy = fetcher.state !== "idle";

  // Close once the rejection lands; the revalidated order shows the outcome.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setOpen(false);
  }, [fetcher.state, fetcher.data]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            Reject specimen
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject this specimen</DialogTitle>
          <DialogDescription>
            Haemolysed, insufficient, wrongly labelled — the item ends here and a fresh order
            restarts {item.testName}. The reason is kept on the record.
          </DialogDescription>
        </DialogHeader>

        <fetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="itemId" value={item.id} />
          <Field>
            <FieldLabel htmlFor={`reject-reason-${item.id}`}>Reason</FieldLabel>
            <Input
              id={`reject-reason-${item.id}`}
              name="reason"
              placeholder="Haemolysed sample"
              disabled={busy}
            />
          </Field>
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={busy}>
                  Keep it
                </Button>
              }
            />
            <Button type="submit" name="intent" value="reject" variant="destructive" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              Reject
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------
   The item card
   ------------------------------------------------------------------------- */

/** Collected → resulted → verified, with who and when. */
function ItemTrail({ item }: { item: LabOrderItem }) {
  const steps = [
    { label: "Collected", at: item.collectedAt, by: item.collectedByName },
    { label: "Resulted", at: item.resultedAt, by: item.resultedByName },
    { label: "Verified", at: item.verifiedAt, by: item.verifiedByName },
  ].filter((step) => step.at);

  if (steps.length === 0) return null;

  return (
    <p className="text-xs text-muted-foreground" suppressHydrationWarning>
      {steps
        .map(
          (step) =>
            `${step.label} ${format(new Date(step.at!), "d MMM, HH:mm")}${step.by ? ` · ${step.by}` : ""}`,
        )
        .join(" — ")}
      {item.turnaroundMinutes !== undefined &&
        ` — turnaround ${formatMinutes(item.turnaroundMinutes)} of ${formatMinutes(item.turnaroundTargetMinutes)} target`}
    </p>
  );
}

function ItemCard({
  item,
  test,
  sex,
  ageYears,
  canBench,
}: {
  item: LabOrderItem;
  test: LabTest | undefined;
  sex: Sex;
  ageYears: number | undefined;
  canBench: boolean;
}) {
  const rejectable =
    canBench &&
    (item.status === "ordered" || item.status === "collected" || item.status === "resulted");

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold">{item.testCode}</span>
            <span className="font-medium">{item.testName}</span>
            <SpecimenBadge type={item.specimenType} />
            <LabStatusPill status={item.status} />
            {item.overdue && item.status !== "verified" && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                <TimerIcon className="size-3" />
                Past target
              </span>
            )}
          </div>
          <ItemTrail item={item} />
        </div>

        {rejectable && <RejectDialog item={item} />}
      </div>

      <div className="p-4">
        {item.status === "ordered" && (
          <p className="text-sm text-muted-foreground">
            Awaiting specimen collection — see the collection card above.
          </p>
        )}

        {item.status === "collected" &&
          (canBench ? (
            <ResultEntryForm item={item} test={test} sex={sex} ageYears={ageYears} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Specimen on the bench, awaiting results.
            </p>
          ))}

        {item.status === "resulted" &&
          (canBench ? (
            <div className="space-y-3">
              <ResultsTable results={item.results} />
              {item.comment && (
                <p className="text-xs text-muted-foreground">{item.comment}</p>
              )}
              <div className="flex items-center justify-end gap-3 border-t pt-3">
                <span className="mr-auto text-xs text-muted-foreground">
                  A second pair of eyes before the clinician sees it — check the values against
                  the bench record.
                </span>
                <VerifyButton item={item} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Results entered, awaiting verification. They release to the clinician once a
              second pair of eyes has checked them.
            </p>
          ))}

        {item.status === "verified" && (
          <div className="space-y-2">
            <ResultsTable results={item.results} />
            {item.comment && <p className="text-xs text-muted-foreground">{item.comment}</p>}
          </div>
        )}

        {item.status === "rejected" && (
          <p className="text-sm">
            <span className="font-medium text-destructive">Specimen rejected.</span>{" "}
            <span className="text-muted-foreground">
              {item.rejectionReason ?? "No reason recorded."} A fresh order restarts this test.
            </span>
          </p>
        )}

        {item.status === "cancelled" && (
          <p className="text-sm text-muted-foreground">This test was cancelled.</p>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

export default function LabOrderPage({ loaderData }: Route.ComponentProps) {
  const { order, visit, testsById, canCollect, canBench } = loaderData;

  const pendingCollection = order.items.filter((item) => item.status === "ordered");
  const sex = visit.patient.sex;
  const ageYears = visit.patient.age.years;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{order.accessionNumber}</span>
            <PriorityPill priority={order.priority} />
            <LabStatusPill status={order.status} />
          </span>
        }
        description={`Ordered ${format(new Date(order.orderedAt), "d MMM, HH:mm")}${order.orderedByName ? ` by ${order.orderedByName}` : ""}.`}
        backTo="/laboratory"
        backLabel="Back to the laboratory"
      />

      <VisitHeader visit={visit}>
        <Link
          to={`/visits/${visit.id}/lab`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <FlaskConicalIcon />
          All orders on this visit
        </Link>
      </VisitHeader>

      {order.clinicalNotes && (
        <Card>
          <CardContent className="py-3 text-sm">
            <span className="font-medium">From the clinician:</span>{" "}
            <span className="text-muted-foreground">{order.clinicalNotes}</span>
          </CardContent>
        </Card>
      )}

      {canCollect && pendingCollection.length > 0 && (
        <CollectionCard pending={pendingCollection} />
      )}

      <div className="space-y-4">
        {order.items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            test={testsById[item.testId]}
            sex={sex}
            ageYears={ageYears}
            canBench={canBench}
          />
        ))}
      </div>
    </div>
  );
}
