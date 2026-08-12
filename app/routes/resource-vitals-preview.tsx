/**
 * `GET /resources/vitals-preview` — flags a set of readings without saving them.
 *
 * The API call underneath is a `POST`, but it writes nothing; exposing it as a
 * `GET` keeps it out of the revalidation path so the nurse can be told "Fever"
 * on blur without the vitals screen reloading itself each time.
 *
 * `ageYears` is passed through deliberately. The preview has no visit, so the
 * API cannot look the patient up, and without an age it grades everything
 * against **adult** ranges — a child's pulse would come back unflagged. The
 * screen reads the age off the visit and sends it; if it is ever missing, the
 * response is still returned but the caller should treat it as adult-graded.
 */

import { previewVitalsForAge } from "~/lib/api/vitals";
import { requireStaffAction } from "~/lib/auth.server";
import { VITAL_BOUNDS, type VitalField, type VitalsPreview } from "~/models/vitals";

import type { Route } from "./+types/resource-vitals-preview";

/** What `fetcher.data` carries. */
export type VitalsPreviewData = {
  preview: VitalsPreview;
  /** False when no age was supplied, so the flags are adult ranges. */
  ageAware: boolean;
};

const EMPTY: VitalsPreview = { flags: [] };

/**
 * A reading from the query string, dropped unless it is a finite number inside
 * the API's accepted bounds — sending something outside them is a `400`, and a
 * half-typed "3" on the way to "37.5" is not worth one.
 */
function reading(params: URLSearchParams, field: VitalField): number | undefined {
  const raw = params.get(field);
  if (raw === null || raw.trim() === "") return undefined;

  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;

  const { min, max } = VITAL_BOUNDS[field];
  return value >= min && value <= max ? value : undefined;
}

export async function loader({ request }: Route.LoaderArgs) {
  const { accessToken, setCookie } = await requireStaffAction(request);

  const params = new URL(request.url).searchParams;
  const readings = Object.fromEntries(
    (Object.keys(VITAL_BOUNDS) as VitalField[])
      .map((field) => [field, reading(params, field)] as const)
      .filter(([, value]) => value !== undefined),
  ) as Partial<Record<VitalField, number>>;

  const rawAge = Number(params.get("ageYears"));
  const ageYears =
    Number.isInteger(rawAge) && rawAge >= 0 && rawAge <= 130 ? rawAge : undefined;

  const headers = new Headers({ "cache-control": "no-store" });
  if (setCookie) headers.append("Set-Cookie", setCookie);

  const json = (body: VitalsPreviewData) => Response.json(body, { headers });

  // Nothing legible to grade yet — don't spend a round trip on it.
  if (Object.keys(readings).length === 0) {
    return json({ preview: EMPTY, ageAware: ageYears !== undefined });
  }

  const preview = await previewVitalsForAge(readings, ageYears, { token: accessToken });

  return json({ preview, ageAware: ageYears !== undefined });
}
