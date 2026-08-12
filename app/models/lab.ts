/**
 * Lab — the test catalogue (T6.1) and the order lifecycle (T6.2).
 *
 * Modelled from `components.schemas.{ReferenceRange, Analyte, LabTest,
 * LabResultValue, LabOrderItem, LabOrder, CreateLabOrder, CollectSpecimen,
 * EnterResults, RejectSpecimen}`.
 *
 * The one structural fact that shapes every screen: **the order is a container;
 * the item is the unit of work.** Results, verification and rejection are all
 * per *item* (`/lab/orders/{orderId}/items/{itemId}/…`), so a four-test panel
 * can be part-resulted and one haemolysed tube can be rejected while the rest
 * run. An order-level "enter results" button cannot express what the API does —
 * every action here hangs off {@link LabOrderItem}.
 *
 * Two more conventions worth stating:
 *
 * 1. **Flags are computed, never typed.** The bench enters values; the API
 *    grades each one against the reference range for this patient's sex and
 *    age and pushes critical values straight to the ordering clinician. The
 *    ranges shipped on {@link Analyte} are for *display* beside the input —
 *    see {@link rangeForPatient} — not for the client to judge with.
 * 2. **Ordering bills.** `POST /lab/orders` raises the charges for the tests
 *    in the same call, "so what is run is what is billed". There is no
 *    separate billing step to forget.
 */

import type {
  LabOrderStatus,
  LabResultFlag,
  LabResultType,
  Priority,
  Sex,
  SpecimenType,
} from "./enums";
import { comparePriority } from "./enums";
import type { IsoDateTime, ObjectId } from "./primitives";

/* -------------------------------------------------------------------------
   Catalogue (T6.1)
   ------------------------------------------------------------------------- */

/**
 * A normal range, optionally narrowed by sex and age.
 *
 * Haemoglobin differs by both; potassium by neither — so any of the narrowing
 * fields may be absent, and an analyte carries as many ranges as it needs.
 * `normalText` is the non-numeric form ("Negative", "No growth").
 */
export type ReferenceRange = {
  sex?: Sex;
  minAgeYears?: number;
  maxAgeYears?: number;
  low?: number;
  high?: number;
  normalText?: string;
  note?: string;
};

/**
 * One measurable component of a test.
 *
 * A test is a panel of these: an FBC carries a dozen, a malaria RDT exactly
 * one. `resultType` decides the input the bench gets — number, free text, or
 * one of `options` — and `criticalLow`/`criticalHigh` are the thresholds the
 * API pages the clinician over, shown here only so the bench knows the phone
 * call is coming.
 */
export type Analyte = {
  code: string;
  name: string;
  resultType: LabResultType;
  unit?: string;
  /** The permitted values when `resultType` is `select`. */
  options?: string[];
  ranges: ReferenceRange[];
  criticalLow?: number;
  criticalHigh?: number;
};

/** A test the laboratory offers. */
export type LabTest = {
  id: ObjectId;
  code: string;
  name: string;
  category: string;
  specimenType: SpecimenType;
  analytes: Analyte[];
  turnaroundTargetMinutes: number;
  active: boolean;
};

/* -------------------------------------------------------------------------
   Results (L0)
   ------------------------------------------------------------------------- */

/**
 * One analyte's answer, as graded.
 *
 * `value` is always a string on the wire, whatever was entered. `flag` is the
 * API's verdict and `referenceText` names the range it was judged against —
 * render both; never re-derive either from the catalogue, which may have
 * changed since this result was graded.
 */
export type LabResultValue = {
  analyteCode: string;
  analyteName: string;
  value: string;
  unit?: string;
  flag: LabResultFlag;
  /** The range this was judged against, as prose. */
  referenceText?: string;
};

/* -------------------------------------------------------------------------
   The order (L1 → L2)
   ------------------------------------------------------------------------- */

