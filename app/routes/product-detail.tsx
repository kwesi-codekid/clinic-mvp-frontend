/**
 * One product in the store (T7.1, T7.3) — `/inventory/products/:productId`.
 *
 * Three things about one line on the shelf: what it is, which batches hold it,
 * and how the balance got to where it is.
 *
 * The batch list is ordered by expiry, which is the order the pharmacy will
 * dispense in — the earliest-expiring usable batch is marked as the next one
 * out, so the shelf and the system open the same box. Adjusting a batch is the
 * only write here, and it appends to the ledger rather than editing it: a
 * quantity, a cause and a reason, exactly as the API records them.
 *
 * The ledger below is read-only, everywhere and always. A stock record that
 * can be rewritten is not a stock record — a mistake is corrected with another
 * movement.
 */

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Loader2Icon, PackagePlusIcon, ScrollTextIcon, ShieldAlertIcon } from "lucide-react";
import { data, Link, useFetcher } from "react-router";
import { toast } from "sonner";

import { StatusPill } from "~/components/directory";
import { PageHeader } from "~/components/page-header";
import { StockLedger } from "~/components/stock-ledger";
import { Button, buttonVariants } from "~/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { ApiError, describeApiError } from "~/lib/api/client";
import { adjustBatch, getProduct, listMovements, listProductBatches } from "~/lib/api/inventory";
import { throwRouteError } from "~/lib/api/route-error";
import { requireStaff, requireStaffAction } from "~/lib/auth.server";
import { formatPesewas } from "~/lib/money";
import { DosageForms, ProductCategories, StockMovementTypes, type Role } from "~/models/enums";
import {
  ADJUSTABLE_MOVEMENT_TYPES,
  batchValuePesewas,
  expiryTone,
  formatExpiry,
  nextBatchOut,
  type StockBatch,
} from "~/models/inventory";
import { isObjectId, parseObjectId } from "~/models/primitives";

import type { Route } from "./+types/product-detail";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `${loaderData.product.label} · Clinic` : "Product · Clinic" }];
}

/** Who may adjust, write off or waste stock. */
const STORE_ROLES: readonly Role[] = ["store", "pharmacy", "admin"];

/* -------------------------------------------------------------------------
   Loader
   ------------------------------------------------------------------------- */

export async function loader({ request, params }: Route.LoaderArgs) {
  const { accessToken, staff } = await requireStaff(request);
  const productId = parseObjectId(params.productId, "product id");
  const opts = { token: accessToken };

  try {
    const [product, batches, movements] = await Promise.all([
      getProduct(productId, opts),
      listProductBatches(productId, opts),
      listMovements({ productId, limit: 25 }, opts),
    ]);

    return {
      product,
      batches,
      movements: movements.items,
      canAdjust: staff.roles.some((role) => STORE_ROLES.includes(role)),
    };
  } catch (error) {
    throwRouteError(error);
  }
}

/* -------------------------------------------------------------------------
   Write
   ------------------------------------------------------------------------- */

export async function action({ request }: Route.ActionArgs) {
  const { accessToken, setCookie } = await requireStaffAction(request);
  const form = await request.formData();

  const opts = { token: accessToken };
  // A rotated token has to ride out on every exit, success or not.
  const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;

  const ok = (message: string) => data({ ok: true as const, message }, { headers });
  const fail = (message: string, status = 400) =>
    data({ ok: false as const, message }, { status, headers });

  const rawBatchId = form.get("batchId");
  if (!isObjectId(rawBatchId)) return fail("That batch could not be identified.");

  const magnitude = Number(form.get("quantity"));
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    return fail("Enter how many units the adjustment is for.");
  }

  const rawType = form.get("type");
  if (!StockMovementTypes.is(rawType)) {
    return fail("Choose what kind of adjustment this is.");
  }

  const rawReason = form.get("reason");
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";
  if (reason === "") {
    return fail("Every adjustment needs a reason — it is what the ledger keeps.");
  }

  // The form asks for a direction and a magnitude; the API takes one signed
  // number, negative to remove.
  const direction = form.get("direction") === "add" ? 1 : -1;
  const quantity = magnitude * direction;

  try {
    await adjustBatch(rawBatchId, { quantity, type: rawType, reason }, opts);
    return ok(
      direction < 0
        ? `${magnitude} removed from the batch and written to the ledger.`
        : `${magnitude} added to the batch and written to the ledger.`,
    );
  } catch (error) {
    if (!ApiError.is(error)) throw error;

    const message =
      error.status === 422
        ? `The batch cannot absorb that. ${describeApiError(error).description}`
        : describeApiError(error).description;

    return fail(message, error.status >= 400 ? error.status : 502);
  }
}

