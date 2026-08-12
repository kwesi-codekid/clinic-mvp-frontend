/**
 * Lab tag — `/lab/*`.
 *
 * The shape to keep in mind: the order is the container, the **item** is the
 * unit of work. Collection is order-level (one venepuncture fills the tubes
 * for several tests); results, verification and rejection are all per item,
 * which is what lets a panel be part-resulted and one bad specimen be
 * rejected while the rest run.
 *
 * **On realtime.** The worklist is "also pushed on the `lab:ordered` and
 * `lab:updated` socket events", but the socket contract is still undocumented
 * (TASK.md §7 question 1), so the bench polls its loader exactly as the
 * queues do — see `~/hooks/use-poll`. Swapping in Socket.io later (T0.5)
 * replaces the transport, not these functions.
 */

import type { LabOrderStatus } from "~/models/enums";
import type {
  CollectSpecimen,
  CreateLabOrder,
  EnterResults,
  LabOrder,
  LabTest,
  RejectSpecimen,
} from "~/models/lab";
import type { IsoDate, ObjectId, Paginated } from "~/models/primitives";
import { request, requestPage, type RequestOptions } from "./client";

/* -------------------------------------------------------------------------
   Catalogue (T6.1)
   ------------------------------------------------------------------------- */

/** Filters accepted by `GET /lab/tests`. Not paginated — the catalogue is small. */
export type LabTestQuery = {
  q?: string;
  category?: string;
  /** 1–200; the API defaults to 100. */
  limit?: number;
};

/**
 * The test catalogue, each test carrying its analytes and reference ranges.
 *
 * Open to any signed-in staff member. Small enough to fetch whole — the API
 * caps it at 200 and defaults to 100 — so the picker can browse it as well as
 * search it.
 */
export function listLabTests(
  query: LabTestQuery,
  options: RequestOptions,
): Promise<LabTest[]> {
  return request<LabTest[]>("/lab/tests", {
    ...options,
    query: { ...options.query, ...query },
  });
}

/** One test and its reference ranges. */
export function getLabTest(id: ObjectId, options: RequestOptions): Promise<LabTest> {
  return request<LabTest>(`/lab/tests/${id}`, options);
}

/* -------------------------------------------------------------------------
   Orders (T6.2)
   ------------------------------------------------------------------------- */

/** Filters accepted by `GET /lab/orders`. */
export type LabOrderQuery = {
  page?: number;
  /** 1–200; the API defaults to 25. */
  limit?: number;
  visitId?: ObjectId;
  patientId?: ObjectId;
  status?: LabOrderStatus;
  from?: IsoDate;
  to?: IsoDate;
  overdueOnly?: boolean;
};

/**
 * Order laboratory tests.
 *
 * Raises the charges for the tests in the same call, "so what is run is what
 * is billed". Requires the doctor, physician_assistant, midwife or admin role;
 * a `409` means the visit is not open to work.
 */
export function createLabOrder(
  input: CreateLabOrder,
  options: RequestOptions,
): Promise<LabOrder> {
  return request<LabOrder>("/lab/orders", { ...options, method: "POST", body: input });
}

/** List lab orders. `{ visitId }` is this visit's orders; open to any staff. */
export function listLabOrders(
  query: LabOrderQuery,
  options: RequestOptions,
): Promise<Paginated<LabOrder>> {
  return requestPage<LabOrder>("/lab/orders", {
    ...options,
    query: { ...options.query, ...query },
  });
}

/** One order, with every item and its results. */
export function getLabOrder(id: ObjectId, options: RequestOptions): Promise<LabOrder> {
  return request<LabOrder>(`/lab/orders/${id}`, options);
}

/**
 * The laboratory bench worklist: everything awaiting collection, result entry
 * or verification, urgent first. Requires the lab or admin role — this is the
 * bench's own view, not a general read.
 */
export function getLabWorklist(options: RequestOptions): Promise<LabOrder[]> {
  return request<LabOrder[]>("/lab/worklist", options);
}

/* -------------------------------------------------------------------------
   Item lifecycle
   ------------------------------------------------------------------------- */

/**
 * Record specimen collection.
 *
 * Order-level, not per item — one draw fills several tubes. Omit `itemIds` to
 * collect everything still pending. Requires lab, nurse, midwife or admin:
 * whoever actually holds the needle.
 */
export function collectSpecimen(
  orderId: ObjectId,
  input: CollectSpecimen,
  options: RequestOptions,
): Promise<LabOrder> {
  return request<LabOrder>(`/lab/orders/${orderId}/collect`, {
    ...options,
    method: "POST",
    body: input,
  });
}

/**
 * Enter results for one item.
 *
 * Each value is graded server-side against the reference range for this
 * patient's sex and age — flags are computed, never typed — and a critical
 * value is pushed straight to the ordering clinician. Requires lab or admin.
 */
export function enterResults(
  orderId: ObjectId,
  itemId: ObjectId,
  input: EnterResults,
  options: RequestOptions,
): Promise<LabOrder> {
  return request<LabOrder>(`/lab/orders/${orderId}/items/${itemId}/results`, {
    ...options,
    method: "POST",
    body: input,
  });
}

/**
 * Verify and release one item's results.
 *
 * The second pair of eyes before a result reaches a clinician — entry and
 * verification are deliberately separate steps, and the API will not let the
 * same act do both. Requires lab or admin.
 */
export function verifyResults(
  orderId: ObjectId,
  itemId: ObjectId,
  options: RequestOptions,
): Promise<LabOrder> {
  return request<LabOrder>(`/lab/orders/${orderId}/items/${itemId}/verify`, {
    ...options,
    method: "POST",
  });
}

/**
 * Reject one item's specimen — haemolysed, insufficient, wrongly labelled.
 *
 * A rejection is a verdict on the *specimen*, not the patient: the item ends
 * here and a fresh order restarts the test. Requires lab or admin.
 */
export function rejectSpecimen(
  orderId: ObjectId,
  itemId: ObjectId,
  input: RejectSpecimen,
  options: RequestOptions,
): Promise<LabOrder> {
  return request<LabOrder>(`/lab/orders/${orderId}/items/${itemId}/reject`, {
    ...options,
    method: "POST",
    body: input,
  });
}
