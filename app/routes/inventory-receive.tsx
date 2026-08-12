/**
 * Goods receipt (T7.3) — `/inventory/receive`.
 *
 * The one way stock enters the system. `POST /inventory/receive` creates the
 * batch as it records the delivery — there is no separate "add a batch" call,
 * because a batch that nobody delivered has no expiry, no cost and no
 * supplier, and those three are what every later decision hangs on:
 *
 * - **expiry** decides the order the pharmacy dispenses in,
 * - **cost** is what the valuation and the write-off report are counted at,
 * - **supplier** is what a recall is traced back through.
 *
 * The cost is typed in cedis and sent in integer pesewas — see `~/lib/money`.
 * It is the price of **one unit of issue**, not of the delivery: a box of 100
 * tablets bought for GHS 25 is 25 pesewas a tablet, and entering 2500 here
 * would value the shelf at a hundred times what it is worth.
 */

import { useEffect, useState } from "react";
import { Loader2Icon, PackagePlusIcon } from "lucide-react";
import { data, Form, useNavigation, useSearchParams } from "react-router";
import { toast } from "sonner";

import { PageHeader } from "~/components/page-header";
import { ProductPicker } from "~/components/product-picker";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ApiError, describeApiError } from "~/lib/api/client";
import { getProduct, listSuppliers, receiveStock } from "~/lib/api/inventory";
import { throwRouteError } from "~/lib/api/route-error";
import { requireStaff, requireStaffAction } from "~/lib/auth.server";
import { tryToPesewas } from "~/lib/money";
import type { Role } from "~/models/enums";
import type { Product } from "~/models/inventory";
import { isObjectId, parseObjectId } from "~/models/primitives";

import type { Route } from "./+types/inventory-receive";

export function meta() {
  return [{ title: "Receive stock · Clinic" }];
}

/** Who `POST /inventory/receive` accepts. */
const RECEIVING_ROLES: readonly Role[] = ["store", "pharmacy", "admin"];

/* -------------------------------------------------------------------------
   Loader
   ------------------------------------------------------------------------- */

