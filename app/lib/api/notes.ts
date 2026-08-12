/**
 * Clinical note similarity search — `POST /analytics/notes/*` (T5.3).
 *
 * These moved out of the Consultations tag and now sit under Analytics, but
 * they belong to the consulting room: "who else presented like this, and what
 * did it turn out to be?" They live in their own module rather than in
 * `analytics.ts` because nothing else in Phase 13 shares their audience.
 *
 * Both degrade rather than fail. The index is optional infrastructure — every
 * caller has to handle `available: false` as a normal answer.
 */

import type { NoteIndexResult, NoteSearchResult } from "~/models/consultation";
import { request, type RequestOptions } from "./client";

/** The API rejects anything shorter, so the caller should not bother sending it. */
export const NOTE_SEARCH_MIN_LENGTH = 3;

/**
 * Find patients who presented similarly.
 *
 * Semantic when the AI provider serves embeddings, falling back to plain text
 * matching otherwise — the result says which ran, and the two are not
 * comparable, so the panel must show it.
 *
 * Returns `available: false` when the index has not been built. That is a state
 * to render, not an error to throw.
 *
 * Requires the doctor, physician_assistant, midwife or admin role.
 */
export function searchNotes(
  input: { query: string; limit?: number },
  options: RequestOptions,
): Promise<NoteSearchResult> {
  return request<NoteSearchResult>("/analytics/notes/search", {
    ...options,
    method: "POST",
    body: input,
  });
}

/**
 * Embed clinical notes so {@link searchNotes} can answer semantically.
 *
 * Runs in batches: `remaining > 0` means call it again. Admin only, and slow —
 * an operations action, not something a consultation screen triggers.
 */
export function indexNotes(
  input: { limit?: number } = {},
  options: RequestOptions,
): Promise<NoteIndexResult> {
  return request<NoteIndexResult>("/analytics/notes/index", {
    ...options,
    method: "POST",
    body: input,
  });
}
