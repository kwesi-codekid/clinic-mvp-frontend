/**
 * One prescription at the counter (T7.2) —
 * `/pharmacy/prescriptions/:prescriptionId`.
 *
 * The dispensing screen. The structural rule is the lab's: **the prescription
 * is a container; every action is per item.** One drug goes out in full,
 * another as a substitute, a third is closed as out of stock — on the same
 * script, in one visit to the counter — so this renders a card per item, each
 * carrying only the actions its own status allows.
 *
 * What the copy has to keep straight:
 *
 * - **A partial dispense is a normal outcome.** Giving five of fifteen tablets
 *   leaves the item open with ten outstanding, and the patient comes back. The
 *   quantity box is prefilled with everything outstanding because that is the
 *   common case, not because anything less is a mistake.
 * - **Out of stock is an ending, not an error.** It closes the item so the
 *   patient can be sent to buy outside, and it feeds the low-stock report. It
 *   is offered as a plain action, not hidden behind a failure.
 * - **Dispensing does three things at once** — takes stock first-expiry-first-out,
 *   writes the ledger movement, and raises the charge at this patient's payer
 *   price. There is no separate billing step to remember, and the batch handed
 *   over is recorded so a recall can find this patient.
 */

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  HandCoinsIcon,
  Loader2Icon,
  PackageXIcon,
  ReplaceIcon,
  ShoppingBagIcon,
} from "lucide-react";
import { data, Link, useFetcher, type FetcherWithComponents } from "react-router";
import { toast } from "sonner";

import {
  AllergyPanel,
  Directions,
  DispenseTrail,
  ItemCount,
  ItemStatusPill,
  PrescriptionStatusPill,
  StockLevel,
} from "~/components/dispensing";
import { PageHeader } from "~/components/page-header";
import { ProductPicker } from "~/components/product-picker";
import { VisitHeader } from "~/components/visit-header";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
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
import { ApiError, describeApiError } from "~/lib/api/client";
import { getPatient } from "~/lib/api/patients";
import {
  dispenseItem,
  getPrescription,
  markOutOfStock,
  substituteItem,
} from "~/lib/api/pharmacy";
import { throwRouteError } from "~/lib/api/route-error";
import { getVisit } from "~/lib/api/visits";
import { requireStaff, requireStaffAction } from "~/lib/auth.server";
import type { Role } from "~/models/enums";
import type { Product } from "~/models/inventory";
import type { Allergy } from "~/models/patient";
import {
  allergyMatches,
  isActiveItem,
  prescriptionProgress,
  type PrescriptionItem,
} from "~/models/pharmacy";
import { isObjectId, parseObjectId } from "~/models/primitives";

import type { Route } from "./+types/prescription";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.visit.patient.fullName;
  return [{ title: name ? `Dispensing · ${name} · Clinic` : "Prescription · Clinic" }];
}

/** Who may dispense, substitute and close an item as out of stock. */
const COUNTER_ROLES: readonly Role[] = ["pharmacy", "admin"];

/* -------------------------------------------------------------------------
   Loader
   ------------------------------------------------------------------------- */

export async function loader({ request, params }: Route.LoaderArgs) {
  const { accessToken, staff } = await requireStaff(request);
  const prescriptionId = parseObjectId(params.prescriptionId, "prescription id");
  const opts = { token: accessToken };

  try {
    const prescription = await getPrescription(prescriptionId, opts);

    const [visit, patient] = await Promise.all([
      // The counter works script-first; this is where it becomes a person.
      getVisit(prescription.visitId, opts),
      // Allergies live on the folder, not on the visit's patient summary —
      // and the counter is the last place they can still stop a drug.
      getPatient(prescription.patientId, opts),
    ]);

    return {
      prescription,
      visit,
      allergies: patient.allergies,
      canDispense: staff.roles.some((role) => COUNTER_ROLES.includes(role)),
    };
  } catch (error) {
    throwRouteError(error);
  }
}

/* -------------------------------------------------------------------------
   Writes — one action, three intents, each posted from its own fetcher
   ------------------------------------------------------------------------- */

