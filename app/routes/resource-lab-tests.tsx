/**
 * `GET /resources/lab-tests` — the catalogue lookup behind the test picker.
 *
 * Same shape as `/resources/icd10`, for the same two reasons: the access token
 * lives in an httpOnly cookie so the browser cannot call the API itself, and a
 * `GET` `fetcher.load()` answers a keystroke without revalidating the screen
 * that asked.
 *
 * One deliberate difference from the ICD-10 route: **an empty query returns
 * the catalogue**, not nothing. A clinic offers a few dozen tests, the API
 * caps the list at 200, and the common case is picking an FBC or a malaria
 * RDT from a browsable list rather than typing its name.
 */

import { listLabTests } from "~/lib/api/lab";
import { requireStaffAction } from "~/lib/auth.server";
import type { LabTest } from "~/models/lab";
import type { Route } from "./+types/resource-lab-tests";

/** What `fetcher.data` carries. */
export type LabTestLookupData = {
  tests: LabTest[];
};

/** Enough to browse without scrolling forever. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function loader({ request }: Route.LoaderArgs) {
  // The action gate, deliberately: it refreshes a stale token in place where
  // `requireStaff` would redirect mid-keystroke.
  const { accessToken, setCookie } = await requireStaffAction(request);

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || undefined;
  const requested = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(requested)
    ? Math.min(Math.max(requested, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const headers = new Headers({ "cache-control": "no-store" });
  if (setCookie) headers.append("Set-Cookie", setCookie);

  const tests = await listLabTests({ q, limit }, { token: accessToken });

  return Response.json({ tests } satisfies LabTestLookupData, { headers });
}
