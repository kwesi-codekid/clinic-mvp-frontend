/**
 * Prescribing for one visit (T7.2) — `/visits/:visitId/prescription`.
 *
 * The clinician's side of the pharmacy: write the script here, and read back
 * what the counter actually handed over. The counter's own side — dispensing,
 * substituting, running out — lives under `/pharmacy`.
 *
 * Three rules the layout encodes:
 *
 * 1. **The allergy check happens before submit, and it is a courtesy.** The
 *    API does not check at all, and {@link allergyMatches} matches drug
 *    *names*, not drug classes. So the folder's allergies are on screen the
 *    whole time, and a name that matches blocks the button until the
 *    prescriber says they have seen it — a gate on this screen, not a record
 *    on the script.
 * 2. **The quantity is derived, not typed.** {@link estimateQuantity} shows
 *    what "1 tablet tds for 5 days" comes to while the line is being written;
 *    the API does the same arithmetic on save and its answer is the record.
 * 3. **Prescribing does not bill.** Charges are raised at dispensing, so a
 *    script that is never collected never reaches the bill — the form says so
 *    where a clinician would otherwise assume the opposite.
 */

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Loader2Icon, PillIcon, PlusIcon, SendIcon, XIcon } from "lucide-react";
import { data, Form, Link, useNavigation } from "react-router";
import { toast } from "sonner";

import {
  AllergyPanel,
  Directions,
  ItemCount,
  ItemStatusPill,
  PrescriptionStatusPill,
} from "~/components/dispensing";
import { PageHeader } from "~/components/page-header";
import { ProductPicker } from "~/components/product-picker";
import { VisitHeader } from "~/components/visit-header";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
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
import { Textarea } from "~/components/ui/textarea";
import { ApiError, describeApiError } from "~/lib/api/client";
import { getPatient } from "~/lib/api/patients";
import { createPrescription, listPrescriptions } from "~/lib/api/pharmacy";
import { throwRouteError } from "~/lib/api/route-error";
import { getVisit } from "~/lib/api/visits";
import { requireStaff, requireStaffAction } from "~/lib/auth.server";
import {
  AdministrationRoutes,
  Frequencies,
  type AdministrationRoute,
  type Frequency,
  type Role,
} from "~/models/enums";
import type { Product } from "~/models/inventory";
import type { Allergy } from "~/models/patient";
import {
  allergyMatches,
  comparePrescriptions,
  estimateQuantity,
  prescriptionProgress,
  type Prescription,
  type PrescriptionItemInput,
} from "~/models/pharmacy";
import { isObjectId, parseObjectId } from "~/models/primitives";

import type { Route } from "./+types/visit-prescription";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.visit.patient.fullName;
  return [{ title: name ? `Prescription · ${name} · Clinic` : "Prescription · Clinic" }];
}

/** Who `POST /pharmacy/prescriptions` accepts — prescribing is a clinical act. */
const PRESCRIBING_ROLES: readonly Role[] = [
  "doctor",
  "physician_assistant",
  "midwife",
  "admin",
];

/* -------------------------------------------------------------------------
   Loader
   ------------------------------------------------------------------------- */

export async function loader({ request, params }: Route.LoaderArgs) {
  const { accessToken, staff } = await requireStaff(request);
  const visitId = parseObjectId(params.visitId, "visit id");
  const opts = { token: accessToken };

  try {
    const visit = await getVisit(visitId, opts);

    // The visit carries a `PatientSummary`, which has no allergies on it —
    // the folder is where they live, and this screen cannot do its job
    // without them.
    const [patient, page] = await Promise.all([
      getPatient(visit.patient.id, opts),
      listPrescriptions({ visitId, limit: 50 }, opts),
    ]);

    return {
      visit,
      allergies: patient.allergies,
      prescriptions: [...page.items].sort(comparePrescriptions),
      canPrescribe: staff.roles.some((role) => PRESCRIBING_ROLES.includes(role)),
    };
  } catch (error) {
    throwRouteError(error);
  }
}

/* -------------------------------------------------------------------------
   Write
   ------------------------------------------------------------------------- */

/**
 * The lines, read back out of the parallel hidden fields each row posts.
 *
 * Every row writes every field, so the arrays stay index-aligned even when a
 * row leaves one blank — the same shape the diagnosis picker posts in.
 */
