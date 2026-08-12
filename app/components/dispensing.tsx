/**
 * How pharmacy work is shown, shared by the counter, the prescription page and
 * the visit's prescribing screen (T7.2).
 *
 * The module's one typographic device is the **counting line**: record figures
 * set in the mono face with muted words between them — `5 of 15 given · 10
 * owed`. It is how this module renders every number a pharmacist would once
 * have written on the paper record, and {@link ItemCount} and
 * {@link DispenseTrail} are its two shapes here. Colour keeps one strict
 * vocabulary throughout: emerald for stock arriving or an item fully given,
 * amber for short or expiring, red only for cancelled, expired or an allergy
 * hit, and grey for a closed outcome.
 *
 * Two judgements this module makes on purpose:
 *
 * - **Out of stock is not a failure.** It reads as a closed outcome in muted
 *   grey, not as an error in red — the item is finished, the patient has been
 *   told to buy outside, and the low-stock report has been fed. Red is kept
 *   for a cancelled line, which is work that should not have existed.
 * - **The allergy panel shows the folder's allergies whether or not anything
 *   matched.** `allergyMatches` is a text match against the drug's names and
 *   knows nothing about drug classes, so an empty match list means nothing was
 *   *found*, never that the drug is safe. Showing the list in full is what
 *   keeps the check honest.
 */

import { format } from "date-fns";
import { PackageXIcon, TriangleAlertIcon } from "lucide-react";

import { StatusPill } from "~/components/directory";
import { cn } from "~/lib/utils";
import {
  PrescriptionItemStatuses,
  PrescriptionStatuses,
  type PrescriptionItemStatus,
  type PrescriptionStatus,
} from "~/models/enums";
import { isActiveItem, type DispenseRecord, type PrescriptionItem } from "~/models/pharmacy";
import { describeAllergy, type Allergy } from "~/models/patient";

/* -------------------------------------------------------------------------
   Pills
   ------------------------------------------------------------------------- */

/** Where a whole script stands — can this patient leave the counter? */
export function PrescriptionStatusPill({ status }: { status: PrescriptionStatus }) {
  const tone =
    status === "dispensed"
      ? "positive"
      : status === "cancelled"
        ? "critical"
        : status === "partially_dispensed"
          ? "warning"
          : "muted";

  return <StatusPill tone={tone}>{PrescriptionStatuses.label(status)}</StatusPill>;
}

/** What happened to one drug. See the module note on `out_of_stock`. */
export function ItemStatusPill({ status }: { status: PrescriptionItemStatus }) {
  const tone =
    status === "dispensed"
      ? "positive"
      : status === "cancelled"
        ? "critical"
        : status === "partially_dispensed" || status === "substituted"
          ? "warning"
          : "muted";

  return <StatusPill tone={tone}>{PrescriptionItemStatuses.label(status)}</StatusPill>;
}

/* -------------------------------------------------------------------------
   The counting line
   ------------------------------------------------------------------------- */

/**
 * One item's quantity account — `5 of 15 given · 10 owed`.
 *
 * The figures are the record: what was prescribed, what has gone out, what the
 * patient is still owed. Set in the mono face so they read as ledger entries,
 * with the words kept muted between them.
 */
export function ItemCount({ item }: { item: PrescriptionItem }) {
  const owed = isActiveItem(item) && item.quantityDispensed > 0;

  return (
    <span className="font-mono text-xs tabular-nums text-muted-foreground">
      <span className="font-medium text-foreground">{item.quantityDispensed}</span>
      {" of "}
      <span className="font-medium text-foreground">{item.quantityPrescribed}</span>
      {" given"}
      {owed && (
        <>
          {" · "}
          <span className="font-medium text-amber-700 dark:text-amber-400">
            {item.quantityOutstanding}
          </span>
          {" owed"}
        </>
      )}
    </span>
  );
}

/**
 * A script's items as a strip of segments, one per item, readable at a
 * corridor glance where pills need reading: emerald went out in full, amber is
 * part-way or substituted, grey reached a closed end, red should not have
 * existed, and a hollow segment is still waiting.
 */
export function FillMeter({ items }: { items: readonly PrescriptionItem[] }) {
  if (items.length === 0) return null;

  return (
    <span
      className="flex h-1.5 w-full max-w-32 items-stretch gap-px overflow-hidden rounded-full"
      role="img"
      aria-label={`${items.filter((item) => !isActiveItem(item)).length} of ${items.length} items settled`}
    >
      {items.map((item) => (
        <span
          key={item.id}
          className={cn(
            "min-w-1 flex-1",
            item.status === "dispensed" && "bg-emerald-500 dark:bg-emerald-400",
            (item.status === "partially_dispensed" || item.status === "substituted") &&
              "bg-amber-500 dark:bg-amber-400",
            item.status === "out_of_stock" && "bg-muted-foreground/40",
            item.status === "cancelled" && "bg-destructive/70",
            item.status === "pending" && "bg-border",
          )}
        />
      ))}
    </span>
  );
}

