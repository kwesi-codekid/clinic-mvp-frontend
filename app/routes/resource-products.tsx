/**
 * `GET /resources/products` — the drug and consumable lookup behind the
 * product picker (T7.1).
 *
 * Same shape and the same two reasons as `/resources/lab-tests`: the access
 * token lives in an httpOnly cookie so the browser cannot call the API itself,
 * and a `GET` `fetcher.load()` answers a keystroke without revalidating the
 * screen that asked.
 *
 * Like the lab catalogue and unlike ICD-10, **an empty query returns the
 * shelf** rather than nothing — a clinic stocks a few hundred lines and the
 * common case is picking paracetamol from a list, not typing it. The live
 * `stockOnHand` rides along on every row, which is the whole point: a
 * prescriber should see the shelf is empty while choosing, not after the
 * patient has walked to the counter.
 */

import { listProducts } from "~/lib/api/inventory";
import { requireStaffAction } from "~/lib/auth.server";
import { ProductCategories } from "~/models/enums";
import type { Product } from "~/models/inventory";
import type { Route } from "./+types/resource-products";

/** What `fetcher.data` carries. */
export type ProductLookupData = {
  products: Product[];
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
  const category = ProductCategories.is(rawCategory) ? rawCategory : undefined;

  const requested = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(requested)
    ? Math.min(Math.max(requested, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const headers = new Headers({ "cache-control": "no-store" });
  if (setCookie) headers.append("Set-Cookie", setCookie);

  const page = await listProducts({ q, category, limit }, { token: accessToken });

  return Response.json({ products: page.items } satisfies ProductLookupData, { headers });
}