export async function action({ request, params }: Route.ActionArgs) {
  const { accessToken, setCookie } = await requireStaffAction(request);
  const prescriptionId = parseObjectId(params.prescriptionId, "prescription id");
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
  if (!itemId) return fail("That drug could not be identified.");

  try {
    switch (intent) {
      case "dispense": {
        const rawQuantity = form.get("quantity");
        const quantity = Number(rawQuantity);
        // An empty box means "everything outstanding" — the API's own default.
        const asked =
          typeof rawQuantity === "string" && rawQuantity.trim() !== "" ? quantity : undefined;

        if (asked !== undefined && (!Number.isFinite(asked) || asked <= 0)) {
          return fail("Enter how many to hand over, or leave it blank to give the rest.");
        }

        const updated = await dispenseItem(
          prescriptionId,
          itemId,
          { quantity: asked },
          opts,
        );
        const item = updated.items.find((entry) => entry.id === itemId);

        return ok(
          item && item.quantityOutstanding > 0
            ? `Dispensed. ${item.quantityOutstanding} still outstanding — the item stays open.`
            : "Dispensed in full. The stock movement and the charge are recorded.",
        );
      }

      case "substitute": {
        const rawProductId = form.get("productId");
        if (!isObjectId(rawProductId)) {
          return fail("Choose what is being given instead.");
        }

        const rawReason = form.get("reason");
        const reason = typeof rawReason === "string" ? rawReason.trim() : "";
        if (reason === "") {
          return fail("Say why the substitution is being made — it stays on the record.");
        }

        await substituteItem(prescriptionId, itemId, { productId: rawProductId, reason }, opts);
        return ok("Substituted. The original drug and the reason are on the record.");
      }

      case "out-of-stock": {
        await markOutOfStock(prescriptionId, itemId, opts);
        return ok(
          "Closed as out of stock. The patient can be sent to buy it outside, and the low-stock report has it.",
        );
      }

      default:
        return fail("That action is not one this screen can perform.");
    }
  } catch (error) {
    if (!ApiError.is(error)) throw error;

    // 409 is the counter's own race: two people worked the same item.
    // 422 is the shelf refusing — not enough stock to cover what was asked.
    const message =
      error.status === 409
        ? "This item has already moved on. The script has been refreshed."
        : error.status === 422
          ? `The shelf cannot cover that. ${describeApiError(error).description}`
          : describeApiError(error).description;

    return fail(message, error.status >= 400 ? error.status : 502);
  }
}

/* -------------------------------------------------------------------------
   Fetcher plumbing
   ------------------------------------------------------------------------- */

type PharmacyActionResult = { ok: boolean; message: string };

/**
 * A fetcher that reports what happened. Every write here is a one-card act
 * with no screen of its own to land on, so the answer is a toast — and a
 * colleague's parallel work showing up as a `409` is normal at a counter.
 */
function usePharmacyFetcher(): FetcherWithComponents<PharmacyActionResult> {
  const fetcher = useFetcher<PharmacyActionResult>();

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const notify = fetcher.data.ok ? toast.success : toast.error;
    notify(fetcher.data.message);
  }, [fetcher.data, fetcher.state]);

  return fetcher;
}

/* -------------------------------------------------------------------------
   Actions on one item
   ------------------------------------------------------------------------- */

function DispenseForm({ item }: { item: PrescriptionItem }) {
  const fetcher = usePharmacyFetcher();
  const busy = fetcher.state !== "idle";

  return (
    <fetcher.Form method="post" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="itemId" value={item.id} />

      <Field className="w-32">
        <FieldLabel htmlFor={`quantity-${item.id}`}>Quantity</FieldLabel>
        <Input
          id={`quantity-${item.id}`}
          name="quantity"
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          defaultValue={item.quantityOutstanding}
          disabled={busy}
          className="font-mono tabular-nums"
        />
      </Field>

      <span className="mb-2 text-xs text-muted-foreground">
        Prefilled with everything outstanding. Hand over less and the item stays open for the
        rest.
      </span>

      <Button
        type="submit"
        name="intent"
        value="dispense"
        className="mb-1 ml-auto"
        disabled={busy}
      >
        {busy ? <Loader2Icon className="animate-spin" /> : <HandCoinsIcon />}
        Dispense
      </Button>
    </fetcher.Form>
  );
}

function SubstituteDialog({ item }: { item: PrescriptionItem }) {
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const fetcher = usePharmacyFetcher();
  const busy = fetcher.state !== "idle";

  // Close once it lands; the revalidated script shows the outcome.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setOpen(false);
      setProduct(null);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            <ReplaceIcon />
            Substitute
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Give something else</DialogTitle>
          <DialogDescription>
            {item.drugName} is replaced on this script. The original drug and your reason stay
            on the record — a substitution is a decision, not a correction.
          </DialogDescription>
        </DialogHeader>

        <fetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="itemId" value={item.id} />

          <Field>
            <FieldLabel htmlFor={`substitute-${item.id}`}>What is being given</FieldLabel>
            <ProductPicker
              id={`substitute-${item.id}`}
              name="productId"
              value={product}
              onPick={setProduct}
              disabled={busy}
              category="drug"
              placeholder="Choose the replacement"
            />
            <FieldDescription>Stock levels show against each option.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={`substitute-reason-${item.id}`}>Reason</FieldLabel>
            <Input
              id={`substitute-reason-${item.id}`}
              name="reason"
              placeholder="Out of the branded form; same generic and strength"
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
            <Button
              type="submit"
              name="intent"
              value="substitute"
              disabled={busy || product === null}
            >
              {busy && <Loader2Icon className="animate-spin" />}
              Substitute
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

function OutOfStockDialog({ item }: { item: PrescriptionItem }) {
  const [open, setOpen] = useState(false);
  const fetcher = usePharmacyFetcher();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setOpen(false);
  }, [fetcher.state, fetcher.data]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            <PackageXIcon />
            Out of stock
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close {item.drugName} as out of stock</DialogTitle>
          <DialogDescription>
            The item ends here so the patient can be sent to buy it outside, and it is counted
            in the low-stock report. Nothing is charged for it. Substitute instead if you have
            something equivalent on the shelf.
          </DialogDescription>
        </DialogHeader>

        <fetcher.Form method="post">
          <input type="hidden" name="itemId" value={item.id} />
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={busy}>
                  Keep it open
                </Button>
              }
            />
            <Button type="submit" name="intent" value="out-of-stock" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              Close as out of stock
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

