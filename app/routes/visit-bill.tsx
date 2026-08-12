/**
 * The bill for one visit (T8.1) — `/visits/:visitId/bill`.
 *
 * The invoice plus every charge line, each already split between payer and
 * patient by the API against the **frozen** payer snapshot — this screen
 * renders that arithmetic and never re-derives it.
 *
 * What the layout has to keep straight:
 *
 * - **The patient portion is the headline.** It is what the person at the
 *   counter must find before leaving, so it leads the totals and every line.
 *   The shortfall — what the payer tariff leaves the clinic to absorb — is
 *   finance's number and only renders for cashier, claims and admin.
 * - **Waive ≠ cancel.** Waiving forgives a legitimate charge and is reported
 *   on (the reason is mandatory); cancelling removes a line raised in error.
 *   Two dialogs, two verbs, deliberately not one "remove" button.
 * - **The quote comes before the charge.** The add-charge form prices its item
 *   live through `/resources/billing-quote` while the item is being chosen —
 *   cost transparency belongs at the moment of ordering, not at the till.
 * - Most lines were raised by other modules doing their jobs (`sourceType`);
 *   only a manual line should ever look like this screen's own work.
 */

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
  BanIcon,
  HeartHandshakeIcon,
  Loader2Icon,
  PlusIcon,
  ReceiptTextIcon,
} from "lucide-react";
import { data, useFetcher, type FetcherWithComponents } from "react-router";
import { toast } from "sonner";

import { ChargeItemPicker } from "~/components/charge-item-picker";
import { StatusPill } from "~/components/directory";
import { PageHeader } from "~/components/page-header";
import { VisitHeader } from "~/components/visit-header";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { ApiError, describeApiError } from "~/lib/api/client";
import { addCharge, cancelCharge, getVisitBill, waiveCharge } from "~/lib/api/billing";
import { throwRouteError } from "~/lib/api/route-error";
import { getVisit } from "~/lib/api/visits";
import { requireStaff, requireStaffAction } from "~/lib/auth.server";
import { formatPesewas } from "~/lib/money";
import {
  billTotals,
  canCancelCharge,
  canWaiveCharge,
  chargeStatusTone,
  invoiceStatusTone,
  isManualCharge,
  type Charge,
  type ChargeItem,
  type Invoice,
} from "~/models/billing";
import {
  ChargeCategories,
  ChargeSources,
  ChargeStatuses,
  InvoiceStatuses,
  type Role,
} from "~/models/enums";
import { isObjectId, parseObjectId } from "~/models/primitives";
import type { BillingQuoteData } from "./resource-billing-quote";

import type { Route } from "./+types/visit-bill";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.visit.patient.fullName;
  return [{ title: name ? `Bill · ${name} · Clinic` : "Visit bill · Clinic" }];
}

/** Who `POST /billing/visits/{id}/charges` accepts. */
const ADD_CHARGE_ROLES: readonly Role[] = [
  "cashier",
  "doctor",
  "physician_assistant",
  "nurse",
  "pharmacy",
  "lab",
  "admin",
];

/** Who may waive or cancel a charge. */
const ADJUST_ROLES: readonly Role[] = ["admin", "cashier"];

/** Who the shortfall — the clinic's absorbed loss — is for. */
const FINANCE_ROLES: readonly Role[] = ["admin", "cashier", "claims"];

/* -------------------------------------------------------------------------
   Loader
   ------------------------------------------------------------------------- */

export async function loader({ request, params }: Route.LoaderArgs) {
  const { accessToken, staff } = await requireStaff(request);
  const visitId = parseObjectId(params.visitId, "visit id");
  const opts = { token: accessToken };

  try {
    const [visit, bill] = await Promise.all([
      getVisit(visitId, opts),
      getVisitBill(visitId, opts),
    ]);

    const holds = (roles: readonly Role[]) => staff.roles.some((role) => roles.includes(role));

    return {
      visit,
      bill,
      canAddCharge: holds(ADD_CHARGE_ROLES) && visit.status === "open",
      canAdjust: holds(ADJUST_ROLES),
      seesFinance: holds(FINANCE_ROLES),
    };
  } catch (error) {
    throwRouteError(error);
  }
}

