/**
 * Prescribing and dispensing (T7.2).
 *
 * Modelled from `components.schemas.{DispenseRecord, PrescriptionItem,
 * Prescription, PrescriptionItemInput, CreatePrescription, DispenseItem,
 * SubstituteItem}`. The drug itself is {@link Product}, modelled once in
 * `~/models/inventory` because the store and the counter mean the same thing
 * by it.
 *
 * The shape is the lab's, for the same reason: **the prescription is a
 * container; the item is the unit of work.** Dispensing, substituting and
 * running out are all per item
 * (`/pharmacy/prescriptions/{id}/items/{itemId}/…`), so one drug can be
 * handed over in full, a second given as a substitute, and a third closed as
 * out of stock — on the same script, in one visit to the counter. A
 * prescription-level "dispense" button cannot express any of that.
 *
 * Three more rules the API sets and the screens must not contradict:
 *
 * 1. **The quantity is derived, not typed twice.** `POST /pharmacy/
 *    prescriptions` works out what to dispense from dose, frequency and
 *    duration. {@link estimateQuantity} previews that arithmetic beside the
 *    form; the API's answer is the one that counts.
 * 2. **Charges are raised at dispensing, not at prescribing** — a script that
 *    is never collected must not appear on the bill.
 * 3. **`out_of_stock` is an outcome, not an error.** It closes the item so the
 *    patient can be sent to buy outside, and it feeds the low-stock report.
 */

import type { Allergy } from "./patient";
import type { Product } from "./inventory";
import type {
  AdministrationRoute,
  Frequency,
  PrescriptionItemStatus,
  PrescriptionStatus,
} from "./enums";
import type { IsoDate, IsoDateTime, ObjectId } from "./primitives";

/* -------------------------------------------------------------------------
   Dispensing record (L0)
   ------------------------------------------------------------------------- */

/**
 * Which batch a patient was actually given.
 *
 * This is what makes a recall possible: a batch is withdrawn by number, and
 * this is the only place that ties one to a person. A part-dispensed item
 * carries several, one per trip to the counter, so the trail is a list and
 * never a single "dispensed from" field.
 */
export type DispenseRecord = {
  batchNumber: string;
  expiryDate: IsoDate;
  quantity: number;
  at: IsoDateTime;
  byName?: string;
};

/* -------------------------------------------------------------------------
   The prescription (L1 → L2)
   ------------------------------------------------------------------------- */

/**
 * One drug on one prescription — the unit every pharmacy action operates on.
 *
 * `directions` is the dosing instruction as it reads on the label, composed by
 * the API from dose, frequency, route and duration; render it rather than
 * rebuilding the sentence, so the screen and the sticker agree.
 *
 * `stockOnHand` and `canDispenseInFull` are live at the moment the payload was
 * built — they are what lets the counter see, before calling the patient
 * forward, whether the shelf can cover the script. Both are optional: absent
 * means "not looked up", which is not the same as none left.
 */
export type PrescriptionItem = {
  id: ObjectId;
  productId: ObjectId;
  drugName: string;
  dose: string;
  frequency: Frequency;
  /** The frequency spelled out, e.g. `Three times daily`. */
  frequencyLabel: string;
  durationDays: number;
  route: AdministrationRoute;
  /** The dosing instruction as it reads on the label. */
  directions: string;
  quantityPrescribed: number;
  quantityDispensed: number;
  quantityOutstanding: number;
  /** Live stock, so the counter knows what it can give. */
  stockOnHand?: number;
  canDispenseInFull?: boolean;
  /** Anything extra the prescriber added — "take with food". */
  instructions?: string;
  status: PrescriptionItemStatus;
  /** The drug this one replaced, when it was a substitution. */
  substitutedFor?: string;
  substitutionReason?: string;
  /** Every batch handed over for this item, oldest first. */
  dispenses: DispenseRecord[];
};

