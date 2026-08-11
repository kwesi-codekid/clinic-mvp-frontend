/**
 * Money handling for the clinic.
 *
 * Every amount the API sends or accepts is an **integer count of pesewas**:
 * 100 pesewas = GHS 1.00. All arithmetic here is integer arithmetic — a bill
 * that is off by a floating-point epsilon is a bill that will not reconcile
 * against a till at close of day.
 *
 * Rules:
 * - Never multiply, divide or add money with plain `+` on cedis values.
 * - Prefer the `formatted` string the API already returns; use
 *   {@link formatPesewas} for totals the UI computes itself.
 * - No component formats money inline.
 */

import type { Money } from "~/models/primitives";

const PESEWAS_PER_CEDI = 100;

export type FormatPesewasOptions = {
  /**
   * How to prefix the amount. `"GHS"` → `GHS 12.35` (default),
   * `"₵"` → `₵12.35`, `"none"` → `12.35`.
   */
  symbol?: "GHS" | "₵" | "none";
  /** Group thousands with commas. Defaults to true. */
  grouping?: boolean;
};

function assertIntegerPesewas(value: number): void {
  if (!Number.isInteger(value)) {
    throw new TypeError(
      `Expected an integer number of pesewas, received ${value}. ` +
        "Money must never be held as a fractional value.",
    );
  }
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Renders integer pesewas as a display string.
 *
 * @example formatPesewas(1235) // "GHS 12.35"
 * @example formatPesewas(-50, { symbol: "none" }) // "-0.50"
 */
export function formatPesewas(
  pesewas: number,
  options: FormatPesewasOptions = {},
): string {
  assertIntegerPesewas(pesewas);
  const { symbol = "GHS", grouping = true } = options;

  const negative = pesewas < 0;
  const absolute = Math.abs(pesewas);
  const cedis = Math.trunc(absolute / PESEWAS_PER_CEDI);
  const remainder = absolute % PESEWAS_PER_CEDI;

  const whole = grouping ? group(String(cedis)) : String(cedis);
  const amount = `${negative ? "-" : ""}${whole}.${String(remainder).padStart(2, "0")}`;

  if (symbol === "none") return amount;
  if (symbol === "₵") return negative ? `-₵${amount.slice(1)}` : `₵${amount}`;
  return `GHS ${amount}`;
}

/**
 * Converts a cedis amount — as typed into a form, or as a number — to integer
 * pesewas. Accepts a leading `GHS`/`₵`, grouping commas and surrounding space.
 *
 * Throws on anything it cannot read exactly, including more than two decimal
 * places (there is no such thing as a third of a pesewa). Use
 * {@link tryToPesewas} where the input is untrusted, such as a form field.
 *
 * @example toPesewas("GHS 12.35") // 1235
 * @example toPesewas(12.35) // 1235
 */
export function toPesewas(cedis: string | number): number {
  if (typeof cedis === "number") {
    if (!Number.isFinite(cedis)) {
      throw new TypeError(`Cannot convert ${cedis} to pesewas.`);
    }
    // Rounding is safe here and necessary: 12.35 * 100 is 1234.9999999999998.
    const pesewas = Math.round(cedis * PESEWAS_PER_CEDI);
    if (Math.abs(pesewas - cedis * PESEWAS_PER_CEDI) > 0.001) {
      throw new TypeError(
        `${cedis} carries more precision than a pesewa; round it before converting.`,
      );
    }
    return pesewas;
  }

  const cleaned = cedis.trim().replace(/^GHS\s*/i, "").replace(/^₵\s*/, "").replace(/,/g, "");
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    throw new TypeError(`"${cedis}" is not a valid cedis amount.`);
  }

  const [, sign, whole, fraction = ""] = match;
  const pesewas =
    Number(whole) * PESEWAS_PER_CEDI + Number(fraction.padEnd(2, "0") || "0");
  return sign === "-" ? -pesewas : pesewas;
}

/**
 * {@link toPesewas} for untrusted input: returns `null` instead of throwing,
 * and treats an empty string as "nothing entered".
 */
export function tryToPesewas(cedis: string | number | null | undefined): number | null {
  if (cedis === null || cedis === undefined) return null;
  if (typeof cedis === "string" && cedis.trim() === "") return null;
  try {
    return toPesewas(cedis);
  } catch {
    return null;
  }
}

/**
 * Adds amounts in pesewas. Takes raw integers, {@link Money} objects, or a
 * mix — so a list of charges can be totalled without unwrapping first.
 * Subtract by passing negatives.
 *
 * @example sumPesewas(charges.map((c) => c.amount)) // Money[] → number
 */
export function sumPesewas(amounts: ReadonlyArray<number | Money>): number {
  let total = 0;
  for (const amount of amounts) {
    const pesewas = typeof amount === "number" ? amount : amount.pesewas;
    assertIntegerPesewas(pesewas);
    total += pesewas;
  }
  return total;
}

/**
 * Builds the {@link Money} shape the API returns, for totals the UI computes
 * locally (a running basket, a variance on the Z-report). Amounts that came
 * from the API already carry their own `formatted` — use that one.
 */
export function money(pesewas: number, options?: FormatPesewasOptions): Money {
  return { pesewas, formatted: formatPesewas(pesewas, options) };
}