/* -------------------------------------------------------------------------
   Stock
   ------------------------------------------------------------------------- */

/**
 * What the shelf can cover, against what is owed.
 *
 * A missing `stockOnHand` renders as "stock not checked" rather than zero —
 * "we did not look" and "there is none" send a patient to two different
 * places.
 */
export function StockLevel({
  stockOnHand,
  required,
  unitOfIssue,
}: {
  stockOnHand: number | undefined;
  /** What is still outstanding on the item, if this is a dispensing context. */
  required?: number;
  unitOfIssue?: string;
}) {
  if (stockOnHand === undefined) {
    return <span className="text-xs text-muted-foreground">Stock not checked</span>;
  }

  const unit = unitOfIssue ? ` ${unitOfIssue}` : "";
  const short = required !== undefined && stockOnHand < required;
  const empty = stockOnHand <= 0;

  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        empty
          ? "font-medium text-destructive"
          : short
            ? "font-medium text-amber-700 dark:text-amber-400"
            : "text-muted-foreground",
      )}
    >
      {empty ? (
        <>
          <PackageXIcon className="mr-1 inline size-3" aria-hidden />
          None on the shelf
        </>
      ) : (
        <>
          <span className="font-mono">{stockOnHand}</span>
          {unit} in stock
          {short ? (
            <>
              {" — "}
              <span className="font-mono">{required}</span> needed
            </>
          ) : (
            ""
          )}
        </>
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------
   The dispensing trail
   ------------------------------------------------------------------------- */

/**
 * Every batch handed over for one item, as ledger lines.
 *
 * This is the recall trail: a batch is withdrawn by number, and this is the
 * only record tying one to a patient. A part-dispensed item carries several
 * lines, one per trip to the counter, so it reads like the stock card it
 * writes to — quantity, batch, expiry, when, who.
 */
export function DispenseTrail({ dispenses }: { dispenses: readonly DispenseRecord[] }) {
  if (dispenses.length === 0) return null;

  return (
    <ul className="space-y-1">
      {dispenses.map((record, index) => (
        <li
          key={`${record.batchNumber}-${record.at}-${index}`}
          className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-xs text-muted-foreground"
        >
          <span className="font-medium text-foreground tabular-nums">−{record.quantity}</span>
          <span className="font-medium text-foreground">{record.batchNumber}</span>
          <span suppressHydrationWarning>
            exp {format(new Date(record.expiryDate), "MMM yyyy")}
          </span>
          <span suppressHydrationWarning>· {format(new Date(record.at), "d MMM, HH:mm")}</span>
          {record.byName && <span className="font-sans">· {record.byName}</span>}
        </li>
      ))}
    </ul>
  );
}

/** The label sentence, as the API composed it, plus anything the prescriber added. */
export function Directions({ item }: { item: PrescriptionItem }) {
  return (
    <p className="text-sm text-muted-foreground">
      {item.directions}
      {item.instructions ? ` — ${item.instructions}` : ""}
    </p>
  );
}

/* -------------------------------------------------------------------------
   Allergies
   ------------------------------------------------------------------------- */

/**
 * The folder's allergies, with anything matching the drugs in play called out.
 *
 * Rendered on the prescribing form and above the dispensing counter both, and
 * never hidden behind a "no conflicts" state — see the module note.
 */
export function AllergyPanel({
  allergies,
  matches = [],
}: {
  allergies: readonly Allergy[];
  /** Allergies that name a drug on this script — see `allergyMatches`. */
  matches?: readonly Allergy[];
}) {
  const flagged = new Set(matches.map((allergy) => allergy.substance));

  if (allergies.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
        No allergies are recorded on this folder. That is not the same as none — ask.
      </p>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        flagged.size > 0 ? "border-destructive/40 bg-destructive/5" : "bg-muted/40",
      )}
    >
      <p
        className={cn(
          "flex items-center gap-1.5 text-xs font-semibold",
          flagged.size > 0 ? "text-destructive" : "text-muted-foreground",
        )}
      >
        <TriangleAlertIcon className="size-3.5" aria-hidden />
        {flagged.size > 0
          ? `${flagged.size === 1 ? "An allergy names" : `${flagged.size} allergies name`} a drug on this script`
          : "Recorded allergies"}
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {allergies.map((allergy) => (
          <li
            key={allergy.substance}
            className={cn(
              "text-xs",
              flagged.has(allergy.substance)
                ? "font-semibold text-destructive"
                : "text-muted-foreground",
            )}
          >
            {describeAllergy(allergy)}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Matching is by name only — it cannot see that a cephalosporin is a penicillin
        relative. Read the list, not the highlight.
      </p>
    </div>
  );
}
