/**
 * The ICD-10 diagnosis picker (T5.2).
 *
 * Searching runs on the server through `/resources/icd10` rather than against a
 * list shipped to the browser: the catalogue is the clinic's own subset, and it
 * is the API that decides which DHIMS2 line a code is tallied under and whether
 * the district must be notified. Those two facts ride along on every entry and
 * are shown at the moment of choosing — a notifiable diagnosis is worth knowing
 * about while the patient is still in the room, not when the monthly return is
 * assembled.
 *
 * Coding is deliberately a little effortful. Each diagnosis carries how settled
 * it is ({@link DiagnosisType}) and exactly one is primary, because Phase 10
 * claims against the primary and Phase 13 counts it.
 */

import { useEffect, useRef, useState } from "react";
import { CheckIcon, PlusIcon, SearchIcon, SirenIcon, XIcon } from "lucide-react";
import { useFetcher } from "react-router";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { RichTextEditor } from "~/components/ui/rich-text-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { isRichTextEmpty } from "~/lib/rich-text";
import { cn } from "~/lib/utils";
import { DiagnosisTypes, type DiagnosisType } from "~/models/enums";
import type { Diagnosis, DiagnosisInput, Icd10Entry } from "~/models/consultation";
import type { Icd10LookupData } from "~/routes/resource-icd10";

/**
 * A diagnosis while it is being edited.
 *
 * Carries the catalogue's `dhims2Group`/`notifiable` alongside the writable
 * fields so the row can explain itself without another lookup. Neither is sent
 * — the API resolves both from the code — which is why {@link toDiagnosisInput}
 * drops them.
 */
export type DiagnosisDraft = {
  icd10Code: string;
  description: string;
  type: DiagnosisType;
  isPrimary: boolean;
  notes?: string;
  dhims2Group?: string;
  notifiable?: boolean;
};

/** The write shape, with the catalogue-derived fields stripped. */
export function toDiagnosisInput(draft: DiagnosisDraft): DiagnosisInput {
  return {
    icd10Code: draft.icd10Code,
    description: draft.description,
    type: draft.type,
    isPrimary: draft.isPrimary,
    // An emptied editor still leaves `<p></p>` behind — markup with nothing in
    // it is not a note.
    notes: isRichTextEmpty(draft.notes) ? undefined : draft.notes,
  };
}

/** Seeds the editor from a note being amended. */
export function toDiagnosisDraft(diagnosis: Diagnosis): DiagnosisDraft {
  return {
    icd10Code: diagnosis.icd10Code,
    description: diagnosis.description,
    type: diagnosis.type,
    isPrimary: diagnosis.isPrimary,
    notes: diagnosis.notes,
    dhims2Group: diagnosis.dhims2Group,
    notifiable: diagnosis.notifiable,
  };
}

const TYPE_ITEMS = DiagnosisTypes.options();

/* -------------------------------------------------------------------------
   Search
   ------------------------------------------------------------------------- */

