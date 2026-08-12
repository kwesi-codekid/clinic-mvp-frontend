/**
 * The lab test picker (T6.2) — what a clinician orders from.
 *
 * Searching runs on the server through `/resources/lab-tests`, but unlike the
 * ICD-10 picker it **browses**: opening the popover with nothing typed shows
 * the catalogue, because a clinic offers a few dozen tests and the common
 * order is picked, not typed. Each entry shows its specimen and turnaround
 * target at the moment of choosing — "this needs a urine sample and takes an
 * hour" is information the clinician owes the patient before ordering.
 *
 * Ordering bills (`POST /lab/orders` raises the charges in the same call), so
 * the chosen list says so — what is run is what is billed.
 */

import { useEffect, useRef, useState } from "react";
import { CheckIcon, ClockIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { useFetcher } from "react-router";

import { Button } from "~/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { SpecimenBadge } from "~/components/lab-results";
import { formatMinutes } from "~/models/visit";
import type { LabTest } from "~/models/lab";
import type { LabTestLookupData } from "~/routes/resource-lab-tests";

/* -------------------------------------------------------------------------
   Search
   ------------------------------------------------------------------------- */

function LabTestSearch({
  onPick,
  disabled,
  chosen,
}: {
  onPick: (test: LabTest) => void;
  disabled?: boolean;
  chosen: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const lookup = useFetcher<LabTestLookupData>();

  const load = useRef(lookup.load);
  load.current = lookup.load;

  // Opening browses the catalogue; typing narrows it server-side.
  useEffect(() => {
    if (!open) return;
    const query = term.trim();
    const timer = setTimeout(
      () => {
        load.current(
          query
            ? `/resources/lab-tests?q=${encodeURIComponent(query)}`
            : "/resources/lab-tests",
        );
      },
      query ? 250 : 0,
    );
    return () => clearTimeout(timer);
  }, [open, term]);

  const tests = lookup.data?.tests ?? [];
  const searching = lookup.state !== "idle";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" disabled={disabled}>
            <PlusIcon />
            Add a test
          </Button>
        }
      />
      <PopoverContent className="w-(--anchor-width) min-w-96 p-0" align="start">
        {/* The API does the matching — cmdk must not filter the results again. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="FBC, malaria, urine..."
            value={term}
            onValueChange={setTerm}
          />
          <CommandList>
            {searching && tests.length === 0 ? (
              <CommandEmpty>Loading the catalogue…</CommandEmpty>
            ) : tests.length === 0 ? (
              <CommandEmpty>
                {term.trim()
                  ? `No test matches “${term.trim()}”.`
                  : "The laboratory offers no tests yet."}
              </CommandEmpty>
            ) : (
              <CommandGroup>
                {tests.map((test) => {
                  const already = chosen.has(test.id);
                  return (
                    <CommandItem
                      key={test.id}
                      value={test.id}
                      disabled={already || !test.active}
                      onSelect={() => {
                        onPick(test);
                        setTerm("");
                        setOpen(false);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold">{test.code}</span>
                          <span className="truncate text-sm">{test.name}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs text-muted-foreground">
                          <span>{test.category}</span>
                          <SpecimenBadge type={test.specimenType} />
                          <span className="inline-flex items-center gap-1">
                            <ClockIcon className="size-3" />
                            {formatMinutes(test.turnaroundTargetMinutes)}
                          </span>
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

export function LabTestPicker({
  value,
  onChange,
  disabled,
}: {
  value: LabTest[];
  onChange: (next: LabTest[]) => void;
  disabled?: boolean;
}) {
  const chosen = new Set<string>(value.map((test) => test.id));

  const add = (test: LabTest) => {
    if (chosen.has(test.id)) return;
    onChange([...value, test]);
  };

  const remove = (id: string) => {
    onChange(value.filter((test) => test.id !== id));
  };

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          No tests chosen yet. Ordering raises the charges for them — what is run is what is
          billed.
        </p>
      ) : (
        <ul className="space-y-2">
          {value.map((test) => (
            <li
              key={test.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold">{test.code}</span>
                  <span className="text-sm font-medium">{test.name}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{test.category}</span>
                  <SpecimenBadge type={test.specimenType} />
                  <span className="inline-flex items-center gap-1">
                    <ClockIcon className="size-3" />
                    Target {formatMinutes(test.turnaroundTargetMinutes)}
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(test.id)}
                disabled={disabled}
                aria-label={`Remove ${test.name}`}
              >
                <XIcon />
              </Button>

              <input type="hidden" name="testId" value={test.id} />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <LabTestSearch onPick={add} disabled={disabled} chosen={chosen} />
        <span className="text-xs text-muted-foreground">
          <SearchIcon className="mr-1 inline size-3" />
          Searches the laboratory's own catalogue.
        </span>
      </div>
    </div>
  );
}