/**
 * One test on one order — the unit every lab action operates on.
 *
 * The audit trail is built in: who collected, resulted and verified, and when.
 * `turnaroundMinutes` (order to verified result) and `overdue` are computed
 * against the test's own target; `hasAbnormal`/`hasCritical` are rollups of
 * `results[].flag` so a worklist row can shout without walking the array.
 */
export type LabOrderItem = {
  id: ObjectId;
  testId: ObjectId;
  testCode: string;
  testName: string;
  specimenType: SpecimenType;
  status: LabOrderStatus;
  collectedAt?: IsoDateTime;
  collectedByName?: string;
  resultedAt?: IsoDateTime;
  resultedByName?: string;
  verifiedAt?: IsoDateTime;
  verifiedByName?: string;
  results: LabResultValue[];
  comment?: string;
  rejectionReason?: string;
  /** Order to verified result. Only once verified. */
  turnaroundMinutes?: number;
  turnaroundTargetMinutes: number;
  overdue: boolean;
  hasAbnormal: boolean;
  hasCritical: boolean;
};

/**
 * A request to the laboratory, and its results.
 *
 * `status` is the **least-advanced item** — one pending test holds the whole
 * order at `collected`, which is why screens report per-item progress (see
 * {@link orderProgress}) rather than trusting the order's own status to mean
 * "done". The accession number is the specimen's identity on the bench; it
 * goes on every worklist row and every printed label.
 *
 * Note there is no patient summary here — only ids. The bench works
 * sample-first by accession number; anything that needs a name loads the
 * visit.
 */
export type LabOrder = {
  id: ObjectId;
  accessionNumber: string;
  visitId: ObjectId;
  patientId: ObjectId;
  /** Least-advanced item — one pending test holds it. */
  status: LabOrderStatus;
  priority: Priority;
  clinicalNotes?: string;
  items: LabOrderItem[];
  orderedByName?: string;
  orderedAt: IsoDateTime;
};

/* -------------------------------------------------------------------------
   Write models
   ------------------------------------------------------------------------- */

/**
 * Body of `POST /lab/orders`.
 *
 * Raises the charges for the tests in the same call. Requires the doctor,
 * physician_assistant, midwife or admin role — ordering is a clinical act.
 */
export type CreateLabOrder = {
  visitId: ObjectId;
  /** At least one. */
  testIds: ObjectId[];
  /** Defaults to routine. */
  priority?: Priority;
  clinicalNotes?: string;
};

/** Body of `POST /lab/orders/{id}/collect`. */
export type CollectSpecimen = {
  /** Omit to collect every pending item. */
  itemIds?: ObjectId[];
};

/** One analyte's value as entered at the bench. */
export type ResultEntry = {
  analyteCode: string;
  /** Numeric analytes take a number; text and select take a string. */
  value: string | number;
};

/**
 * Body of `POST /lab/orders/{orderId}/items/{itemId}/results`.
 *
 * Analytes may be omitted — a part-run panel is a legitimate entry — but at
 * least one value must be present. Flags are computed on the server from the
 * patient's sex and age; nothing here carries a judgement.
 */
export type EnterResults = {
  results: ResultEntry[];
  comment?: string;
};

/** Body of `POST /lab/orders/{orderId}/items/{itemId}/reject`. */
export type RejectSpecimen = {
  /** Haemolysed, insufficient, wrongly labelled — why a fresh specimen is needed. */
  reason: string;
};

/* -------------------------------------------------------------------------
   Reference-range resolution
   ------------------------------------------------------------------------- */

/**
 * The range that applies to this patient, for display beside the input.
 *
 * A range matches when every constraint it declares is satisfied; among the
 * matches, the most narrowly-drawn one wins (sex + age beats age beats
 * unqualified), because that is the one the API will grade against. Returns
 * `undefined` when nothing matches — the input then shows no range rather
 * than a wrong one.
 *
 * Display only. The API resolves ranges itself when grading; this exists so
 * the bench can see the goalposts while typing, not so the client can flag.
 */
