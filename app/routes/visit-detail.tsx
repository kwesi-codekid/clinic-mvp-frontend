/**
 * The visit (T3.2) — one attendance, and the three things that can happen to
 * it: it moves, it closes, or it is cancelled because the patient left.
 *
 * The screen is deliberately thin. The identity strip is {@link VisitHeader},
 * which every station screen in Phases 5–9 mounts, and the route through the
 * clinic is {@link StationTimeline} reading the API's own station history.
 * What is left here is the lifecycle: the writes, and the record of how the
 * attendance ended.
 *
 * Each write is a `POST` back to this route carrying an `intent`, submitted
 * from a dialog. One action, one revalidation, no client-side copy of the
 * visit to keep in step — the same shape the staff directory uses.
 *
 * Closing and cancelling are not the same act and are not offered as if they
 * were: a closed visit carries a `Disposition` because something clinical
 * happened, and a cancelled one carries a reason because nothing did.
 */

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  ArrowRightIcon,
  BanIcon,
  DoorClosedIcon,
  FileTextIcon,
  HeartPulseIcon,
  Loader2Icon,
  NotebookPenIcon,
  RouteIcon,
  StethoscopeIcon,
} from "lucide-react";
import { data, Form, Link, useNavigation, useSearchParams } from "react-router";
import { toast } from "sonner";

import { PatientHistory } from "~/components/patient-history";
import { StationTimeline } from "~/components/station-timeline";
import { PageHeader } from "~/components/page-header";
import { VisitHeader } from "~/components/visit-header";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { ApiError, describeApiError } from "~/lib/api/client";
import { listConsultations } from "~/lib/api/consultations";
import { throwRouteError } from "~/lib/api/route-error";
import { cancelVisit, closeVisit, getVisit, listVisits, moveVisit } from "~/lib/api/visits";
import { requireStaff, requireStaffAction } from "~/lib/auth.server";
import {
  Dispositions,
  Priorities,
  Stations,
  VisitTypes,
  type Disposition,
} from "~/models/enums";
import { parseObjectId } from "~/models/primitives";
import { currentStationRecord, formatMinutes, type Visit } from "~/models/visit";
import type { Route } from "./+types/visit-detail";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: loaderData
        ? `${loaderData.visit.patient.fullName} · Visit ${loaderData.visit.visitNumber}`
        : "Visit · Clinic",
    },
  ];
}

/* -------------------------------------------------------------------------
   Loader
   ------------------------------------------------------------------------- */

/** Roles the API lets cancel a visit. UX routing only — it is the authority. */
const CANCEL_ROLES = ["records", "admin"] as const;

/** Past attendances the history card shows before admitting there are more. */
const HISTORY_LIMIT = 5;

export async function loader({ request, params }: Route.LoaderArgs) {
  const { accessToken, staff } = await requireStaff(request);
  const id = parseObjectId(params.visitId, "visit id");
  const opts = { token: accessToken };

  try {
    const visit = await getVisit(id, opts);

    // The history is the patient's, so it waits on the visit to name them.
    // One extra row is fetched because this visit is in its own list; notes
    // are over-fetched so drafts and amendments cannot starve the join.
    const [historyPage, notePage] = await Promise.all([
      listVisits(
        { patientId: visit.patient.id, sort: "-arrivedAt", limit: HISTORY_LIMIT + 1 },
        opts,
      ),
      listConsultations(
        { patientId: visit.patient.id, sort: "-createdAt", limit: (HISTORY_LIMIT + 1) * 2 },
        opts,
      ),
    ]);

    return {
      visit,
      canCancel: staff.roles.some((role) => CANCEL_ROLES.some((allowed) => allowed === role)),
      pastVisits: historyPage.items
        .filter((entry) => entry.id !== visit.id)
        .slice(0, HISTORY_LIMIT),
      // This visit is always among the patient's visits, so "previous" is
      // the total less one — even when it fell outside the fetched page.
      pastTotal: Math.max(0, historyPage.meta.total - 1),
      consultations: notePage.items,
    };
  } catch (error) {
    throwRouteError(error);
  }
}

/* -------------------------------------------------------------------------
   Writes — one action, three intents, all posted from a dialog
   ------------------------------------------------------------------------- */

