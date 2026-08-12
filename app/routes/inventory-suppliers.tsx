/**
 * Suppliers (T7.3) — `/inventory/suppliers`.
 *
 * A short list and a short form. The API offers no update and no delete — a
 * supplier can only be added — so nothing here pretends otherwise: an
 * `active: false` supplier is shown as dormant rather than given an edit
 * button that would 404.
 *
 * The list matters for one reason beyond the address book: a supplier is
 * recorded on the batch at goods receipt, which is what a recall is traced
 * back through.
 */

import { useEffect } from "react";
import { Loader2Icon, PlusIcon, TruckIcon } from "lucide-react";
import { data, Form, useNavigation } from "react-router";
import { toast } from "sonner";

import { StatusPill } from "~/components/directory";
import { PageHeader } from "~/components/page-header";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { ApiError, describeApiError } from "~/lib/api/client";
import { createSupplier, listSuppliers } from "~/lib/api/inventory";
import { throwRouteError } from "~/lib/api/route-error";
import { requireStaff, requireStaffAction } from "~/lib/auth.server";
import type { Role } from "~/models/enums";

import type { Route } from "./+types/inventory-suppliers";

export function meta() {
  return [{ title: "Suppliers · Clinic" }];
}

/** Who `POST /inventory/suppliers` accepts. */
const STORE_ROLES: readonly Role[] = ["store", "admin"];

export async function loader({ request }: Route.LoaderArgs) {
  const { accessToken, staff } = await requireStaff(request);

  try {
    return {
      suppliers: await listSuppliers({ token: accessToken }),
      canAdd: staff.roles.some((role) => STORE_ROLES.includes(role)),
    };
  } catch (error) {
    throwRouteError(error);
  }
}

export async function action({ request }: Route.ActionArgs) {
  const { accessToken, setCookie } = await requireStaffAction(request);
  const form = await request.formData();

  const opts = { token: accessToken };
  // A rotated token has to ride out on every exit, success or not.
  const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;

  const text = (field: string) => {
    const value = form.get(field);
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed === "" ? undefined : trimmed;
  };

  const name = text("name");
  if (!name) {
    return data(
      { ok: false as const, message: "A supplier needs a name." },
      { status: 400, headers },
    );
  }

  try {
    const supplier = await createSupplier(
      {
        name,
        contactPerson: text("contactPerson"),
        phone: text("phone"),
        email: text("email"),
        address: text("address"),
      },
      opts,
    );

    return data({ ok: true as const, message: `${supplier.name} added.` }, { headers });
  } catch (error) {
    if (!ApiError.is(error)) throw error;
    return data(
      { ok: false as const, message: describeApiError(error).description },
      { status: error.status >= 400 ? error.status : 502, headers },
    );
  }
}

export default function SuppliersPage({ loaderData, actionData }: Route.ComponentProps) {
  const { suppliers, canAdd } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.formData != null;

  useEffect(() => {
    if (!actionData) return;
    const notify = actionData.ok ? toast.success : toast.error;
    notify(actionData.message);
  }, [actionData]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Suppliers"
        description="Who the store buys from. A supplier is recorded on the batch at goods receipt."
        backTo="/inventory"
        backLabel="Back to inventory"
      />

      {canAdd && (
        <Form method="post" key={actionData?.ok ? "added" : "fresh"}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add a supplier</CardTitle>
              <CardDescription>
                Only the name is required — the rest is what a storekeeper needs to chase a
                delivery.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="supplier-name">Name</FieldLabel>
                  <Input id="supplier-name" name="name" disabled={busy} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="supplier-contact">Contact person</FieldLabel>
                  <Input id="supplier-contact" name="contactPerson" disabled={busy} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="supplier-phone">Phone</FieldLabel>
                  <Input
                    id="supplier-phone"
                    name="phone"
                    type="tel"
                    placeholder="024 000 0000"
                    disabled={busy}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="supplier-email">Email</FieldLabel>
                  <Input id="supplier-email" name="email" type="email" disabled={busy} />
                  <FieldDescription>Checked by the API if given.</FieldDescription>
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="supplier-address">Address</FieldLabel>
                <Input id="supplier-address" name="address" disabled={busy} />
              </Field>

              <div className="flex justify-end border-t pt-4">
                <Button type="submit" disabled={busy}>
                  {busy ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
                  Add supplier
                </Button>
              </div>
            </CardContent>
          </Card>
        </Form>
      )}

      {suppliers.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-10 text-center text-sm text-muted-foreground">
          <TruckIcon className="mx-auto mb-2 size-6" strokeWidth={1.5} />
          No suppliers on file yet.
        </p>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <ul className="divide-y">
            {suppliers.map((supplier) => (
              <li key={supplier.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{supplier.name}</span>
                    {!supplier.active && <StatusPill tone="muted">Dormant</StatusPill>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[supplier.contactPerson, supplier.phone, supplier.email, supplier.address]
                      .filter(Boolean)
                      .join(" · ") || "No contact details on file."}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