function readItems(form: FormData): PrescriptionItemInput[] {
  const productIds = form.getAll("itemProductId");
  const doses = form.getAll("itemDose");
  const doseUnits = form.getAll("itemDoseUnits");
  const frequencies = form.getAll("itemFrequency");
  const durations = form.getAll("itemDurationDays");
  const routes = form.getAll("itemRoute");
  const instructions = form.getAll("itemInstructions");

  const items: PrescriptionItemInput[] = [];

  for (let index = 0; index < productIds.length; index += 1) {
    const productId = productIds[index];
    const dose = String(doses[index] ?? "").trim();
    const frequency = frequencies[index];
    const duration = Number(durations[index]);

    // A half-written row is dropped rather than rejected: the picker leaves
    // one behind whenever someone adds a line and thinks better of it.
    if (!isObjectId(productId) || dose === "" || !Frequencies.is(frequency)) continue;

    const units = Number(doseUnits[index]);
    const route = routes[index];
    const note = String(instructions[index] ?? "").trim();

    items.push({
      productId,
      dose,
      doseUnits: Number.isFinite(units) && units > 0 ? units : undefined,
      frequency,
      durationDays: Number.isFinite(duration) && duration >= 0 ? Math.trunc(duration) : 0,
      route: AdministrationRoutes.is(route) ? route : undefined,
      instructions: note === "" ? undefined : note,
    });
  }

  return items;
}

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

  const items = readItems(form);
  if (items.length === 0) {
    return fail("Add at least one drug, with a dose and a frequency.");
  }

  const rawNotes = form.get("notes");

  try {
    const prescription = await createPrescription(
      {
        visitId,
        items,
        notes:
          typeof rawNotes === "string" && rawNotes.trim() !== "" ? rawNotes.trim() : undefined,
      },
      opts,
    );

    return ok(
      `Prescribed ${prescription.items.length} ${prescription.items.length === 1 ? "drug" : "drugs"}. The charges are raised when the pharmacy dispenses.`,
    );
  } catch (error) {
    if (!ApiError.is(error)) throw error;

    const message =
      error.status === 409
        ? "This visit is not open to new prescriptions. Reload to see where it stands."
        : describeApiError(error).description;

    return fail(message, error.status >= 400 ? error.status : 502);
  }
}

/* -------------------------------------------------------------------------
   The lines editor
   ------------------------------------------------------------------------- */

const FREQUENCY_ITEMS = Frequencies.options();
const ROUTE_ITEMS = AdministrationRoutes.options();

type LineDraft = {
  key: string;
  product: Product | null;
  dose: string;
  doseUnits: string;
  frequency: Frequency;
  durationDays: string;
  route: AdministrationRoute;
  instructions: string;
};

let nextKey = 0;

function emptyLine(): LineDraft {
  nextKey += 1;
  return {
    key: `line-${nextKey}`,
    product: null,
    dose: "",
    doseUnits: "1",
    frequency: "tds",
    durationDays: "5",
    route: "oral",
    instructions: "",
  };
}

/** A line is worth posting once it names a drug and a dose. */
function isComplete(line: LineDraft): boolean {
  return line.product !== null && line.dose.trim() !== "";
}

