/**
 * The product picker (T7.1) — what a prescriber, a substituting pharmacist and
 * a storekeeper receiving a delivery all choose a drug from.
 *
 * Searching runs on the server through `/resources/products`, and like the lab
 * test picker it **browses**: opening it with nothing typed shows the shelf.
 *
 * Every row carries the live stock level, which is the reason this is one
 * component rather than three. Choosing a drug is the moment to learn there
 * are none left — after the patient has walked to the counter is too late, and
 * a picker that hid it would make that failure the counter's problem.
 *
 * `Product.label` is the API's pre-composed "generic, strength, brand" string.
 * It is rendered as-is, everywhere, so no two screens can disagree about what
 * the same drug is called.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronsUpDownIcon, PillIcon, ShieldAlertIcon } from "lucide-react";
import { useFetcher } from "react-router";

import { StockLevel } from "~/components/dispensing";
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
import { DosageForms, ProductCategories, type ProductCategory } from "~/models/enums";
import type { Product } from "~/models/inventory";
import type { ProductLookupData } from "~/routes/resource-products";

/** The facts worth knowing at the moment of choosing. */
function ProductFacts({ product }: { product: Product }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs text-muted-foreground">
      <span>{DosageForms.labelOr(product.dosageForm)}</span>
      {product.category !== "drug" && <span>· {ProductCategories.label(product.category)}</span>}
      <StockLevel stockOnHand={product.stockOnHand} unitOfIssue={product.unitOfIssue} />
      {product.belowReorderLevel && (
        <span className="font-medium text-amber-700 dark:text-amber-400">Below reorder</span>
      )}
      {product.isControlled && (
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          <ShieldAlertIcon className="size-3" aria-hidden />
          Controlled
        </span>
      )}
      {product.isOnNhisList && <span>NHIS</span>}
    </div>
  );
}

export function ProductPicker({
  value,
  onPick,
  disabled,
  placeholder = "Choose a product",
  category,
  /** Products already chosen elsewhere on the form, shown as unavailable. */
  exclude,
  /** Emits a hidden input carrying the chosen product's id. */
  name,
  id,
}: {
  value: Product | null;
  onPick: (product: Product) => void;
  disabled?: boolean;
  placeholder?: string;
  category?: ProductCategory;
  exclude?: ReadonlySet<string>;
  name?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const lookup = useFetcher<ProductLookupData>();

  const load = useRef(lookup.load);
  load.current = lookup.load;

  // Opening browses the shelf; typing narrows it server-side.
  useEffect(() => {
    if (!open) return;
    const query = term.trim();
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (category) params.set("category", category);

    const timer = setTimeout(
      () => {
        const search = params.toString();
        load.current(`/resources/products${search ? `?${search}` : ""}`);
      },
      query ? 250 : 0,
    );
    return () => clearTimeout(timer);
  }, [open, term, category]);

  const products = lookup.data?.products ?? [];
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
                  value.label
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
              placeholder="Paracetamol, amoxicillin, gloves..."
              value={term}
              onValueChange={setTerm}
            />
            <CommandList>
              {searching && products.length === 0 ? (
                <CommandEmpty>Loading the shelf…</CommandEmpty>
              ) : products.length === 0 ? (
                <CommandEmpty>
                  {term.trim()
                    ? `Nothing on the shelf matches “${term.trim()}”.`
                    : "The store holds no products yet."}
                </CommandEmpty>
              ) : (
                <CommandGroup>
                  {products.map((product) => (
                    <CommandItem
                      key={product.id}
                      value={product.id}
                      disabled={!product.active || exclude?.has(product.id)}
                      onSelect={() => {
                        onPick(product);
                        setTerm("");
                        setOpen(false);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <PillIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm">{product.label}</span>
                        </div>
                        <ProductFacts product={product} />
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