export async function loader({ request }: Route.LoaderArgs) {
  const { accessToken, staff } = await requireStaff(request);
  const opts = { token: accessToken };

  const url = new URL(request.url);
  const rawProductId = url.searchParams.get("productId");
  const productId = rawProductId ? parseObjectId(rawProductId, "product id") : undefined;

  try {
    const [suppliers, product] = await Promise.all([
      listSuppliers(opts),
      // Arriving from a product page preselects the line being delivered.
      productId ? getProduct(productId, opts) : Promise.resolve(null),
    ]);

    return {
      suppliers: suppliers.filter((supplier) => supplier.active),
      product,
      canReceive: staff.roles.some((role) => RECEIVING_ROLES.includes(role)),
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

  const productId = form.get("productId");
  if (!isObjectId(productId)) return fail("Choose what was delivered.");

  const batchNumber = String(form.get("batchNumber") ?? "").trim();
  if (batchNumber === "") {
    return fail("Enter the batch number from the box — a recall is traced through it.");
  }

  const expiryDate = String(form.get("expiryDate") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
    return fail("Enter the expiry date printed on the box.");
  }

  const quantity = Number(form.get("quantity"));
  if (!Number.isFinite(quantity) || quantity < 1) {
    return fail("Enter how many units arrived.");
  }

  // Typed in cedis, sent in integer pesewas. An unreadable amount is dropped
  // rather than guessed at — the batch is still worth receiving.
  const costPricePesewas = tryToPesewas(String(form.get("costPrice") ?? "")) ?? undefined;

  const supplierId = form.get("supplierId");

  try {
    const batch = await receiveStock(
      {
        productId,
        batchNumber,
        expiryDate,
        quantity,
        costPricePesewas,
        supplierId: isObjectId(supplierId) ? supplierId : undefined,
      },
      opts,
    );

    return ok(
      `Received ${batch.quantityReceived} into batch ${batch.batchNumber}${batch.grnNumber ? ` on GRN ${batch.grnNumber}` : ""}.`,
    );
  } catch (error) {
    if (!ApiError.is(error)) throw error;
    return fail(
      describeApiError(error).description,
      error.status >= 400 ? error.status : 502,
    );
  }
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

export default function InventoryReceivePage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { suppliers, product: preselected, canReceive } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.formData != null;
  const [searchParams] = useSearchParams();

  const [product, setProduct] = useState<Product | null>(preselected);

  // A received delivery clears the form for the next line on the invoice;
  // a failure keeps what was typed.
  useEffect(() => {
    if (!actionData) return;
    if (actionData.ok) {
      toast.success(actionData.message);
      if (!searchParams.get("productId")) setProduct(null);
    } else {
      toast.error(actionData.message);
    }
  }, [actionData, searchParams]);

  const supplierItems = [
    { value: "", label: "Not recorded" },
    ...suppliers.map((supplier) => ({ value: supplier.id as string, label: supplier.name })),
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Receive stock"
        description="One delivery, one batch. Expiry, cost and supplier are what every later decision hangs on."
        backTo="/inventory"
        backLabel="Back to inventory"
      />

      {!canReceive ? (
        <p className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
          Receiving stock is the store's to do. Ask the storekeeper or an administrator.
        </p>
      ) : (
        <Form
          method="post"
          // A cleared form needs its inputs cleared too, and React Router
          // reuses the DOM across submissions.
          key={actionData?.ok ? "received" : "fresh"}
        >
          <Card>
            <CardContent className="space-y-4">
              <Field>
                <FieldLabel htmlFor="receive-product">What arrived</FieldLabel>
                <ProductPicker
                  id="receive-product"
                  name="productId"
                  value={product}
                  onPick={setProduct}
                  disabled={busy}
                  placeholder="Choose a product"
                />
                <FieldDescription>
                  {product
                    ? `Counted in ${product.unitOfIssue}; packs of ${product.packSize}.`
                    : "Drugs, consumables, reagents and equipment all come through here."}
                </FieldDescription>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="receive-batch">Batch number</FieldLabel>
                  <Input
                    id="receive-batch"
                    name="batchNumber"
                    placeholder="As printed on the box"
                    disabled={busy}
                  />
                  <FieldDescription>A recall is traced through this.</FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="receive-expiry">Expiry date</FieldLabel>
                  <Input id="receive-expiry" name="expiryDate" type="date" disabled={busy} />
                  <FieldDescription>Decides the order it dispenses in.</FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="receive-quantity">Quantity</FieldLabel>
                  <Input
                    id="receive-quantity"
                    name="quantity"
                    type="number"
                    min="1"
                    step="any"
                    inputMode="decimal"
                    disabled={busy}
                  />
                  <FieldDescription>
                    In {product?.unitOfIssue ?? "units of issue"}, not in packs.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="receive-cost">Cost per unit</FieldLabel>
                  <Input
                    id="receive-cost"
                    name="costPrice"
                    inputMode="decimal"
                    placeholder="0.25"
                    disabled={busy}
                  />
                  <FieldDescription>
                    In cedis, for one {product?.unitOfIssue ?? "unit"} — not for the whole
                    delivery. The valuation is counted at this.
                  </FieldDescription>
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="receive-supplier">Supplier</FieldLabel>
                <Select
                  id="receive-supplier"
                  name="supplierId"
                  defaultValue=""
                  items={supplierItems}
                  disabled={busy}
                >
                  <SelectTrigger className="h-8 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {supplierItems.map((item) => (
                      <SelectItem key={item.value || "none"} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {suppliers.length === 0
                    ? "No suppliers on file yet — add one from the suppliers page."
                    : "Who it came from, for the recall trail and the buying history."}
                </FieldDescription>
              </Field>

              <div className="flex items-center justify-end gap-3 border-t pt-4">
                <span className="mr-auto text-xs text-muted-foreground">
                  The API assigns the GRN number and writes the receipt to the stock ledger.
                </span>
                <Button type="submit" disabled={busy || product === null}>
                  {busy ? <Loader2Icon className="animate-spin" /> : <PackagePlusIcon />}
                  Receive it
                </Button>
              </div>
            </CardContent>
          </Card>
        </Form>
      )}
    </div>
  );
}