/** Trimmed, or `undefined` when the field was left empty. */
function text(form: FormData, key: string): string | undefined {
  const raw = form.get(key);
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

export async function action({ request, params }: Route.ActionArgs) {
  const { accessToken, setCookie } = await requireStaffAction(request);
  const id = parseObjectId(params.visitId, "visit id");

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const opts = { token: accessToken };
  // A rotated token has to ride out on every exit, success or not.
  const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;

  const ok = (message: string) => data({ ok: true as const, message }, { headers });
  const fail = (message: string, status = 400) =>
    data({ ok: false as const, message }, { status, headers });

  try {
    switch (intent) {
      case "move": {
        const station = form.get("station");
        const priority = form.get("priority");

        const visit = await moveVisit(
          id,
          {
            // Omitted means "follow the default route for this visit type",
            // which keeps the clinic's own routing authoritative.
            station: Stations.is(station) ? station : undefined,
            priority: Priorities.is(priority) ? priority : undefined,
            note: text(form, "note"),
          },
          opts,
        );

        return ok(
          visit.currentStation
            ? `Sent to ${Stations.label(visit.currentStation)}.`
            : "Visit moved.",
        );
      }

      case "close": {
        const disposition = form.get("disposition");
        if (!Dispositions.is(disposition)) {
          return fail("Choose how this visit ended.");
        }

        // Referral details belong to a referral; sending them alongside any
        // other disposition would leave a contradiction on the record.
        const referred = disposition === "referred";

        await closeVisit(
          id,
          {
            disposition,
            reviewDate: text(form, "reviewDate"),
            referredTo: referred ? text(form, "referredTo") : undefined,
            referralReason: referred ? text(form, "referralReason") : undefined,
          },
          opts,
        );

        return ok(`Visit closed — ${Dispositions.label(disposition).toLowerCase()}.`);
      }

      case "cancel": {
        await cancelVisit(id, { reason: text(form, "reason") }, opts);
        return ok("Visit cancelled.");
      }

      default:
        return fail("That action is not one this screen can perform.");
    }
  } catch (error) {
    if (!ApiError.is(error)) throw error;

    // 409 here is always the same collision, and the generic conflict copy
    // ("something changed since this screen loaded") would misdescribe it.
    const message =
      error.status === 409
        ? "This visit is no longer open, so it cannot be changed. Reload to see where it stands."
        : describeApiError(error).description;

    return fail(message, error.status >= 400 ? error.status : 502);
  }
}

/* -------------------------------------------------------------------------
   Pieces
   ------------------------------------------------------------------------- */

const STATION_ITEMS = [
  { value: "", label: "Next station on the default route" },
  ...Stations.options(),
];
const PRIORITY_ITEMS = [{ value: "", label: "Leave as it is" }, ...Priorities.options()];
const DISPOSITION_ITEMS = Dispositions.options();

/** One labelled fact. Absent values show an em dash rather than disappearing. */
function Detail({
  label,
  value,
  className,
}: {
  label: string;
  value?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm">
        {value || <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

function DialogSelect({
  id,
  name,
  label,
  items,
  defaultValue,
  hint,
  onValueChange,
}: {
  id: string;
  name: string;
  label: string;
  items: ReadonlyArray<{ value: string; label: string }>;
  defaultValue: string;
  hint?: string;
  onValueChange?: (value: string) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        id={id}
        name={name}
        defaultValue={defaultValue}
        items={items}
        onValueChange={(value) => onValueChange?.(String(value))}
      >
        <SelectTrigger className="h-8 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  );
}

/* -------------------------------------------------------------------------
   Dialogs
   ------------------------------------------------------------------------- */

function MoveDialog({
  visit,
  open,
  onOpenChange,
  busy,
}: {
  visit: Visit;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
}) {
  const here = currentStationRecord(visit);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send to the next station</DialogTitle>
          <DialogDescription>
            {here
              ? `Closes the ${Stations.label(here.station)} entry and records the time spent there.`
              : "Places this visit on a station queue."}
          </DialogDescription>
        </DialogHeader>

        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="move" />

          <DialogSelect
            id="move-station"
            name="station"
            label="Station"
            items={STATION_ITEMS}
            defaultValue=""
            hint="The default route is what the clinic expects for this visit type."
          />

          <DialogSelect
            id="move-priority"
            name="priority"
            label="Priority on arrival"
            items={PRIORITY_ITEMS}
            defaultValue=""
            hint="Re-triages the patient on the receiving queue."
          />

          <Field>
            <FieldLabel htmlFor="move-note">Note</FieldLabel>
            <Textarea
              id="move-note"
              name="note"
              rows={2}
              placeholder="Bloods taken, awaiting review."
            />
          </Field>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <ArrowRightIcon />}
              Send
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function CloseDialog({
  open,
  onOpenChange,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
}) {
  const [disposition, setDisposition] = useState<Disposition>("discharged");
  const referred = disposition === "referred";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Close this visit</DialogTitle>
          <DialogDescription>
            The attendance stops here and the turnaround time is recorded. Anything still owing
            stays on the bill.
          </DialogDescription>
        </DialogHeader>

        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="close" />

          <DialogSelect
            id="close-disposition"
            name="disposition"
            label="How it ended"
            items={DISPOSITION_ITEMS}
            defaultValue="discharged"
            onValueChange={(value) =>
              setDisposition(Dispositions.is(value) ? value : "discharged")
            }
          />

          <Field>
            <FieldLabel htmlFor="close-review">Review date</FieldLabel>
            <Input id="close-review" name="reviewDate" type="date" />
            <FieldDescription>Only if the patient is being asked back.</FieldDescription>
          </Field>

          {/* Shown for a referral alone — these fields have no meaning against
              any other disposition, and the action drops them anyway. */}
          {referred && (
            <>
              <Field>
                <FieldLabel htmlFor="close-referred-to">Referred to</FieldLabel>
                <Input
                  id="close-referred-to"
                  name="referredTo"
                  placeholder="Korle Bu Teaching Hospital"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="close-referral-reason">Reason for referral</FieldLabel>
                <Textarea
                  id="close-referral-reason"
                  name="referralReason"
                  rows={2}
                  placeholder="Needs surgical review."
                />
              </Field>
            </>
          )}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <DoorClosedIcon />}
              Close visit
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({
  open,
  onOpenChange,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this visit</DialogTitle>
          <DialogDescription>
            For a patient who left before being seen. The visit keeps its number and stays on the
            record as cancelled — it is not a closure, and it carries no disposition.
          </DialogDescription>
        </DialogHeader>

        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="cancel" />

          <Field>
            <FieldLabel htmlFor="cancel-reason">Reason</FieldLabel>
            <Textarea
              id="cancel-reason"
              name="reason"
              rows={2}
              placeholder="Left the queue before triage."
            />
            <FieldDescription>
              Optional, but it is what explains the gap to whoever reads the day sheet.
            </FieldDescription>
          </Field>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Keep it open</DialogClose>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <BanIcon />}
              Cancel visit
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

/** Confirmations handed over by the pages that redirect here. */
const NOTICES: Record<string, string> = {
  checkedIn: "Checked in. The patient is on the first queue.",
};

type OpenDialog = "move" | "close" | "cancel" | null;

export default function VisitPage({ loaderData, actionData }: Route.ComponentProps) {
  const { visit, canCancel, pastVisits, pastTotal, consultations } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.formData != null;

  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // One timestamp for the header and the timeline, so they cannot disagree.
  const now = Date.now();
  const open = visit.status === "open";

  const noticeKey = Object.keys(NOTICES).find((key) => searchParams.has(key));

  useEffect(() => {
    if (!noticeKey) return;
    toast.success(NOTICES[noticeKey]);

    // The confirmation belongs to the navigation that carried it, not to the
    // URL — a reload or a shared link should not re-announce it.
    const params = new URLSearchParams(searchParams);
    for (const key of Object.keys(NOTICES)) params.delete(key);
    setSearchParams(params, { replace: true, preventScrollReset: true });
    // Keyed on the notice alone: adding `searchParams` would re-run this on
    // the very rewrite it performs.
  }, [noticeKey]);

  useEffect(() => {
    if (!actionData) return;
    if (actionData.ok) {
      setDialog(null);
      toast.success(actionData.message);
    } else {
      toast.error(actionData.message);
    }
  }, [actionData]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={<span className="font-mono">{visit.visitNumber}</span>}
        description={
          <>
            {VisitTypes.label(visit.type)} · checked in{" "}
            {format(new Date(visit.arrivedAt), "d MMM yyyy 'at' HH:mm")}
          </>
        }
        backTo="/visits"
        backLabel="Back to visits"
      >
        {open ? (
          <>
            {canCancel && (
              <Button variant="outline" onClick={() => setDialog("cancel")}>
                <BanIcon />
                Cancel visit
              </Button>
            )}
            <Button variant="outline" onClick={() => setDialog("close")}>
              <DoorClosedIcon />
              Close visit
            </Button>
            <Button onClick={() => setDialog("move")}>
              <ArrowRightIcon />
              Send to station
            </Button>
          </>
        ) : (
          <Link
            to={`/visits/new?patientId=${visit.patient.id}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            Check this patient in again
          </Link>
        )}
      </PageHeader>

      <VisitHeader visit={visit} now={now} />

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Attendance</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="Visit type" value={VisitTypes.label(visit.type)} />
              <Detail label="Priority" value={Priorities.label(visit.priority)} />
              <Detail
                label="Chief complaint"
                value={visit.chiefComplaint}
                className="sm:col-span-2"
              />

              {visit.status !== "open" && (
                <>
                  <Detail
                    label="Disposition"
                    value={visit.disposition && Dispositions.label(visit.disposition)}
                  />
                  <Detail
                    label="Closed"
                    value={visit.closedAt && format(new Date(visit.closedAt), "d MMM, HH:mm")}
                  />
                  <Detail
                    label="Total time"
                    value={visit.totalMinutes !== undefined && formatMinutes(visit.totalMinutes)}
                  />
                  <Detail
                    label="Review date"
                    value={
                      visit.reviewDate &&
                      format(new Date(`${visit.reviewDate}T00:00:00`), "d MMM yyyy")
                    }
                  />
                </>
              )}

              {visit.disposition === "referred" && (
                <>
                  <Detail label="Referred to" value={visit.referredTo} />
                  <Detail label="Reason" value={visit.referralReason} />
                </>
              )}
            </dl>

            {visit.invoiceId && (
              <p className="mt-4 flex items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
                <FileTextIcon className="size-4 shrink-0" />A bill has been raised for this visit
                (<span className="font-mono text-xs">{visit.invoiceId}</span>).
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RouteIcon className="size-4 text-muted-foreground" />
              Station history
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StationTimeline history={visit.stationHistory} now={now} />
          </CardContent>
        </Card>
      </div>

      {/* What was clinically recorded on this attendance (Phase 5). Links
          rather than embedded panels: each is a screen a station works in for
          the length of a patient, not a summary read in passing. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StethoscopeIcon className="size-4 text-muted-foreground" />
            Clinical record
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Link
            to={`/visits/${visit.id}/vitals`}
            className={buttonVariants({ variant: "outline" })}
          >
            <HeartPulseIcon />
            Vitals
          </Link>
          <Link
            to={`/visits/${visit.id}/consultation`}
            className={buttonVariants({ variant: "outline" })}
          >
            <NotebookPenIcon />
            Consultation note
          </Link>
        </CardContent>
      </Card>

      {/* The patient's other attendances — the context read before this one.
          This visit itself is excluded: the rest of the screen *is* it. */}
      <PatientHistory
        visits={pastVisits}
        total={pastTotal}
        consultations={consultations}
        title="Patient history"
        emptyMessage="This is the patient's first attendance — nothing earlier on record."
      />

      {open && (
        <>
          <MoveDialog
            visit={visit}
            open={dialog === "move"}
            onOpenChange={(next) => setDialog(next ? "move" : null)}
            busy={busy}
          />
          <CloseDialog
            open={dialog === "close"}
            onOpenChange={(next) => setDialog(next ? "close" : null)}
            busy={busy}
          />
          <CancelDialog
            open={dialog === "cancel"}
            onOpenChange={(next) => setDialog(next ? "cancel" : null)}
            busy={busy}
          />
        </>
      )}
    </div>
  );
}