function LineRow({
  line,
  index,
  chosen,
  disabled,
  onChange,
  onRemove,
}: {
  line: LineDraft;
  index: number;
  chosen: ReadonlySet<string>;
  disabled: boolean;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
}) {
  const units = Number(line.doseUnits);
  const duration = Number(line.durationDays);
  const effectiveUnits = Number.isFinite(units) && units > 0 ? units : 1;
  const quantity = estimateQuantity({
    doseUnits: effectiveUnits,
    frequency: line.frequency,
    durationDays: Number.isFinite(duration) ? duration : 0,
  });

  return (
    <li className="space-y-3 rounded-lg border p-3">
      {/* Unnamed controls above; every field is posted from these, in the
          parallel-list order the action reads. */}
      <input type="hidden" name="itemProductId" value={line.product?.id ?? ""} />
      <input type="hidden" name="itemDose" value={line.dose} />
      <input type="hidden" name="itemDoseUnits" value={line.doseUnits} />
      <input type="hidden" name="itemFrequency" value={line.frequency} />
      <input type="hidden" name="itemDurationDays" value={line.durationDays} />
      <input type="hidden" name="itemRoute" value={line.route} />
      <input type="hidden" name="itemInstructions" value={line.instructions} />

      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <ProductPicker
            id={`drug-${index}`}
            value={line.product}
            onPick={(product) => onChange({ product })}
            disabled={disabled}
            category="drug"
            exclude={chosen}
            placeholder="Choose a drug"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove line ${index + 1}`}
        >
          <XIcon />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field>
          <FieldLabel htmlFor={`dose-${index}`}>Dose</FieldLabel>
          <Input
            id={`dose-${index}`}
            value={line.dose}
            onChange={(event) => onChange({ dose: event.target.value })}
            placeholder="1 tablet"
            disabled={disabled}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor={`units-${index}`}>Units per dose</FieldLabel>
          <Input
            id={`units-${index}`}
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={line.doseUnits}
            onChange={(event) => onChange({ doseUnits: event.target.value })}
            disabled={disabled}
          />
          <FieldDescription>
            {line.product ? `Counted in ${line.product.unitOfIssue}.` : "Two 250s make a 500."}
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor={`frequency-${index}`}>Frequency</FieldLabel>
          <Select
            id={`frequency-${index}`}
            value={line.frequency}
            onValueChange={(value) => onChange({ frequency: value as Frequency })}
            items={FREQUENCY_ITEMS}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FREQUENCY_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.value} — {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor={`duration-${index}`}>Days</FieldLabel>
          <Input
            id={`duration-${index}`}
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={line.durationDays}
            onChange={(event) => onChange({ durationDays: event.target.value })}
            disabled={disabled}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`route-${index}`}>Route</FieldLabel>
          <Select
            id={`route-${index}`}
            value={line.route}
            onValueChange={(value) => onChange({ route: value as AdministrationRoute })}
            items={ROUTE_ITEMS}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROUTE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor={`instructions-${index}`}>Note on the label</FieldLabel>
          <Input
            id={`instructions-${index}`}
            value={line.instructions}
            onChange={(event) => onChange({ instructions: event.target.value })}
            placeholder="After food"
            disabled={disabled}
          />
        </Field>
      </div>

      {/* The counting line: the same arithmetic the API runs on save, shown
          as arithmetic so the prescriber sees what the instruction counts
          out to before committing. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-xs">
        {quantity === undefined ? (
          <span className="text-muted-foreground">
            {line.frequency === "prn"
              ? "As required has no schedule — the pharmacy will need a quantity from you or a rule of its own."
              : "No quantity follows from this instruction yet."}
          </span>
        ) : (
          <>
            <span className="font-mono text-muted-foreground tabular-nums">
              {effectiveUnits}
              {line.frequency === "stat" ? (
                <> × stat</>
              ) : (
                <>
                  {" × "}
                  {line.frequency}
                  {" × "}
                  {duration} days
                </>
              )}
              {" = "}
              <span className="font-medium text-foreground">
                {quantity} {line.product?.unitOfIssue ?? "units"}
              </span>
            </span>
            <span className="text-muted-foreground">
              The pharmacy counts what the API works out on save, not this preview.
            </span>
          </>
        )}
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------
   Written prescriptions
   ------------------------------------------------------------------------- */

function PrescriptionCard({ prescription }: { prescription: Prescription }) {
  const progress = prescriptionProgress(prescription);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {prescription.items.length}{" "}
              {prescription.items.length === 1 ? "drug" : "drugs"}
            </span>
            <PrescriptionStatusPill status={prescription.status} />
          </div>
          <p className="text-xs text-muted-foreground" suppressHydrationWarning>
            Prescribed {format(new Date(prescription.prescribedAt), "d MMM, HH:mm")}
            {prescription.prescribedByName ? ` by ${prescription.prescribedByName}` : ""}
            {progress.total > 0 ? ` · ${progress.dispensed} of ${progress.total} dispensed` : ""}
          </p>
        </div>
        <Link
          to={`/pharmacy/prescriptions/${prescription.id}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Open at the counter
        </Link>
      </div>

      {prescription.notes && (
        <p className="border-b px-4 py-2 text-sm text-muted-foreground">{prescription.notes}</p>
      )}

      <ul className="divide-y">
        {prescription.items.map((item) => (
          <li key={item.id} className="space-y-1 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{item.drugName}</span>
              <ItemStatusPill status={item.status} />
              <ItemCount item={item} />
            </div>
            <Directions item={item} />
            {item.status === "substituted" && item.substitutedFor && (
              <p className="text-xs text-muted-foreground">
                Given instead of {item.substitutedFor}
                {item.substitutionReason ? ` — ${item.substitutionReason}` : ""}.
              </p>
            )}
            {item.status === "out_of_stock" && (
              <p className="text-xs text-muted-foreground">
                Not held at the time; the patient was sent to buy it outside.
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

export default function VisitPrescriptionPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { visit, allergies, prescriptions, canPrescribe } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.formData != null;

  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine()]);
  const [acknowledged, setAcknowledged] = useState(false);
  // Counts written scripts so each success remounts the form — the notes
  // field is uncontrolled and would otherwise carry over to the next script.
  const [written, setWritten] = useState(0);

  // A written script clears the form; a failure keeps it for another go.
  useEffect(() => {
    if (!actionData) return;
    if (actionData.ok) {
      toast.success(actionData.message);
      setLines([emptyLine()]);
      setAcknowledged(false);
      setWritten((count) => count + 1);
    } else {
      toast.error(actionData.message);
    }
  }, [actionData]);

  const open = visit.status === "open";
  const complete = lines.filter(isComplete);
  const chosen = new Set(complete.map((line) => line.product!.id));

  // One list, deduplicated: the same allergy naming two drugs is one warning.
  const matches: Allergy[] = [];
  for (const line of complete) {
    for (const allergy of allergyMatches(allergies, line.product!)) {
      if (!matches.some((seen) => seen.substance === allergy.substance)) matches.push(allergy);
    }
  }

  const blocked = matches.length > 0 && !acknowledged;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Prescription"
        description="Drugs written on this attendance, and what the pharmacy handed over."
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
          to={`/visits/${visit.id}/lab`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Laboratory
        </Link>
      </VisitHeader>

      <AllergyPanel allergies={allergies} matches={matches} />

      {canPrescribe && open && (
        <Form method="post" key={written}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Write a prescription</CardTitle>
              <CardDescription>
                Each line shows what the shelf holds while you choose, and roughly how much
                the quantity works out to.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-3">
                {lines.map((line, index) => (
                  <LineRow
                    key={line.key}
                    line={line}
                    index={index}
                    chosen={chosen}
                    disabled={busy}
                    onChange={(patch) =>
                      setLines((current) =>
                        current.map((entry) =>
                          entry.key === line.key ? { ...entry, ...patch } : entry,
                        ),
                      )
                    }
                    onRemove={() =>
                      setLines((current) => {
                        const next = current.filter((entry) => entry.key !== line.key);
                        return next.length > 0 ? next : [emptyLine()];
                      })
                    }
                  />
                ))}
              </ul>

              <Button
                type="button"
                variant="outline"
                onClick={() => setLines((current) => [...current, emptyLine()])}
                disabled={busy}
              >
                <PlusIcon />
                Add another drug
              </Button>

              <Field>
                <FieldLabel htmlFor="prescription-notes">Note for the pharmacy</FieldLabel>
                <Textarea
                  id="prescription-notes"
                  name="notes"
                  rows={2}
                  placeholder="Counsel on completing the course; mother is breastfeeding."
                  disabled={busy}
                />
              </Field>

              {matches.length > 0 && (
                <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                  <Checkbox
                    id="allergy-ack"
                    checked={acknowledged}
                    onCheckedChange={(checked) => setAcknowledged(checked === true)}
                    disabled={busy}
                  />
                  <Label htmlFor="allergy-ack" className="font-normal text-sm">
                    A recorded allergy names a drug on this script. I have read it and mean to
                    prescribe.
                  </Label>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 border-t pt-4">
                <span className="mr-auto text-xs text-muted-foreground">
                  Prescribing raises no charge — the bill follows what the pharmacy actually
                  dispenses.
                </span>
                <Button type="submit" disabled={busy || complete.length === 0 || blocked}>
                  {busy ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                  Send to the pharmacy
                </Button>
              </div>
            </CardContent>
          </Card>
        </Form>
      )}

      {!open && (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          This visit is no longer open, so nothing new can be prescribed.
        </p>
      )}

      {prescriptions.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
          <PillIcon className="mx-auto mb-2 size-6" strokeWidth={1.5} />
          Nothing has been prescribed on this visit.
        </p>
      ) : (
        <div className="space-y-4">
          {prescriptions.map((prescription) => (
            <PrescriptionCard key={prescription.id} prescription={prescription} />
          ))}
        </div>
      )}
    </div>
  );
}
