/**
 * The charge-item picker (T8.1) — what anyone raising a manual charge, or
 * setting a tariff, chooses a billable item from.
 *
 * Searching runs on the server through `/resources/charge-items`, and like the
 * product picker it **browses**: opening it with nothing typed shows the
 * catalogue, because a clinic bills from a few dozen lines and "General
 * consultation" is picked far more often than it is typed.
 *
 * Every row carries the cash price and the item's NHIS standing, which is the
 * moment that information matters: `isOnNhisList: false` on an NHIS patient is
 * the usual co-payment trigger, and the person choosing should see it before
 * the patient is committed — the paired quote widget then puts a number on it.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronsUpDownIcon, ReceiptTextIcon } from "lucide-react";
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
import { ChargeCategories, type ChargeCategory } from "~/models/enums";
import type { ChargeItem } from "~/models/billing";
import type { ChargeItemLookupData } from "~/routes/resource-charge-items";

/** The facts worth knowing at the moment of choosing. */
function ChargeItemFacts({ item }: { item: ChargeItem }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs text-muted-foreground">
      <span className="font-mono">{item.code}</span>
      <span>· {ChargeCategories.label(item.category)}</span>
      <span className="font-medium text-foreground tabular-nums">{item.basePriceFormatted}</span>
      {item.unit && <span>per {item.unit}</span>}
      {item.isOnNhisList ? (
        <span>NHIS</span>
      ) : (
        <span className="font-medium text-amber-700 dark:text-amber-400">Not on NHIS list</span>
      )}
    </div>
  );
}

export function ChargeItemPicker({
  value,
  onPick,
  disabled,
  placeholder = "Choose an item",
  category,
  /** Emits a hidden input carrying the chosen item's id. */
  name,
  id,
}: {
  value: ChargeItem | null;
  onPick: (item: ChargeItem) => void;
  disabled?: boolean;
  placeholder?: string;
  category?: ChargeCategory;
  name?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const lookup = useFetcher<ChargeItemLookupData>();

  const load = useRef(lookup.load);
  load.current = lookup.load;

  // Opening browses the catalogue; typing narrows it server-side.
  useEffect(() => {
    if (!open) return;
    const query = term.trim();
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (category) params.set("category", category);

    const timer = setTimeout(
      () => {
        const search = params.toString();
        load.current(`/resources/charge-items${search ? `?${search}` : ""}`);
      },
      query ? 250 : 0,
    );
    return () => clearTimeout(timer);
  }, [open, term, category]);

  const items = lookup.data?.chargeItems ?? [];
  const searching = lookup.state !== "idle";

  return (
    <>
      {name && <input type="hidden" name={name} value={value?.id ?? ""} />}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              id={id}
              variant="outline"
              disabled={disabled}
              className="w-full justify-between font-normal"
            >
              <span className="min-w-0 truncate">
                {value ? (
                  value.name
                ) : (
                  <span className="text-muted-foreground">{placeholder}</span>
                )}
              </span>
              <ChevronsUpDownIcon className="text-muted-foreground" />
            </Button>
          }
        />
        <PopoverContent className="w-(--anchor-width) min-w-96 p-0" align="start">
          {/* The API does the matching — cmdk must not filter the results again. */}
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Consultation, dressing, ward night..."
              value={term}
              onValueChange={setTerm}
            />
            <CommandList>
              {searching && items.length === 0 ? (
                <CommandEmpty>Loading the catalogue…</CommandEmpty>
              ) : items.length === 0 ? (
                <CommandEmpty>
                  {term.trim()
                    ? `Nothing billable matches “${term.trim()}”.`
                    : "The charge catalogue is empty."}
                </CommandEmpty>
              ) : (
                <CommandGroup>
                  {items.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      onSelect={() => {
                        onPick(item);
                        setTerm("");
                        setOpen(false);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <ReceiptTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm">{item.name}</span>
                        </div>
                        <ChargeItemFacts item={item} />
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}