/**
 * A prescription and its dispensing state.
 *
 * `status` is a rollup of the items — it answers "can this patient leave the
 * counter?", not "what happened to the amoxicillin?". Screens report per-item
 * outcomes (see {@link prescriptionProgress}) rather than trusting it to mean
 * that everything went out.
 *
 * Like the lab worklist, there is no patient summary here — only ids. The
 * counter works script-first; anything that needs a name loads the visit.
 */
export type Prescription = {
  id: ObjectId;
  visitId: ObjectId;
  patientId: ObjectId;
  status: PrescriptionStatus;
  items: PrescriptionItem[];
  notes?: string;
  prescribedByName?: string;
  prescribedAt: IsoDateTime;
};

/* -------------------------------------------------------------------------
   Write models
   ------------------------------------------------------------------------- */

/**
 * One line as written by the prescriber.
 *
 * `doseUnits` is how many units of issue one dose is — two 250 mg tablets to
 * make a 500 mg dose — and is what turns "1 tablet tds for 5 days" into a
 * quantity to count out. It defaults to 1. `quantityPrescribed` overrides the
 * derivation entirely, for the bottle of syrup that comes in one size.
 */
export type PrescriptionItemInput = {
  productId: ObjectId;
  /** As written, e.g. `1 tablet` or `5ml`. */
  dose: string;
  /** Units per dose, used to work out the quantity. Defaults to 1. */
  doseUnits?: number;
  frequency: Frequency;
  durationDays: number;
  route?: AdministrationRoute;
  /** Overrides the quantity derived from dose, frequency and duration. */
  quantityPrescribed?: number;
  instructions?: string;
};

/**
 * Body of `POST /pharmacy/prescriptions`.
 *
 * Requires the doctor, physician_assistant, midwife or admin role; a `409`
 * means the visit is not open to work.
 */
export type CreatePrescription = {
  visitId: ObjectId;
  /** At least one. */
  items: PrescriptionItemInput[];
  notes?: string;
};

/**
 * Body of `POST /pharmacy/prescriptions/{id}/items/{itemId}/dispense`.
 *
 * Omit `quantity` to hand over everything outstanding. Sending less is a
 * **partial** dispense, not a failure: the item stays open and the patient
 * comes back for the rest.
 */
export type DispenseItem = {
  /** Omit to dispense everything outstanding. */
  quantity?: number;
};

/** Body of `POST /pharmacy/prescriptions/{id}/items/{itemId}/substitute`. */
export type SubstituteItem = {
  /** What is being given instead. */
  productId: ObjectId;
  reason: string;
};

/* -------------------------------------------------------------------------
   Quantity derivation
   ------------------------------------------------------------------------- */

/**
 * Doses per day for each frequency.
 *
 * `stat` and `prn` are deliberately `undefined` rather than 1: a stat dose is
 * a single dose whatever the duration says, and "as required" has no daily
 * rate at all — anything else would be a guess dressed up as arithmetic.
 */
const DOSES_PER_DAY: Record<Frequency, number | undefined> = {
  od: 1,
  bd: 2,
  tds: 3,
  qid: 4,
  nocte: 1,
  mane: 1,
  q4h: 6,
  q6h: 4,
  q8h: 3,
  q12h: 2,
  weekly: 1 / 7,
  stat: undefined,
  prn: undefined,
};

/**
 * What the API will most likely work out as the quantity to dispense.
 *
 * A **preview**, shown beside the prescribing form so the prescriber can see
 * that "1 tablet tds for 5 days" means fifteen tablets before they commit —
 * `POST /pharmacy/prescriptions` does this derivation itself and its answer is
 * the record. Rounded up, because half a tablet cannot be counted into a bag.
 *
 * Returns `undefined` where no quantity follows from the instruction: `prn`
 * has no schedule, and a zero-length course has nothing to count.
 */
export function estimateQuantity(input: {
  doseUnits?: number;
  frequency: Frequency;
  durationDays: number;
}): number | undefined {
  const units = input.doseUnits ?? 1;
  if (units <= 0) return undefined;

  // A stat dose is given once; the duration says how long it acts, not how
  // many are handed over.
  if (input.frequency === "stat") return Math.ceil(units);

  const perDay = DOSES_PER_DAY[input.frequency];
  if (perDay === undefined || input.durationDays <= 0) return undefined;

  const raw = units * perDay * input.durationDays;
  // 3 * (1/7) * 14 is 5.999999999999999 without this.
  return Math.ceil(Number(raw.toFixed(4)));
}

