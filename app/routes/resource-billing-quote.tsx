/**
 * `GET /resources/billing-quote` — the live price quote behind the add-charge
 * form and any screen that orders something billable (T8.1).
 *
 * Wraps `GET /billing/quote?visitId&chargeItemId&quantity`, which prices an
 * item against the visit's **frozen** payer without charging anything. Called
 * with a fetcher while the item is still being chosen, so the patient's cost
 * is on screen before anyone commits — transparency at the moment of ordering
 * is the whole point of the endpoint.
 *
 * A failed quote resolves to `{ quote: null }` with the reason in words rather
 * than an error status: not being able to price an item must never break the
 * form that asked, only inform it.
 */

import { describeApiError } from "~/lib/api/client";
import { getPriceQuote } from "~/lib/api/billing";
import { requireStaffAction } from "~/lib/auth.server";
import type { PriceQuote } from "~/models/billing";
import { isObjectId } from "~/models/primitives";
import type { Route } from "./+types/resource-billing-quote";

/** What `fetcher.data` carries. */
export type BillingQuoteData = {
  quote: PriceQuote | null;
  /** Why there is no quote, in words the form can show. */
  message?: string;
};

export async function loader({ request }: Route.LoaderArgs) {
  // The action gate, deliberately: it refreshes a stale token in place where
  // `requireStaff` would redirect mid-keystroke.
  const { accessToken, setCookie } = await requireStaffAction(request);

  const url = new URL(request.url);
  const visitId = url.searchParams.get("visitId");
  const chargeItemId = url.searchParams.get("chargeItemId");
  const rawQuantity = Number(url.searchParams.get("quantity"));
  const quantity = Number.isFinite(rawQuantity) && rawQuantity > 0 ? rawQuantity : undefined;

  const headers = new Headers({ "cache-control": "no-store" });
  if (setCookie) headers.append("Set-Cookie", setCookie);

  const respond = (payload: BillingQuoteData) => Response.json(payload, { headers });

  if (!isObjectId(visitId) || !isObjectId(chargeItemId)) {
    return respond({ quote: null, message: "Pick an item to see its price." });
  }

  try {
    const quote = await getPriceQuote(
      { visitId, chargeItemId, quantity },
      { token: accessToken },
    );
    return respond({ quote });
  } catch (error) {
    return respond({ quote: null, message: describeApiError(error).description });
  }
}
