/**
 * `GET /resources/charge-items` — the billable-item lookup behind the charge
 * picker (T8.1).
 *
 * Same shape and the same two reasons as `/resources/products`: the access
 * token lives in an httpOnly cookie so the browser cannot call the API itself,
 * and a `GET` `fetcher.load()` answers a keystroke without revalidating the
 * screen that asked.
 *
 * Like the shelf and unlike ICD-10, **an empty query returns the catalogue**
 * — a clinic bills from a few dozen lines and the common case is picking
 * "General consultation" from a list, not typing it. Inactive items are
 * excluded at source: nothing new may be billed against a retired item, so a
 * picker has no business offering one.
 */

import { listChargeItems } from "~/lib/api/billing";
import { requireStaffAction } from "~/lib/auth.server";
import { ChargeCategories } from "~/models/enums";
import type { ChargeItem } from "~/models/billing";
import type { Route } from "./+types/resource-charge-items";

/** What `fetcher.data` carries. */
export type ChargeItemLookupData = {
  chargeItems: ChargeItem[];
};

/** Enough to browse without scrolling forever. */
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 200;

export async function loader({ request }: Route.LoaderArgs) {
  // The action gate, deliberately: it refreshes a stale token in place where
  // `requireStaff` would redirect mid-keystroke.
  const { accessToken, setCookie } = await requireStaffAction(request);

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || undefined;
  const rawCategory = url.searchParams.get("category");
  const category = ChargeCategories.is(rawCategory) ? rawCategory : undefined;

  const requested = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(requested)
    ? Math.min(Math.max(requested, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const headers = new Headers({ "cache-control": "no-store" });
  if (setCookie) headers.append("Set-Cookie", setCookie);

  const page = await listChargeItems(
    { q, category, limit, active: true },
    { token: accessToken },
  );

  return Response.json({ chargeItems: page.items } satisfies ChargeItemLookupData, { headers });
}