/* -------------------------------------------------------------------------
   Allergy checking
   ------------------------------------------------------------------------- */

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Allergies on this folder that name this drug.
 *
 * A **courtesy check, not a safety system**, and the copy around it must say
 * so. It matches the recorded substance against the product's generic, brand
 * and display names as text: it will catch "allergic to amoxicillin" against
 * Amoxil 500 mg, and it will miss every cross-reactivity a pharmacist knows by
 * heart — penicillin against a cephalosporin, aspirin against an NSAID. The
 * API does not check at all, so an empty result means *nothing was matched*,
 * never *this drug is safe*. That is why the prescribing screen shows the
 * folder's allergies in full beside the form, whether or not anything matched.
 *
 * Substance words shorter than four characters are ignored on their own —
 * "oil" would otherwise flag half the shelf — but the whole substance is
 * always tried, so a short allergy name still matches its drug exactly.
 */
export function allergyMatches(
  allergies: readonly Allergy[],
  product: Pick<Product, "genericName" | "brandName" | "label">,
): Allergy[] {
  const haystack = normalise(
    [product.genericName, product.brandName, product.label].filter(Boolean).join(" "),
  );
  if (haystack === "") return [];

  return allergies.filter((allergy) => {
    const substance = normalise(allergy.substance);
    if (substance === "") return false;
    if (haystack.includes(substance)) return true;

    return substance
      .split(" ")
      .filter((word) => word.length >= 4)
      .some((word) => haystack.includes(word));
  });
}

/* -------------------------------------------------------------------------
   Derived views
   ------------------------------------------------------------------------- */

/** Still owed to the patient: pending, or part-dispensed and coming back. */
export function isActiveItem(item: PrescriptionItem): boolean {
  return item.status === "pending" || item.status === "partially_dispensed";
}

/**
 * Per-item progress, because the prescription's own `status` is a rollup and
 * says nothing about which drug went out.
 *
 * Cancelled items leave the denominator — they will never be dispensed.
 * `closed` counts every item that has reached an ending, including the ones
 * that ended as out-of-stock or a substitution, which is what tells the
 * counter whether the patient can go.
 */
export function prescriptionProgress(prescription: Prescription): {
  dispensed: number;
  outstanding: number;
  closed: number;
  total: number;
} {
  const counted = prescription.items.filter((item) => item.status !== "cancelled");
  const outstanding = counted.filter(isActiveItem).length;

  return {
    dispensed: counted.filter((item) => item.status === "dispensed").length,
    outstanding,
    closed: counted.length - outstanding,
    total: counted.length,
  };
}

/** Nothing left to hand over — every item has reached an ending. */
export function isSettled(prescription: Prescription): boolean {
  return prescription.items.every((item) => !isActiveItem(item));
}

/**
 * How much of this item the shelf can actually cover right now.
 *
 * `undefined` when stock was not looked up — the counter then dispenses
 * against what it can see on the shelf, and the API is the one that refuses.
 */
export function dispensableNow(item: PrescriptionItem): number | undefined {
  if (item.stockOnHand === undefined) return undefined;
  return Math.max(Math.min(item.quantityOutstanding, item.stockOnHand), 0);
}

/**
 * The counter's sort: whoever has been waiting longest goes first.
 *
 * A prescription carries no priority of its own — the urgency lives on the
 * visit, and the patient queue beside this list is where it shows.
 */
export function comparePrescriptions(a: Prescription, b: Prescription): number {
  return new Date(a.prescribedAt).getTime() - new Date(b.prescribedAt).getTime();
}

/** The drugs on a script, as one line for a worklist row. */
export function summariseItems(prescription: Prescription): string {
  return prescription.items.map((item) => item.drugName).join(", ");
}
