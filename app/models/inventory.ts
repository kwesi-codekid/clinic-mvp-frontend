/**
 * Store & inventory — products, batches and the stock ledger (T7.1, T7.3).
 *
 * Modelled from `components.schemas.{Product, StockBatch, StockMovement,
 * Supplier, LowStockItem, ExpiringBatch, StockValuation}`.
 *
 * {@link Product} is shared with the pharmacy: it is what a clinician
 * prescribes and what the store receives, so it is modelled once, here, and
 * `~/models/pharmacy` imports it rather than restating it.
 *
 * Three facts shape every screen in this module:
 *
 * 1. **`Product.label` is the display string.** The API composes "generic,
 *    strength, brand" itself — render `label` and never rejoin the parts, or
 *    two screens will disagree about what the same drug is called.
 * 2. **`stockOnHand` and `belowReorderLevel` come live on the product.** They
 *    are not stored fields to be recomputed from batches; read them.
 * 3. **The ledger is append-only and signed.** `StockMovement.quantity` is
 *    negative for anything leaving the store and `balanceAfter` is the running
 *    total, so the ledger renders as a signed column and offers no edit — a
 *    mistake is corrected by another movement, never by rewriting one.
 */

import type { DosageForm, ProductCategory, StockMovementType } from "./enums";
import type { IsoDate, IsoDateTime, ObjectId } from "./primitives";

/* -------------------------------------------------------------------------
   Product (T7.1)
   ------------------------------------------------------------------------- */

/**
 * A drug or consumable held in the store.
 *
 * `stockOnHand` and `belowReorderLevel` are optional on the wire — a product
 * read outside a stock context may arrive without them, which is why nothing
 * here treats a missing `stockOnHand` as zero. "Unknown" and "none left" are
 * different answers to give a counter.
 */
export type Product = {
  id: ObjectId;
  code: string;
  genericName: string;
  brandName?: string;
  strength?: string;
  /** Generic, strength and brand as one display string. Render this. */
  label: string;
  dosageForm: DosageForm;
  category: ProductCategory;
  /** What one unit is — tablet, bottle, vial. Quantities are counted in these. */
  unitOfIssue: string;
  packSize: number;
  reorderLevel: number;
  /** Controlled drugs are logged more strictly; the UI says so on sight. */
  isControlled: boolean;
  isOnNhisList: boolean;
  nhisMedicineCode?: string;
  /** Live, computed by the API. Absent, not zero, when it was not asked for. */
  stockOnHand?: number;
  belowReorderLevel?: boolean;
  active: boolean;
};

/**
 * A delivery of one product, as received.
 *
 * Stock is held per batch because a recall, an expiry and a write-off all act
 * on a batch rather than a product. `daysToExpiry` and `expired` are the API's
 * arithmetic against its own clock — never re-derive them from `expiryDate`
 * in the browser, whose clock and timezone are a different thing.
 */
export type StockBatch = {
  id: ObjectId;
  productId: ObjectId;
  batchNumber: string;
  expiryDate: IsoDate;
  /** Negative once it has expired. */
  daysToExpiry: number;
  expired: boolean;
  quantityReceived: number;
  quantityRemaining: number;
  /** Cost of one unit of issue, in integer pesewas. */
  costPricePesewas: number;
  supplierName?: string;
  /** Goods-received note number, as written on the paperwork. */
  grnNumber?: string;
  receivedAt: IsoDateTime;
};

/**
 * One line of the append-only stock ledger.
 *
 * `quantity` is **signed** — negative for anything leaving the store — and
 * `balanceAfter` is the running total after this line. Rendering the magnitude
 * without its sign turns a write-off into a delivery, so
 * {@link formatSignedQuantity} is the only way this module prints one.
 */
export type StockMovement = {
  id: ObjectId;
  productId: ObjectId;
  type: StockMovementType;
  /** Negative for anything leaving the store. */
  quantity: number;
  balanceAfter: number;
  reason?: string;
  /** What caused it — a prescription, a GRN, a stock-take sheet. */
  reference?: string;
  byName?: string;
  at: IsoDateTime;
};

/** Who the store buys from. Only the name is mandatory. */
export type Supplier = {
  id: ObjectId;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  active: boolean;
};

/* -------------------------------------------------------------------------
   Reports
   ------------------------------------------------------------------------- */

/** A product at or below its reorder level — the buying list. */
export type LowStockItem = {
  productId: ObjectId;
  name: string;
  onHand: number;
  reorderLevel: number;
  unitOfIssue: string;
};

/** Stock that becomes a write-off unless it moves. */
export type ExpiringBatch = {
  id: ObjectId;
  productName: string;
  batchNumber: string;
  expiryDate: IsoDate;
  daysToExpiry: number;
  quantityRemaining: number;
  /** What walking away from this batch would cost, in integer pesewas. */
  valueAtCostPesewas: number;
};

/**
 * What the owner has tied up on the shelves.
 *
 * The expired share is reported separately because it is not stock — it is a
 * write-off waiting to be counted, and a valuation that hides it inside the
 * total overstates what the clinic actually holds.
 */