/* -------------------------------------------------------------------------
   Adjusting a batch
   ------------------------------------------------------------------------- */

const DIRECTION_ITEMS = [
  { value: "remove", label: "Remove from stock" },
  { value: "add", label: "Add to stock" },
];

const TYPE_ITEMS = ADJUSTABLE_MOVEMENT_TYPES.map((type) => ({
  value: type as string,
  label: StockMovementTypes.label(type),
}));

function AdjustDialog({ batch, unitOfIssue }: { batch: StockBatch; unitOfIssue: string }) {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const notify = fetcher.data.ok ? toast.success : toast.error;
    notify(fetcher.data.message);
    if (fetcher.data.ok) setOpen(false);
  }, [fetcher.data, fetcher.state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            Adjust
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust batch {batch.batchNumber}</DialogTitle>
          <DialogDescription>
            {batch.quantityRemaining} {unitOfIssue} on hand. This appends a line to the stock
            ledger — nothing is rewritten, and the reason stays with it.
          </DialogDescription>
        </DialogHeader>

        <fetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="batchId" value={batch.id} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`direction-${batch.id}`}>Direction</FieldLabel>
              <Select
                id={`direction-${batch.id}`}
                name="direction"
                defaultValue="remove"
                items={DIRECTION_ITEMS}
                disabled={busy}
              >
                <SelectTrigger className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIRECTION_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor={`quantity-${batch.id}`}>Quantity</FieldLabel>
              <Input
                id={`quantity-${batch.id}`}
                name="quantity"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                disabled={busy}
              />
              <FieldDescription>Counted in {unitOfIssue}.</FieldDescription>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor={`type-${batch.id}`}>What kind</FieldLabel>
            <Select
              id={`type-${batch.id}`}
              name="type"
              defaultValue={batch.expired ? "expiry" : "wastage"}
              items={TYPE_ITEMS}
              disabled={busy}
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              Receipts and dispensing are not here — stock arrives through a goods receipt and
              leaves through the counter, each of which records far more than this can.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={`reason-${batch.id}`}>Reason</FieldLabel>
            <Input
              id={`reason-${batch.id}`}
              name="reason"
              placeholder="Broken in transit; counted short at stock take"
              disabled={busy}
            />
          </Field>

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={busy}>
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              Record it
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

const HEAD =
  "h-10 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase";

