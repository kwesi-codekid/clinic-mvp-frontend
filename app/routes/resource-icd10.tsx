/**
 * `GET /resources/icd10` — the ICD-10 typeahead behind the diagnosis picker.
 *
 * A resource route rather than an action on the consultation screen for two
 * reasons:
 *
 * 1. **The token stays on the server.** The access token lives in an httpOnly
 *    cookie, so the browser cannot call the API directly; every live lookup has
 *    to go through a route of ours.
 * 2. **A `GET` fetcher does not revalidate.** `fetcher.load()` against this
 *    route fetches only this route. Posting to the consultation action instead
 *    would re-run that route's loader on every keystroke, re-fetching the visit
 *    and the note to answer a search box.
 *
 * Reused by the claims screens in Phase 10, which code against the same subset.
 */

import { searchIcd10 } from "~/lib/api/consultations";
import { requireStaffAction } from "~/lib/auth.server";
import type { Icd10Entry } from "~/models/consultation";
import type { Route } from "./+types/resource-icd10";

/** What `fetcher.data` carries. */
export type Icd10LookupData = {
  entries: Icd10Entry[];
};

/** Enough to fill the picker without scrolling forever. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function loader({ request }: Route.LoaderArgs) {
  // The action gate, deliberately: it refreshes a stale token in place and
  // hands back the cookie, where `requireStaff` would redirect. A typeahead
  // should not cost a redirect round trip mid-keystroke.
  const { accessToken, setCookie } = await requireStaffAction(request);

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const requested = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(requested)
    ? Math.min(Math.max(requested, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const headers = new Headers({ "cache-control": "no-store" });
  if (setCookie) headers.append("Set-Cookie", setCookie);

  // One character matches most of the catalogue; make the caller mean it.
  if (q.length < 2) {
    return Response.json({ entries: [] } satisfies Icd10LookupData, { headers });
  }

  const entries = await searchIcd10({ q, limit }, { token: accessToken });

  return Response.json({ entries } satisfies Icd10LookupData, { headers });
}