function Icd10Search({
  onPick,
  disabled,
  chosen,
}: {
  onPick: (entry: Icd10Entry) => void;
  disabled?: boolean;
  chosen: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const lookup = useFetcher<Icd10LookupData>();

  const load = useRef(lookup.load);
  load.current = lookup.load;

  useEffect(() => {
    const query = term.trim();
    if (query.length < 2) return;
    const timer = setTimeout(() => {
      load.current(`/resources/icd10?q=${encodeURIComponent(query)}`);
    }, 250);
    return () => clearTimeout(timer);
  }, [term]);

  const entries = term.trim().length < 2 ? [] : (lookup.data?.entries ?? []);
  const searching = lookup.state !== "idle";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" disabled={disabled}>
            <PlusIcon />
            Add a diagnosis
          </Button>
        }
      />
      <PopoverContent className="w-(--anchor-width) min-w-80 p-0" align="start">
        {/* The API does the matching — cmdk must not filter the results again. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Code or description — malaria, J18, hypertension..."
            value={term}
            onValueChange={setTerm}
          />
          <CommandList>
            {term.trim().length < 2 ? (
              <CommandEmpty>Type at least two characters.</CommandEmpty>
            ) : searching && entries.length === 0 ? (
              <CommandEmpty>Searching…</CommandEmpty>
            ) : entries.length === 0 ? (
              <CommandEmpty>Nothing in the catalogue matches “{term.trim()}”.</CommandEmpty>
            ) : (
              <CommandGroup>
                {entries.map((entry) => {
                  const already = chosen.has(entry.code);
                  return (
                    <CommandItem
                      key={entry.code}
                      value={entry.code}
                      disabled={already}
                      onSelect={() => {
                        onPick(entry);
                        setTerm("");
                        setOpen(false);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold">{entry.code}</span>
                          {entry.notifiable && (
                            <Badge variant="destructive" className="gap-1 px-1.5 py-0 text-[10px]">
                              <SirenIcon className="size-2.5" />
                              Notifiable
                            </Badge>
                          )}
                        </div>
                        <div className="truncate text-sm">{entry.description}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {entry.category}
                        </div>
                      </div>
                      {already && <CheckIcon className="size-4 text-muted-foreground" />}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------
   The picker
   ------------------------------------------------------------------------- */

export function Icd10Picker({
  value,
  onChange,
  disabled,
  error,
}: {
  value: DiagnosisDraft[];
  onChange: (next: DiagnosisDraft[]) => void;
  disabled?: boolean;
  error?: string;
}) {
  const chosen = new Set(value.map((draft) => draft.icd10Code));

  const add = (entry: Icd10Entry) => {
    if (chosen.has(entry.code)) return;
    onChange([
      ...value,
      {
        icd10Code: entry.code,
        description: entry.description,
        // Provisional until the clinician says otherwise — most codes written
        // in a consulting room are working diagnoses, not conclusions.
        type: "provisional",
        // The first one coded is the primary; changing it is a click.
        isPrimary: value.length === 0,
        dhims2Group: entry.dhims2Group,
        notifiable: entry.notifiable,
      },
    ]);
  };

  const update = (index: number, patch: Partial<DiagnosisDraft>) => {
    onChange(value.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  };

  const remove = (index: number) => {
    const next = value.filter((_, i) => i !== index);
    // Never leave a list with no primary: promote the first survivor.
    if (next.length > 0 && !next.some((draft) => draft.isPrimary)) {
      next[0] = { ...next[0], isPrimary: true };
    }
    onChange(next);
  };

  const setPrimary = (index: number) => {
    onChange(value.map((draft, i) => ({ ...draft, isPrimary: i === index })));
  };

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p
          className={cn(
            "rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground",
            error && "border-destructive/50 text-destructive",
          )}
        >
          No diagnosis coded yet. The claim and the DHIMS2 return are built from these.
        </p>
      ) : (
        <ul className="space-y-3">
          {value.map((draft, index) => (
            <li key={draft.icd10Code} className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{draft.icd10Code}</span>
                    {draft.isPrimary && <Badge variant="secondary">Primary</Badge>}
                    {draft.notifiable && (
                      <Badge variant="destructive" className="gap-1">
                        <SirenIcon className="size-3" />
                        Notifiable
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm font-medium">{draft.description}</p>
                  {draft.dhims2Group && (
                    <p className="text-xs text-muted-foreground">
                      Counted under {draft.dhims2Group} on the DHIMS2 return.
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(index)}
                  disabled={disabled}
                  aria-label={`Remove ${draft.description}`}
                >
                  <XIcon />
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`diagnosis-type-${index}`}>How settled</FieldLabel>
                  <Select
                    id={`diagnosis-type-${index}`}
                    value={draft.type}
                    onValueChange={(next) => update(index, { type: next as DiagnosisType })}
                    items={TYPE_ITEMS}
                    disabled={disabled}
                  >
                    <SelectTrigger className="h-8 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPE_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor={`diagnosis-notes-${index}`}>Note</FieldLabel>
                  {/* Unnamed: the row posts its own hidden field below, in the
                      parallel-list order the action reads. */}
                  <RichTextEditor
                    id={`diagnosis-notes-${index}`}
                    defaultValue={draft.notes}
                    onChange={(html) => update(index, { notes: html })}
                    placeholder="Optional detail"
                    minRows={2}
                    disabled={disabled}
                  />
                </Field>
              </div>

              {!draft.isPrimary && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPrimary(index)}
                  disabled={disabled || draft.type === "differential"}
                >
                  Make primary
                </Button>
              )}
              {!draft.isPrimary && draft.type === "differential" && (
                <FieldDescription>
                  A differential is one possibility among several — it cannot be the primary
                  diagnosis.
                </FieldDescription>
              )}

              {/* Posted as parallel lists, the same shape the patient and
                  check-in forms use for their repeating blocks. */}
              <input type="hidden" name="diagnosisCode" value={draft.icd10Code} />
              <input type="hidden" name="diagnosisDescription" value={draft.description} />
              <input type="hidden" name="diagnosisType" value={draft.type} />
              <input type="hidden" name="diagnosisNotes" value={draft.notes ?? ""} />
              {draft.isPrimary && <input type="hidden" name="primaryIndex" value={index} />}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Icd10Search onPick={add} disabled={disabled} chosen={chosen} />
        <span className="text-xs text-muted-foreground">
          <SearchIcon className="mr-1 inline size-3" />
          Searches the clinic's ICD-10 subset.
        </span>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