export default function ProductDetailPage({ loaderData }: Route.ComponentProps) {
  const { product, batches, movements, canAdjust } = loaderData;
  const next = nextBatchOut(batches);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={product.label}
        description={`${ProductCategories.label(product.category)} · ${DosageForms.labelOr(product.dosageForm)} · issued per ${product.unitOfIssue}, packs of ${product.packSize}.`}
        backTo="/inventory"
        backLabel="Back to inventory"
      >
        <Link
          to={`/inventory/receive?productId=${product.id}`}
          className={buttonVariants({ variant: "default", size: "sm" })}
        >
          <PackagePlusIcon />
          Receive stock
        </Link>
        <Link
          to={`/inventory/movements?productId=${product.id}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ScrollTextIcon />
          Full ledger
        </Link>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card size="sm" className="gap-2">
          <CardHeader>
            <CardDescription>On hand</CardDescription>
            <CardTitle className="font-heading text-3xl font-semibold tracking-tight tabular-nums">
              {product.stockOnHand ?? "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {product.stockOnHand === undefined
              ? "Stock was not returned with this product."
              : `${product.unitOfIssue}. Reorder at ${product.reorderLevel}.`}
          </CardContent>
        </Card>

        <Card size="sm" className="gap-2">
          <CardHeader>
            <CardDescription>Next batch out</CardDescription>
            <CardTitle className="font-heading text-xl font-semibold tracking-tight">
              {next ? next.batchNumber : "None usable"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {next
              ? `${next.quantityRemaining} left, ${formatExpiry(next.daysToExpiry, next.expired).toLowerCase()}. Dispensing takes the earliest expiry first.`
              : "Every batch is empty or expired."}
          </CardContent>
        </Card>

        <Card size="sm" className="gap-2">
          <CardHeader>
            <CardDescription>Flags</CardDescription>
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {product.belowReorderLevel && <StatusPill tone="warning">Below reorder</StatusPill>}
              {!product.active && <StatusPill tone="muted">Inactive</StatusPill>}
              {product.isControlled && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold">
                  <ShieldAlertIcon className="size-3.5" aria-hidden />
                  Controlled
                </span>
              )}
              {product.isOnNhisList && <StatusPill tone="positive">On the NHIS list</StatusPill>}
              {!product.belowReorderLevel &&
                product.active &&
                !product.isControlled &&
                !product.isOnNhisList && (
                  <span className="text-xs text-muted-foreground">Nothing to flag.</span>
                )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <span className="font-mono">{product.code}</span>
            {product.nhisMedicineCode ? ` · NHIS ${product.nhisMedicineCode}` : ""}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-2">
        <h2 className="font-heading text-base font-semibold tracking-tight">
          Batches
          <span className="pl-2 text-sm font-normal text-muted-foreground">
            in the order they will be dispensed
          </span>
        </h2>

        <Card className="gap-0 overflow-hidden py-0">
          {batches.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              No stock has been received for this product.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className={HEAD}>Batch</TableHead>
                  <TableHead className={HEAD}>Expires</TableHead>
                  <TableHead className={HEAD}>Remaining</TableHead>
                  <TableHead className={HEAD}>At cost</TableHead>
                  <TableHead className={HEAD}>Received</TableHead>
                  {canAdjust && <TableHead className={HEAD}>&nbsp;</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell className="px-4 py-2.5">
                      <span className="font-mono text-sm">{batch.batchNumber}</span>
                      {batch.id === next?.id && (
                        <div className="text-xs font-medium text-primary">Next out</div>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-sm" suppressHydrationWarning>
                      {format(new Date(batch.expiryDate), "d MMM yyyy")}
                      <div>
                        <StatusPill tone={expiryTone(batch.daysToExpiry, batch.expired)}>
                          {formatExpiry(batch.daysToExpiry, batch.expired)}
                        </StatusPill>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-sm tabular-nums">
                      {batch.quantityRemaining}
                      <div className="text-xs text-muted-foreground">
                        of {batch.quantityReceived} received
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-sm tabular-nums">
                      {formatPesewas(batchValuePesewas(batch))}
                      <div className="text-xs text-muted-foreground">
                        {formatPesewas(batch.costPricePesewas)} per {product.unitOfIssue}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-sm" suppressHydrationWarning>
                      {format(new Date(batch.receivedAt), "d MMM yyyy")}
                      <div className="text-xs text-muted-foreground">
                        {batch.supplierName ?? "Supplier not recorded"}
                        {batch.grnNumber ? ` · GRN ${batch.grnNumber}` : ""}
                      </div>
                    </TableCell>
                    {canAdjust && (
                      <TableCell className="px-4 py-2.5 text-right">
                        <AdjustDialog batch={batch} unitOfIssue={product.unitOfIssue} />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-base font-semibold tracking-tight">
          Recent movement
          <span className="pl-2 text-sm font-normal text-muted-foreground">
            newest first, append-only
          </span>
        </h2>
        <Card className="gap-0 overflow-hidden py-0">
          <StockLedger movements={movements} unitOfIssue={product.unitOfIssue} />
        </Card>
      </section>
    </div>
  );
}