/* -------------------------------------------------------------------------
   Writes — one action, three intents
   ------------------------------------------------------------------------- */

export async function action({ request, params }: Route.ActionArgs) {
  const { accessToken, setCookie } = await requireStaffAction(request);
  const visitId = parseObjectId(params.visitId, "visit id");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const opts = { token: accessToken };
  // A rotated token has to ride out on every exit, success or not.
  const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;

  const ok = (message: string) => data({ ok: true as const, message }, { headers });
  const fail = (message: string, status = 400) =>
    data({ ok: false as const, message }, { status, headers });

  const text = (field: string) => {
    const value = form.get(field);
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed === "" ? undefined : trimmed;
  };

  try {
    switch (intent) {
      case "add": {
        const rawItemId = form.get("chargeItemId");
        if (!isObjectId(rawItemId)) {
          return fail("Choose what is being billed.");
        }

        const rawQuantity = form.get("quantity");
        const quantity =
          typeof rawQuantity === "string" && rawQuantity.trim() !== ""
            ? Number(rawQuantity)
            : undefined;
        if (quantity !== undefined && (!Number.isFinite(quantity) || quantity <= 0)) {
          return fail("The quantity must be more than zero — or leave it blank for one.");
        }

        const charge = await addCharge(
          visitId,
          { chargeItemId: rawItemId, quantity, description: text("description") },
          opts,
        );

        return ok(
          `${charge.description} added — ${charge.patientPortionFormatted} to the patient.`,
        );
      }

      case "waive": {
        const rawChargeId = form.get("chargeId");
        if (!isObjectId(rawChargeId)) return fail("That charge could not be identified.");

        const reason = text("reason");
        if (!reason) {
          return fail("Say why the charge is being forgiven — the reason is the audit trail.");
        }

        await waiveCharge(rawChargeId, { reason }, opts);
        return ok("Waived. The charge stays on the bill at nothing owed, with your reason.");
      }

      case "cancel": {
        const rawChargeId = form.get("chargeId");
        if (!isObjectId(rawChargeId)) return fail("That charge could not be identified.");

        await cancelCharge(rawChargeId, text("reason"), opts);
        return ok("Cancelled. The line is removed from what anyone owes.");
      }

      default:
        return fail("That action is not one this screen can perform.");
    }
  } catch (error) {
    if (!ApiError.is(error)) throw error;
    return fail(describeApiError(error).description, error.status >= 400 ? error.status : 502);
  }
}

/* -------------------------------------------------------------------------
   Fetcher plumbing
   ------------------------------------------------------------------------- */

type BillActionResult = { ok: boolean; message: string };

/** A fetcher that reports what happened as a toast. */
function useBillFetcher(): FetcherWithComponents<BillActionResult> {
  const fetcher = useFetcher<BillActionResult>();

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const notify = fetcher.data.ok ? toast.success : toast.error;
    notify(fetcher.data.message);
  }, [fetcher.data, fetcher.state]);

  return fetcher;
}

/* -------------------------------------------------------------------------
   Totals
   ------------------------------------------------------------------------- */