export type StockValuation = {
  totalPesewas: number;
  totalFormatted: string;
  batches: number;
  expiredPesewas: number;
  expiredFormatted: string;
};

/* -------------------------------------------------------------------------
   Write models (T7.3)
   ------------------------------------------------------------------------- */

/**
 * Body of `POST /inventory/receive` — a goods receipt.
 *
 * Receiving creates the batch; there is no separate "add batch" call. Requires
 * the store, pharmacy or admin role.
 */
export type ReceiveStock = {
  productId: ObjectId;
  batchNumber: string;
  expiryDate: IsoDate;
  /** At least 1, counted in the product's unit of issue. */
  quantity: number;
  /** Cost of one unit, in integer pesewas. */
  costPricePesewas?: number;
  supplierId?: ObjectId;
};

/**
 * Body of `POST /inventory/batches/{id}/adjust`.
 *
 * `quantity` is signed — negative removes stock — and the reason is mandatory
 * because this is the one write that changes a balance without a patient or a
 * delivery behind it. It lands in the ledger like everything else.
 */
export type AdjustStock = {
  /** Negative to remove stock. */
  quantity: number;
  type: StockMovementType;
  reason: string;
};

/** Body of `POST /inventory/suppliers`. */
export type CreateSupplier = {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
};

/**
 * The movement types a person may pick when adjusting a batch by hand.
 *
 * `receipt` and `dispense` are missing on purpose: stock arrives through the
 * goods-receipt form and leaves through the dispensing counter, each of which
 * records far more than an adjustment can. Offering them here would be an
 * invitation to bypass both.
 */
export const ADJUSTABLE_MOVEMENT_TYPES = [
  "adjustment",
  "wastage",
  "expiry",
  "return",
  "stock_take",
] as const satisfies ReadonlyArray<StockMovementType>;

/* -------------------------------------------------------------------------
   Derived views
   ------------------------------------------------------------------------- */

/** Anything leaving the store, whatever it is called. */
export function isOutwardMovement(movement: StockMovement): boolean {
  return movement.quantity < 0;
}

/**
 * A ledger quantity with its sign showing — `+40`, `−12`.
 *
 * Uses a true minus sign (U+2212) rather than a hyphen: at ledger sizes the
 * hyphen is easy to lose, and losing it inverts the line.
 */
export function formatSignedQuantity(quantity: number): string {
  if (quantity < 0) return `−${Math.abs(quantity)}`;
  return `+${quantity}`;
}

/**
 * How loudly a batch's expiry should read.
 *
 * `critical` once it has expired — that stock cannot be given to anyone —
 * `warning` inside three months, which is the horizon the expiring-batches
 * report defaults to, and `positive` beyond it.
 */
export function expiryTone(
  daysToExpiry: number,
  expired = daysToExpiry < 0,
): "positive" | "warning" | "critical" {
  if (expired || daysToExpiry < 0) return "critical";
  return daysToExpiry <= 90 ? "warning" : "positive";
}

/** `Expired`, `Expires today`, `12 days left`, `8 months left`. */
export function formatExpiry(daysToExpiry: number, expired = daysToExpiry < 0): string {
  if (expired || daysToExpiry < 0) return "Expired";
  if (daysToExpiry === 0) return "Expires today";
  if (daysToExpiry < 60) return `${daysToExpiry} days left`;
  return `${Math.round(daysToExpiry / 30)} months left`;
}

/** Stock that can actually be given out: in date, and some left. */
export function isDispensable(batch: StockBatch): boolean {
  return !batch.expired && batch.quantityRemaining > 0;
}

/**
 * The batch the counter will dispense from next.
 *
 * First-expiry-first-out, which is what the API does when it takes stock —
 * shown so the shelf and the system agree about which box to open. `GET
 * /inventory/products/{id}/batches` already returns them in expiry order, so
 * this is a find, not a sort.
 */
export function nextBatchOut(batches: readonly StockBatch[]): StockBatch | undefined {
  return batches.find(isDispensable);
}

/**
 * What is left in a batch, at cost, in integer pesewas.
 *
 * A display estimate for the batch table: `costPricePesewas` is the price of
 * one unit, and a fractional remainder (half a bottle) can leave the product
 * off the pesewa, so it is rounded. The authority on what the shelves are
 * worth is `GET /inventory/valuation`, never this.
 */
export function batchValuePesewas(batch: StockBatch): number {
  return Math.round(batch.costPricePesewas * batch.quantityRemaining);
}

/**
 * How far below the reorder level a product has fallen, as a fraction of that
 * level — `0` at the line, `1` when the shelf is empty. Used to sort the
 * buying list by urgency rather than alphabetically.
 */
export function shortfallRatio(item: LowStockItem): number {
  if (item.reorderLevel <= 0) return item.onHand > 0 ? 0 : 1;
  return Math.min(Math.max((item.reorderLevel - item.onHand) / item.reorderLevel, 0), 1);
}

/** Emptiest shelves first — what to buy before what merely needs topping up. */
export function compareLowStock(a: LowStockItem, b: LowStockItem): number {
  const byUrgency = shortfallRatio(b) - shortfallRatio(a);
  return byUrgency !== 0 ? byUrgency : a.name.localeCompare(b.name);
}
