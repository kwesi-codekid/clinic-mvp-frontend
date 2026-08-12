/**
 * "Who else presented like this?" (T5.3).
 *
 * The empty state was designed before the populated one, because it is the one
 * most clinics will see: `NoteSearchResult.available` is false until someone has
 * built the index, and a panel that answered that with a blank list would be
 * read as "nobody presented like this" — the opposite of the truth.
 *
 * The mode is always on screen for the same reason. A semantic search matches
 * meaning and finds the note that says *dysuria* from a query about burning
 * urine; the lexical fallback matches words and finds far less. A clinician
 * drawing a conclusion from an empty result deserves to know which of those
 * two just ran.
 *
 * Searching is explicit rather than live: this reads other patients' records,
 * and it should be something a clinician chose to do.
 */

import { useState } from "react";
import { format } from "date-fns";
import { Loader2Icon, SearchIcon, SparklesIcon, UsersRoundIcon } from "lucide-react";
import { Link, useFetcher } from "react-router";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { NOTE_SEARCH_MIN_LENGTH } from "~/lib/api/notes";
import { NoteSearchModes } from "~/models/enums";
import { richTextToPlain } from "~/lib/rich-text";
import type { NoteMatch } from "~/models/consultation";
import type { NoteSearchData } from "~/routes/resource-note-search";

function MatchRow({ match }: { match: NoteMatch }) {
  const codes = match.diagnoses
    .map((diagnosis) => diagnosis.description ?? diagnosis.icd10Code)
    .filter((label): label is string => Boolean(label));

  return (
    <li className="space-y-1.5 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to={`/patients/${match.patientId}`}
          className="text-sm font-medium hover:underline"
        >
          {match.patientName ?? "Patient"}
        </Link>
        <span className="text-xs text-muted-foreground" suppressHydrationWarning>
          {format(new Date(match.recordedAt), "d MMM yyyy")}
        </span>
      </div>

      {match.folderNumber && (
        <p className="font-mono text-xs text-muted-foreground">{match.folderNumber}</p>
      )}

      {/* A one-line preview, so the note's markup is flattened rather than
          rendered — a panel of headings and lists is not a summary. */}
      {match.presentingComplaint && (
        <p className="line-clamp-3 text-sm text-muted-foreground">
          {richTextToPlain(match.presentingComplaint)}
        </p>
      )}

      {codes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {codes.map((code, index) => (
            <Badge key={`${code}-${index}`} variant="outline">
              {code}
            </Badge>
          ))}
        </div>
      )}
    </li>
  );
}

export function SimilarNotes({ seed }: { seed?: string }) {
  const search = useFetcher<NoteSearchData>();
  const [term, setTerm] = useState(seed ?? "");

  const busy = search.state !== "idle";
  const data = search.data;
  const result = data?.result;
  const tooShort = term.trim().length < NOTE_SEARCH_MIN_LENGTH;

  const run = () => {
    if (tooShort) return;
    search.load(`/resources/note-search?q=${encodeURIComponent(term.trim())}`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UsersRoundIcon className="size-4 text-muted-foreground" />
          Similar presentations
        </CardTitle>
        <CardDescription>
          Past notes that read like this one. Nothing here is a diagnosis — it is other
          clinicians' reasoning on similar patients.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                run();
              }
            }}
            placeholder="Fever and joint pains for five days"
            aria-label="What to look for"
          />
          <Button type="button" variant="outline" onClick={run} disabled={busy || tooShort}>
            {busy ? <Loader2Icon className="animate-spin" /> : <SearchIcon />}
            Find
          </Button>
        </div>

        {/* Nothing searched yet. */}
        {!data && !busy && (
          <p className="text-sm text-muted-foreground">
            Search on the complaint or the findings — the index matches meaning, not just words.
          </p>
        )}

        {/* Too short, unavailable to this role, or the service is down. */}
        {data?.message && <p className="text-sm text-muted-foreground">{data.message}</p>}

        {result && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={result.mode === "semantic" ? "secondary" : "outline"} className="gap-1">
                {result.mode === "semantic" && <SparklesIcon className="size-3" />}
                {NoteSearchModes.labelOr(result.mode)}
              </Badge>
              <span>
                {result.searchedNotes.toLocaleString()}{" "}
                {result.searchedNotes === 1 ? "note" : "notes"} searched
              </span>
            </div>

            {/* The index has not been built — not the same as "no matches". */}
            {!result.available ? (
              <div className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Similar-note search is not set up yet.</p>
                <p>
                  {result.message ??
                    "An administrator needs to index the clinic's notes before this can answer."}
                </p>
              </div>
            ) : result.matches.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                No past note reads like this one
                {result.mode === "lexical" && ", though only word matching was available"}.
              </p>
            ) : (
              <ul className="space-y-2">
                {result.matches.map((match) => (
                  <MatchRow key={match.consultationId} match={match} />
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