export function rangeForPatient(
  analyte: Analyte,
  sex: Sex,
  ageYears: number | undefined,
): ReferenceRange | undefined {
  let best: ReferenceRange | undefined;
  let bestSpecificity = -1;

  for (const range of analyte.ranges) {
    if (range.sex !== undefined && range.sex !== sex) continue;
    if (range.minAgeYears !== undefined && (ageYears === undefined || ageYears < range.minAgeYears))
      continue;
    if (range.maxAgeYears !== undefined && (ageYears === undefined || ageYears > range.maxAgeYears))
      continue;

    const specificity =
      (range.sex !== undefined ? 1 : 0) +
      (range.minAgeYears !== undefined ? 1 : 0) +
      (range.maxAgeYears !== undefined ? 1 : 0);

    if (specificity > bestSpecificity) {
      best = range;
      bestSpecificity = specificity;
    }
  }

  return best;
}

/**
 * A range as the bench reads it: `3.5–5.1 mmol/L`, `≥ 60 %`, or the prose form
 * ("Negative"). `undefined` when the range says nothing renderable.
 */
export function formatReferenceRange(
  range: ReferenceRange | undefined,
  unit?: string,
): string | undefined {
  if (!range) return undefined;
  if (range.normalText) return range.normalText;

  const suffix = unit ? ` ${unit}` : "";
  if (range.low !== undefined && range.high !== undefined)
    return `${range.low}–${range.high}${suffix}`;
  if (range.low !== undefined) return `≥ ${range.low}${suffix}`;
  if (range.high !== undefined) return `≤ ${range.high}${suffix}`;
  return undefined;
}

/* -------------------------------------------------------------------------
   Derived views
   ------------------------------------------------------------------------- */

/** The bench's three stages, in the order work flows through them. */
export const BENCH_STAGES = [
  { status: "ordered", label: "Awaiting collection" },
  { status: "collected", label: "Awaiting results" },
  { status: "resulted", label: "Awaiting verification" },
] as const satisfies ReadonlyArray<{ status: LabOrderStatus; label: string }>;

export type BenchStage = (typeof BENCH_STAGES)[number]["status"];

/** Items at one stage of the bench. */
export function itemsAtStage(order: LabOrder, stage: BenchStage): LabOrderItem[] {
  return order.items.filter((item) => item.status === stage);
}

/** Still moving: not yet verified, and not written off. */
export function isActiveItem(item: LabOrderItem): boolean {
  return item.status === "ordered" || item.status === "collected" || item.status === "resulted";
}

/**
 * The bench's sort: emergency before urgent before routine, then whoever has
 * been waiting longest. Same rule as the corridor (`compareQueueEntries`), so
 * the two screens never disagree about who is next.
 */
export function compareLabOrders(a: LabOrder, b: LabOrder): number {
  const byPriority = comparePriority(a.priority, b.priority);
  if (byPriority !== 0) return byPriority;
  return new Date(a.orderedAt).getTime() - new Date(b.orderedAt).getTime();
}

/**
 * Per-item progress — `2 of 4 verified` — because the order's own `status`
 * is its least-advanced item and says nothing about how much is done.
 * Rejected and cancelled items leave the denominator: they will never verify.
 */
export function orderProgress(order: LabOrder): { verified: number; total: number } {
  const counted = order.items.filter(
    (item) => item.status !== "rejected" && item.status !== "cancelled",
  );
  return {
    verified: counted.filter((item) => item.status === "verified").length,
    total: counted.length,
  };
}

/** Any verified result on the order worth a clinician's attention. */
export function hasReportableResults(order: LabOrder): boolean {
  return order.items.some((item) => item.status === "verified" && item.results.length > 0);
}

/**
 * The distinct specimens a collection round needs — one EDTA tube covers an
 * FBC and a sickling test. Order follows first appearance, not the enum.
 */
export function specimensToCollect(items: readonly LabOrderItem[]): SpecimenType[] {
  const seen = new Set<SpecimenType>();
  const result: SpecimenType[] = [];
  for (const item of items) {
    if (item.specimenType === "none" || seen.has(item.specimenType)) continue;
    seen.add(item.specimenType);
    result.push(item.specimenType);
  }
  return result;
}