/**
 * One drug, drawn as the label it becomes: the drug name over the label
 * sentence, the quantity account beneath, and only the actions its status
 * allows. The blue left edge marks an item the counter still owes — it is the
 * one thing a pharmacist scans a long script for.
 */
function ItemCard({
  item,
  allergies,
  canDispense,
}: {
  item: PrescriptionItem;
  allergies: readonly Allergy[];
  canDispense: boolean;
}) {
  const flagged = allergyMatches(allergies, {
    genericName: item.drugName,
    label: item.drugName,
  });
  const active = isActiveItem(item);

  return (
    <Card className="relative gap-0 overflow-hidden py-0">
      {active && (
        <span aria-hidden className="absolute inset-y-0 left-0 w-0.75 bg-primary" />
      )}

      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-heading text-base font-semibold tracking-tight">
              {item.drugName}
            </span>
            <ItemStatusPill status={item.status} />
          </div>
          <Directions item={item} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
            <ItemCount item={item} />
            <StockLevel
              stockOnHand={item.stockOnHand}
              required={active ? item.quantityOutstanding : undefined}
            />
          </div>
          {flagged.length > 0 && (
            <p className="text-xs font-semibold text-destructive">
              A recorded allergy names this drug: {flagged.map((a) => a.substance).join(", ")}.
            </p>
          )}
        </div>

        {canDispense && active && (
          <div className="flex flex-wrap items-center gap-2">
            <SubstituteDialog item={item} />
            <OutOfStockDialog item={item} />
          </div>
        )}
      </div>

      <div className="space-y-3 p-4">
        {active &&
          (canDispense ? (
            <DispenseForm item={item} />
          ) : (
            <p className="text-sm text-muted-foreground">
              <span className="font-mono font-medium text-foreground tabular-nums">
                {item.quantityOutstanding}
              </span>{" "}
              outstanding, awaiting the counter.
            </p>
          ))}

        {item.status === "out_of_stock" && (
          <p className="text-sm text-muted-foreground">
            Not held at the time. The patient was sent to buy it outside, and it is counted in
            the low-stock report.
          </p>
        )}

        {item.status === "substituted" && (
          <p className="text-sm">
            <span className="font-medium">Substituted</span>{" "}
            <span className="text-muted-foreground">
              {item.substitutedFor ? `for ${item.substitutedFor}` : ""}
              {item.substitutionReason ? ` — ${item.substitutionReason}` : "."}
            </span>
          </p>
        )}

        {item.status === "cancelled" && (
          <p className="text-sm text-muted-foreground">This drug was cancelled.</p>
        )}

        {item.dispenses.length > 0 && (
          <div className="space-y-1.5 border-t pt-3">
            <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              Batches handed over
            </p>
            <DispenseTrail dispenses={item.dispenses} />
            <p className="text-xs text-muted-foreground">
              A recall is traced through these lines.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

export default function PrescriptionPage({ loaderData }: Route.ComponentProps) {
  const { prescription, visit, allergies, canDispense } = loaderData;
  const progress = prescriptionProgress(prescription);

  // One list for the banner: any allergy naming any drug on the script.
  const matches: Allergy[] = [];
  for (const item of prescription.items) {
    for (const allergy of allergyMatches(allergies, {
      genericName: item.drugName,
      label: item.drugName,
    })) {
      if (!matches.some((seen) => seen.substance === allergy.substance)) matches.push(allergy);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Dispensing
            <PrescriptionStatusPill status={prescription.status} />
          </span>
        }
        description={`Prescribed ${format(new Date(prescription.prescribedAt), "d MMM, HH:mm")}${prescription.prescribedByName ? ` by ${prescription.prescribedByName}` : ""} · ${progress.dispensed} of ${progress.total} dispensed.`}
        backTo="/pharmacy"
        backLabel="Back to the pharmacy"
      />

      <VisitHeader visit={visit}>
        <Link
          to={`/visits/${visit.id}/prescription`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ShoppingBagIcon />
          All scripts on this visit
        </Link>
      </VisitHeader>

      <AllergyPanel allergies={allergies} matches={matches} />

      {prescription.notes && (
        <Card>
          <div className="px-4 py-3 text-sm">
            <span className="font-medium">From the prescriber:</span>{" "}
            <span className="text-muted-foreground">{prescription.notes}</span>
          </div>
        </Card>
      )}

      <div className="space-y-4">
        {prescription.items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            allergies={allergies}
            canDispense={canDispense}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Dispensing takes stock first-expiry-first-out, writes the movement to the stock ledger
        and raises the charge at this patient's payer price — all in one step.
      </p>
    </div>
  );
}
