/**
 * Inventory tag — `/inventory/*` (T7.1, T7.3).
 *
 * The store's side of the shelf: what is held, what it cost, what came in and
 * what went out. The pharmacy's side — prescriptions and dispensing — is
 * `./pharmacy`, and the two meet at {@link Product}.
 *
 * Note what has no write here: **the ledger.** `GET /inventory/movements` is
 * read-only and there is no endpoint to amend a line, because a stock record
 * that can be rewritten is not a stock record. Stock comes in through
 * {@link receiveStock}, goes out through dispensing, and is corrected by
 * {@link adjustBatch} — which appends another line rather than editing one.
 */

import type {
  AdjustStock,
  CreateSupplier,
  ExpiringBatch,
  LowStockItem,
  Product,
  ReceiveStock,
  StockBatch,
  StockMovement,
  StockValuation,
  Supplier,
} from "~/models/inventory";
import type { ProductCategory } from "~/models/enums";
import type { ObjectId, Paginated } from "~/models/primitives";
import { request, requestPage, type RequestOptions } from "./client";

/* -------------------------------------------------------------------------
   Products (T7.1)
   ------------------------------------------------------------------------- */

/** Filters accepted by `GET /inventory/products`. */
export type ProductQuery = {
  page?: number;
  /** 1–200; the API defaults to 25. */
  limit?: number;
  q?: string;
  category?: ProductCategory;
  /** Only what has fallen to or below its reorder level. */
  lowOnly?: boolean;
};

/**
 * The catalogue, each product carrying its live `stockOnHand` and
 * `belowReorderLevel`. Open to any signed-in staff member: a clinician has to
 * be able to see whether the drug they are about to prescribe exists.
 */
export function listProducts(
  query: ProductQuery,
  options: RequestOptions,
): Promise<Paginated<Product>> {
  return requestPage<Product>("/inventory/products", {
    ...options,
    query: { ...options.query, ...query },
  });
}

/** One product, with live stock. */
export function getProduct(id: ObjectId, options: RequestOptions): Promise<Product> {
  return request<Product>(`/inventory/products/${id}`, options);
}

/**
 * A product's batches, **ordered by expiry** — which is the order they will be
 * dispensed in, so the list doubles as "which box to open next".
 */
export function listProductBatches(
  id: ObjectId,
  options: RequestOptions,
): Promise<StockBatch[]> {
  return request<StockBatch[]>(`/inventory/products/${id}/batches`, options);
}

/* -------------------------------------------------------------------------
   Stock movement (T7.3)
   ------------------------------------------------------------------------- */

/**
 * Receive a delivery, creating the batch.
 *
 * Requires the store, pharmacy or admin role. The batch it returns is what the
 * shelf label should be written from — the API assigns the GRN number.
 */
export function receiveStock(
  input: ReceiveStock,
  options: RequestOptions,
): Promise<StockBatch> {
  return request<StockBatch>("/inventory/receive", {
    ...options,
    method: "POST",
    body: input,
  });
}

/**
 * Adjust, write off or waste one batch.
 *
 * Every adjustment needs a reason and lands in the append-only ledger — this
 * is the only way a balance moves without a delivery or a patient behind it.
 * `quantity` is signed: negative removes stock. Requires store, pharmacy or
 * admin; a `422` means the batch cannot absorb the adjustment.
 */
export function adjustBatch(
  batchId: ObjectId,
  input: AdjustStock,
  options: RequestOptions,
): Promise<StockBatch> {
  return request<StockBatch>(`/inventory/batches/${batchId}/adjust`, {
    ...options,
    method: "POST",
    body: input,
  });
}

/** Filters accepted by `GET /inventory/movements`. */
export type MovementQuery = {
  page?: number;
  /** 1–200; the API defaults to 25. */
  limit?: number;
  productId?: ObjectId;
};

/**
 * The stock ledger — how the current level came about, not just what it is.
 *
 * Read-only by design: see the module note. Quantities are signed and
 * `balanceAfter` is the running total.
 */
export function listMovements(
  query: MovementQuery,
  options: RequestOptions,
): Promise<Paginated<StockMovement>> {
  return requestPage<StockMovement>("/inventory/movements", {
    ...options,
    query: { ...options.query, ...query },
  });
}

/* -------------------------------------------------------------------------
   Reports
   ------------------------------------------------------------------------- */

/** Products at or below their reorder level — the buying list. */
export function getLowStock(options: RequestOptions): Promise<LowStockItem[]> {
  return request<LowStockItem[]>("/inventory/low-stock", options);
}

/**
 * Batches expiring inside `withinDays` — stock that becomes a write-off unless
 * it moves. The API defaults to 90 days and caps the horizon at two years.
 */
export function getExpiringBatches(
  query: { withinDays?: number },
  options: RequestOptions,
): Promise<ExpiringBatch[]> {
  return request<ExpiringBatch[]>("/inventory/expiring", {
    ...options,
    query: { ...options.query, ...query },
  });
}

/** What the clinic has tied up on the shelves, and how much of it has expired. */
export function getStockValuation(options: RequestOptions): Promise<StockValuation> {
  return request<StockValuation>("/inventory/valuation", options);
}

/* -------------------------------------------------------------------------
   Suppliers
   ------------------------------------------------------------------------- */

/** Everyone the store buys from. Not paginated — the list is short. */
export function listSuppliers(options: RequestOptions): Promise<Supplier[]> {
  return request<Supplier[]>("/inventory/suppliers", options);
}

/** Add a supplier. Requires the store or admin role. */
export function createSupplier(
  input: CreateSupplier,
  options: RequestOptions,
): Promise<Supplier> {
  return request<Supplier>("/inventory/suppliers", {
    ...options,
    method: "POST",
    body: input,
  });
}
