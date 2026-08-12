/**
 * `GET /resources/note-search` — "who else presented like this?" (T5.3).
 *
 * The API call underneath is a `POST`, but nothing is written, so this is
 * exposed as a `GET`: a fetcher `load()` neither revalidates the consultation
 * screen nor re-posts on a back button.
 *
 * Role-gated upstream to doctor / physician_assistant / midwife. A `403` here
 * means the signed-in staff member may not read other patients' notes, which
 * the panel renders as an absent feature rather than an error.
 */

import { ApiError } from "~/lib/api/client";
import { NOTE_SEARCH_MIN_LENGTH, searchNotes } from "~/lib/api/notes";
import { requireStaffAction } from "~/lib/auth.server";
import type { NoteSearchResult } from "~/models/consultation";

import type { Route } from "./+types/resource-note-search";

/**
 * What `fetcher.data` carries.
 *
 * `result` is absent when the query was too short or the search is not
 * available to this user — both normal states the panel renders as prose.
 */
export type NoteSearchData = {
  result?: NoteSearchResult;
  /** Set when there is nothing to show and the reason is worth saying. */
  message?: string;
};

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

export async function loader({ request }: Route.LoaderArgs) {
  const { accessToken, setCookie } = await requireStaffAction(request);

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const requested = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(requested)
    ? Math.min(Math.max(requested, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const headers = new Headers({ "cache-control": "no-store" });
  if (setCookie) headers.append("Set-Cookie", setCookie);

  const json = (body: NoteSearchData) => Response.json(body, { headers });

  if (query.length < NOTE_SEARCH_MIN_LENGTH) {
    return json({ message: "Write a little more of the complaint to search on." });
  }

  try {
    const result = await searchNotes({ query, limit }, { token: accessToken });
    return json({ result });
  } catch (error) {
    if (!ApiError.is(error)) throw error;

    // The index being unbuilt, unreachable or off-limits is not something to
    // interrupt a consultation with — the panel simply says why it is quiet.
    if (error.status === 403) {
      return json({ message: "Your role does not include reading other patients' notes." });
    }
    if (error.status === 404 || error.status >= 500 || error.isRetryable) {
      return json({ message: "Similar-note search is unavailable at the moment." });
    }

    throw error;
  }
}