function TotalRow({
  label,
  value,
  emphasis,
  muted,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={emphasis ? "text-sm font-medium" : "text-sm text-muted-foreground"}>
        {label}
      </dt>
      <dd
        className={
          emphasis
            ? "font-heading text-lg font-semibold tabular-nums"
            : muted
              ? "text-sm text-muted-foreground tabular-nums"
              : "text-sm tabular-nums"
        }
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The invoice's own totals when one exists; local sums over the pending lines
 * until then — clearly labelled, because they are a preview, not a record.
 */
function BillSummary({
  invoice,
  charges,
  seesFinance,
}: {
  invoice: Invoice | null;
  charges: Charge[];
  seesFinance: boolean;
}) {
  if (invoice === null) {
    const totals = billTotals(charges);
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">No invoice yet</CardTitle>
          <CardDescription>
            Totals below are over the accrued lines. The API issues the invoice; these become
            its numbers when it does.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2">
            <TotalRow label="Accrued so far" value={formatPesewas(totals.grossPesewas)} />
            <TotalRow
              label="Payer portion"
              value={formatPesewas(totals.payerPortionPesewas)}
              muted
            />
            <TotalRow
              label="Patient pays"
              value={formatPesewas(totals.patientPortionPesewas)}
              emphasis
            />
            {seesFinance && totals.shortfallPesewas > 0 && (
              <TotalRow
                label="Shortfall (clinic absorbs)"
                value={formatPesewas(totals.shortfallPesewas)}
                muted
              />
            )}
          </dl>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            Invoice <span className="font-mono">{invoice.invoiceNumber}</span>
          </CardTitle>
          <StatusPill tone={invoiceStatusTone(invoice.status)}>
            {InvoiceStatuses.label(invoice.status)}
          </StatusPill>
        </div>
        <CardDescription>
          Issued {format(new Date(invoice.issuedAt), "d MMM yyyy, HH:mm")}
          {invoice.settledAt &&
            ` · settled ${format(new Date(invoice.settledAt), "d MMM yyyy, HH:mm")}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2">
          <TotalRow label="Subtotal" value={invoice.subtotalFormatted} />
          <TotalRow
            label={`Payer portion${invoice.schemeName ? ` · ${invoice.schemeName}` : ""}`}
            value={invoice.payerTotalFormatted}
            muted
          />
          <TotalRow label="Patient pays" value={invoice.patientTotalFormatted} emphasis />
          <TotalRow label="Paid so far" value={formatPesewas(invoice.paidPesewas)} muted />
          <TotalRow label="Balance" value={invoice.balanceFormatted} emphasis />
          {seesFinance && invoice.shortfallPesewas > 0 && (
            <TotalRow
              label="Shortfall (clinic absorbs)"
              value={formatPesewas(invoice.shortfallPesewas)}
              muted
            />
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
   Waive / cancel — two dialogs, two verbs, deliberately not one button
   ------------------------------------------------------------------------- */

function WaiveDialog({ charge }: { charge: Charge }) {
  const [open, setOpen] = useState(false);
  const fetcher = useBillFetcher();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setOpen(false);
  }, [fetcher.state, fetcher.data]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            <HeartHandshakeIcon />
            Waive
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Forgive this charge</DialogTitle>
          <DialogDescription>
            {charge.description} — {charge.grossFormatted}. Waiving says the charge was
            <em> right</em> and the clinic is choosing not to collect it. Waivers are reported
            on; a line raised in error should be cancelled instead.
          </DialogDescription>
        </DialogHeader>

        <fetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="chargeId" value={charge.id} />

          <Field>
            <FieldLabel htmlFor={`waive-reason-${charge.id}`}>Reason</FieldLabel>
            <Input
              id={`waive-reason-${charge.id}`}
              name="reason"
              placeholder="Staff dependant; hardship approved by the administrator"
              disabled={busy}
            />
            <FieldDescription>Written to the audit trail with your name.</FieldDescription>
          </Field>

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={busy}>
                  Keep the charge
                </Button>
              }
            />
            <Button type="submit" name="intent" value="waive" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              Waive it
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ charge }: { charge: Charge }) {
  const [open, setOpen] = useState(false);
  const fetcher = useBillFetcher();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setOpen(false);
  }, [fetcher.state, fetcher.data]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="ghost" size="sm" className="text-destructive">
            <BanIcon />
            Cancel
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove a charge raised in error</DialogTitle>
          <DialogDescription>
            {charge.description} — {charge.grossFormatted}. Cancelling says this line should
            never have existed. If the charge was right but is being forgiven, waive it
            instead — the two are reported differently.
          </DialogDescription>
        </DialogHeader>

        <fetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="chargeId" value={charge.id} />

          <Field>
            <FieldLabel htmlFor={`cancel-reason-${charge.id}`}>What went wrong</FieldLabel>
            <Input
              id={`cancel-reason-${charge.id}`}
              name="reason"
              placeholder="Duplicate entry; billed to the wrong visit"
              disabled={busy}
            />
          </Field>

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={busy}>
                  Keep the charge
                </Button>
              }
            />
            <Button type="submit" name="intent" value="cancel" variant="destructive" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              Cancel the charge
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------
   The lines
   ------------------------------------------------------------------------- */

function ChargeTable({
  charges,
  canAdjust,
  seesFinance,
}: {
  charges: Charge[];
  canAdjust: boolean;
  seesFinance: boolean;
}) {
  if (charges.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-10 text-center text-sm text-muted-foreground">
        <ReceiptTextIcon className="mx-auto mb-2 size-6" strokeWidth={1.5} />
        Nothing has been charged on this visit yet.
      </p>
    );
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Charge</TableHead>
              <TableHead className="text-right">Qty × unit</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">Payer</TableHead>
              <TableHead className="text-right">Patient</TableHead>
              {seesFinance && <TableHead className="text-right">Shortfall</TableHead>}
              <TableHead>Status</TableHead>
              {canAdjust && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {charges.map((charge) => {
              const closed = !canWaiveCharge(charge);
              return (
                <TableRow key={charge.id} className={closed ? "text-muted-foreground" : undefined}>
                  <TableCell className="max-w-72">
                    <div className="truncate text-sm font-medium">{charge.description}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{ChargeCategories.label(charge.category)}</span>
                      <span>
                        · {isManualCharge(charge) ? "Added by hand" : ChargeSources.label(charge.sourceType)}
                      </span>
                      <span>· {format(new Date(charge.raisedAt), "d MMM, HH:mm")}</span>
                    </div>
                    {/* Plain words from the API, written for the patient. */}
                    {charge.coverageNote && (
                      <div className="mt-0.5 text-xs text-muted-foreground italic">
                        {charge.coverageNote}
                      </div>
                    )}
                    {charge.status === "waived" && charge.waivedReason && (
                      <div className="mt-0.5 text-xs text-muted-foreground italic">
                        Waived: {charge.waivedReason}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm whitespace-nowrap tabular-nums">
                    {charge.quantity} × {formatPesewas(charge.unitPricePesewas, { symbol: "none" })}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {charge.grossFormatted}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                    {charge.coveredByPayer
                      ? formatPesewas(charge.payerPortionPesewas, { symbol: "none" })
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium tabular-nums">
                    {charge.patientPortionFormatted}
                  </TableCell>
                  {seesFinance && (
                    <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                      {charge.shortfallPesewas > 0
                        ? formatPesewas(charge.shortfallPesewas, { symbol: "none" })
                        : "—"}
                    </TableCell>
                  )}
                  <TableCell>
                    <StatusPill tone={chargeStatusTone(charge.status)}>
                      {ChargeStatuses.label(charge.status)}
                    </StatusPill>
                  </TableCell>
                  {canAdjust && (
                    <TableCell className="whitespace-nowrap">
                      {canWaiveCharge(charge) && (
                        <div className="flex items-center justify-end gap-1.5">
                          <WaiveDialog charge={charge} />
                          {canCancelCharge(charge) && <CancelDialog charge={charge} />}
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------
   Add a charge — quoted live, before it exists
   ------------------------------------------------------------------------- */

function QuotePanel({
  quote,
  message,
  loading,
  seesFinance,
}: {
  quote: BillingQuoteData["quote"];
  message?: string;
  loading: boolean;
  seesFinance: boolean;
}) {
  if (loading && !quote) {
    return <p className="text-sm text-muted-foreground">Pricing…</p>;
  }
  if (!quote) {
    return (
      <p className="text-sm text-muted-foreground">
        {message ?? "Pick an item to see what this patient would pay."}
      </p>
    );
  }

  return (
    <div className="space-y-1 rounded-lg bg-muted/40 p-3 dark:bg-muted/20">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-muted-foreground">
          {quote.quantity} × {quote.chargeItem.name}
        </span>
        <span className="tabular-nums">{formatPesewas(quote.grossPesewas)}</span>
      </div>
      {quote.coveredByPayer && (
        <div className="flex items-baseline justify-between gap-4 text-sm text-muted-foreground">
          <span>Payer portion</span>
          <span className="tabular-nums">−{formatPesewas(quote.payerPortionPesewas, { symbol: "none" })}</span>
        </div>
      )}
      <div className="flex items-baseline justify-between gap-4 border-t pt-1 text-sm font-semibold">
        <span>Patient would pay</span>
        <span className="tabular-nums">{quote.patientPortionFormatted}</span>
      </div>
      {quote.coverageNote && (
        <p className="text-xs text-muted-foreground italic">{quote.coverageNote}</p>
      )}
      {seesFinance && quote.shortfallPesewas > 0 && (
        <p className="text-xs text-muted-foreground">
          Shortfall {formatPesewas(quote.shortfallPesewas)} — absorbed by the clinic.
        </p>
      )}
    </div>
  );
}

function AddChargeCard({
  visitId,
  seesFinance,
}: {
  visitId: string;
  seesFinance: boolean;
}) {
  const [item, setItem] = useState<ChargeItem | null>(null);
  const [quantity, setQuantity] = useState("1");
  const submit = useBillFetcher();
  const quoteFetcher = useFetcher<BillingQuoteData>();
  const busy = submit.state !== "idle";

  const loadQuote = useRef(quoteFetcher.load);
  loadQuote.current = quoteFetcher.load;

  // Reprice while the line is being written — this is the point of the widget.
  useEffect(() => {
    if (!item) return;
    const params = new URLSearchParams({ visitId, chargeItemId: item.id });
    const parsed = Number(quantity);
    if (Number.isFinite(parsed) && parsed > 0) params.set("quantity", String(parsed));

    const timer = setTimeout(() => {
      loadQuote.current(`/resources/billing-quote?${params}`);
    }, 250);
    return () => clearTimeout(timer);
  }, [item, quantity, visitId]);

  // A landed charge resets the form for the next one.
  useEffect(() => {
    if (submit.state === "idle" && submit.data?.ok) {
      setItem(null);
      setQuantity("1");
    }
  }, [submit.state, submit.data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add a charge</CardTitle>
        <CardDescription>
          The API prices it against this visit's payer and the tariffs in force — what you
          see quoted is what lands on the bill.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <submit.Form method="post" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field>
              <FieldLabel htmlFor="add-charge-item">Item</FieldLabel>
              <ChargeItemPicker
                id="add-charge-item"
                name="chargeItemId"
                value={item}
                onPick={setItem}
                disabled={busy}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="add-charge-quantity">Quantity</FieldLabel>
              <Input
                id="add-charge-quantity"
                name="quantity"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                disabled={busy}
                className="font-mono tabular-nums"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="add-charge-description">Description (optional)</FieldLabel>
            <Input
              id="add-charge-description"
              name="description"
              placeholder="Overrides the item's own name on the bill"
              disabled={busy}
            />
          </Field>

          <QuotePanel
            quote={item ? (quoteFetcher.data?.quote ?? null) : null}
            message={item ? quoteFetcher.data?.message : undefined}
            loading={quoteFetcher.state !== "idle"}
            seesFinance={seesFinance}
          />

          <div className="flex justify-end border-t pt-4">
            <Button type="submit" name="intent" value="add" disabled={busy || item === null}>
              {busy ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
              Add to the bill
            </Button>
          </div>
        </submit.Form>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
   The page
   ------------------------------------------------------------------------- */

export default function VisitBillPage({ loaderData }: Route.ComponentProps) {
  const { visit, bill, canAddCharge, canAdjust, seesFinance } = loaderData;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Visit bill"
        description="Every line split between payer and patient, against the cover as at check-in."
        backTo={`/visits/${visit.id}`}
        backLabel="Back to the visit"
      />

      <VisitHeader visit={visit} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="space-y-6">
          <ChargeTable charges={bill.charges} canAdjust={canAdjust} seesFinance={seesFinance} />
          {canAddCharge && <AddChargeCard visitId={visit.id} seesFinance={seesFinance} />}
        </div>
        <BillSummary invoice={bill.invoice} charges={bill.charges} seesFinance={seesFinance} />
      </div>
    </div>
  );
}
