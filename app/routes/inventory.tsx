/**
 * The store (T7.3) — `/inventory`.
 *
 * One screen answering the three questions a storekeeper opens the system to
 * ask, as tabs: what do we hold, what must be bought, and what is about to be
 * thrown away. The valuation sits above all three because it is the number the
 * owner asks about, and it is split — total held, and how much of that has
 * already expired. A valuation that folds expired stock into the total
 * overstates what the clinic actually has.
 *
 * Every filter is a URL search param, so a view is shareable and SSR-rendered
 * and the back button works — the same shape as the patient and staff
 * directories.
 *
 * The writes live elsewhere on purpose: receiving is a form of its own
 * (`/inventory/receive`), adjusting hangs off a batch on the product page, and
 * the ledger is read-only wherever it appears.
 */

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
  BoxesIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleDollarSignIcon,
  PackagePlusIcon,
  ScrollTextIcon,
  SearchIcon,
  ShieldAlertIcon,
  TrendingDownIcon,
  TruckIcon,
} from "lucide-react";
import { Link, useNavigation, useSearchParams } from "react-router";

import { PagerLink, StatusPill } from "~/components/directory";
import { StockLevel } from "~/components/dispensing";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { getExpiringBatches, getLowStock, getStockValuation, listProducts } from "~/lib/api/inventory";
import { throwRouteError } from "~/lib/api/route-error";
import { requireStaff } from "~/lib/auth.server";
import { formatPesewas } from "~/lib/money";
import { cn } from "~/lib/utils";
import { DosageForms, ProductCategories } from "~/models/enums";
import {
  compareLowStock,
  expiryTone,
  formatExpiry,
  type ExpiringBatch,
  type LowStockItem,
  type Product,
  type StockValuation,
} from "~/models/inventory";

import type { Route } from "./+types/inventory";

export function meta() {
  return [{ title: "Inventory · Clinic" }];
}

const PAGE_SIZE = 15;

/** The horizon the expiring report asks for. The API defaults to 90 days. */
const EXPIRY_HORIZON_DAYS = 90;

const TABS = ["stock", "low", "expiring"] as const;
type InventoryTab = (typeof TABS)[number];

function parseTab(value: string | null): InventoryTab {
  return TABS.find((tab) => tab === value) ?? "stock";
}

/* -------------------------------------------------------------------------
   Loader
   ------------------------------------------------------------------------- */

export async function loader({ request }: Route.LoaderArgs) {
  const { accessToken } = await requireStaff(request);
  const url = new URL(request.url);
  const opts = { token: accessToken };

  const q = url.searchParams.get("q")?.trim() || undefined;
  const rawCategory = url.searchParams.get("category");
  const category = ProductCategories.is(rawCategory) ? rawCategory : undefined;
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page")) || 1));
  const tab = parseTab(url.searchParams.get("tab"));

  try {
    const [products, lowStock, expiring, valuation] = await Promise.all([
      listProducts({ q, category, page, limit: PAGE_SIZE }, opts),
      getLowStock(opts),
      getExpiringBatches({ withinDays: EXPIRY_HORIZON_DAYS }, opts),
      getStockValuation(opts),
    ]);

    return {
      products: products.items,
      meta: products.meta,
      // Emptiest shelves first: this is a buying list, not an index.
      lowStock: [...lowStock].sort(compareLowStock),
      expiring,
      valuation,
      filters: { q: q ?? "", category: category ?? "", tab },
    };
  } catch (error) {
    throwRouteError(error);
  }
}

/* -------------------------------------------------------------------------
   Valuation
   ------------------------------------------------------------------------- */

function Valuation({ valuation }: { valuation: StockValuation }) {
  const expired = valuation.expiredPesewas > 0;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card size="sm" className="gap-2">
        <CardHeader>
          <CardDescription>Held at cost</CardDescription>
          <CardTitle className="font-heading text-3xl font-semibold tracking-tight tabular-nums">
            {valuation.totalFormatted}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          Across {valuation.batches} {valuation.batches === 1 ? "batch" : "batches"}.
        </CardContent>
      </Card>

      <Card size="sm" className="gap-2">
        <CardHeader>
          <CardDescription>Of that, expired</CardDescription>
          <CardTitle
            className={cn(
              "font-heading text-3xl font-semibold tracking-tight tabular-nums",
              expired && "text-destructive",
            )}
          >
            {valuation.expiredFormatted}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          {expired
            ? "Already a write-off. It is stock on the shelf, not stock the clinic has."
            : "Nothing on the shelves has expired."}
        </CardContent>
      </Card>

      <Card size="sm" className="justify-center gap-2">
        <CardContent className="flex flex-col gap-2">
          <Link
            to="/inventory/receive"
            className={buttonVariants({ variant: "default", size: "sm" })}
          >
            <PackagePlusIcon />
            Receive a delivery
          </Link>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/inventory/movements"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <ScrollTextIcon />
              Stock ledger
            </Link>
            <Link
              to="/inventory/suppliers"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <TruckIcon />
              Suppliers
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------
   Tables
   ------------------------------------------------------------------------- */

const HEAD =
  "h-10 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase";

function ProductsTable({ products }: { products: readonly Product[] }) {
  if (products.length === 0) {
    return (
      <p className="px-3 py-10 text-center text-sm text-muted-foreground">
        <BoxesIcon className="mx-auto mb-2 size-6" strokeWidth={1.5} />
        Nothing on the shelf matches.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={HEAD}>Product</TableHead>
          <TableHead className={HEAD}>Form</TableHead>
          <TableHead className={HEAD}>On hand</TableHead>
          <TableHead className={HEAD}>Reorder at</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((product) => (
          <TableRow key={product.id}>
            <TableCell className="px-4 py-2.5">
              <Link
                to={`/inventory/products/${product.id}`}
                className="text-sm font-medium hover:underline"
              >
                {/* The API's pre-composed display string — never rejoined here. */}
                {product.label}
              </Link>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{product.code}</span>
                {product.isControlled && (
                  <span className="inline-flex items-center gap-1 font-medium text-foreground">
                    <ShieldAlertIcon className="size-3" aria-hidden />
                    Controlled
                  </span>
                )}
                {product.isOnNhisList && <span>NHIS</span>}
                {!product.active && <span>Inactive</span>}
              </div>
            </TableCell>
            <TableCell className="px-4 py-2.5 text-sm">
              {DosageForms.labelOr(product.dosageForm)}
              <div className="text-xs text-muted-foreground">
                {ProductCategories.label(product.category)} · per {product.unitOfIssue}
              </div>
            </TableCell>
            <TableCell className="px-4 py-2.5">
              <StockLevel
                stockOnHand={product.stockOnHand}
                unitOfIssue={product.unitOfIssue}
              />
            </TableCell>
            <TableCell className="px-4 py-2.5 text-sm tabular-nums">
              {product.reorderLevel}
              {product.belowReorderLevel && (
                <div>
                  <StatusPill tone="warning">Below reorder</StatusPill>
                </div>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function LowStockTable({ items }: { items: readonly LowStockItem[] }) {
  if (items.length === 0) {
    return (
      <p className="px-3 py-10 text-center text-sm text-muted-foreground">
        <TrendingDownIcon className="mx-auto mb-2 size-6" strokeWidth={1.5} />
        Nothing is at or below its reorder level.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={HEAD}>Product</TableHead>
          <TableHead className={HEAD}>On hand</TableHead>
          <TableHead className={HEAD}>Reorder level</TableHead>
          <TableHead className={HEAD}>Short by</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.productId}>
            <TableCell className="px-4 py-2.5">
              <Link
                to={`/inventory/products/${item.productId}`}
                className="text-sm font-medium hover:underline"
              >
                {item.name}
              </Link>
            </TableCell>
            <TableCell className="px-4 py-2.5 text-sm tabular-nums">
              <span className={cn(item.onHand <= 0 && "font-medium text-destructive")}>
                {item.onHand} {item.unitOfIssue}
              </span>
            </TableCell>
            <TableCell className="px-4 py-2.5 text-sm tabular-nums">
              {item.reorderLevel}
            </TableCell>
            <TableCell className="px-4 py-2.5 text-sm tabular-nums">
              {Math.max(item.reorderLevel - item.onHand, 0)} {item.unitOfIssue}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ExpiringTable({ batches }: { batches: readonly ExpiringBatch[] }) {
  if (batches.length === 0) {
    return (
      <p className="px-3 py-10 text-center text-sm text-muted-foreground">
        <CircleDollarSignIcon className="mx-auto mb-2 size-6" strokeWidth={1.5} />
        Nothing expires inside {EXPIRY_HORIZON_DAYS} days.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={HEAD}>Product</TableHead>
          <TableHead className={HEAD}>Batch</TableHead>
          <TableHead className={HEAD}>Expires</TableHead>
          <TableHead className={HEAD}>At stake</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {batches.map((batch) => (
          <TableRow key={batch.id}>
            <TableCell className="px-4 py-2.5 text-sm">{batch.productName}</TableCell>
            <TableCell className="px-4 py-2.5">
              <span className="font-mono text-xs">{batch.batchNumber}</span>
              <div className="text-xs text-muted-foreground tabular-nums">
                {batch.quantityRemaining} left
              </div>
            </TableCell>
            <TableCell className="px-4 py-2.5 text-sm" suppressHydrationWarning>
              {format(new Date(batch.expiryDate), "d MMM yyyy")}
              <div>
                <StatusPill tone={expiryTone(batch.daysToExpiry)}>
                  {formatExpiry(batch.daysToExpiry)}
                </StatusPill>
              </div>
            </TableCell>
            <TableCell className="px-4 py-2.5 text-sm tabular-nums">
              {formatPesewas(batch.valueAtCostPesewas)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

const CATEGORY_TABS = [
  { value: "", label: "All" },
  ...ProductCategories.options().map((option) => ({
    value: option.value as string,
    label: option.label,
  })),
];

export default function InventoryPage({ loaderData }: Route.ComponentProps) {
  const { products, meta, lowStock, expiring, valuation, filters } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const searching = navigation.state === "loading";

  const [term, setTerm] = useState(filters.q);
  const first = useRef(true);

  // Debounced, and never on the first render — typing should not push a
  // history entry per keystroke, and mounting should not replace the URL.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (term.trim()) next.set("q", term.trim());
          else next.delete("q");
          next.delete("page");
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [term, setSearchParams]);

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    setSearchParams(next, { preventScrollReset: true });
  };

  const pageHref = (page: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(page));
    return `?${next}`;
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Inventory</h1>
        <p className="text-sm text-muted-foreground">
          What the store holds, what needs buying, and what expires before it can be used.
        </p>
      </div>

      <Valuation valuation={valuation} />

      <Tabs value={filters.tab} onValueChange={(value) => update({ tab: String(value) })}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="stock">Stock</TabsTrigger>
            <TabsTrigger value="low">
              Low stock
              {lowStock.length > 0 && (
                <span className="ml-1.5 tabular-nums text-muted-foreground">
                  {lowStock.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="expiring">
              Expiring
              {expiring.length > 0 && (
                <span className="ml-1.5 tabular-nums text-muted-foreground">
                  {expiring.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="stock" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-sm">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Search the shelf"
                aria-label="Search products"
                className="h-9 pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_TABS.map((category) => (
                <button
                  key={category.value || "all"}
                  type="button"
                  onClick={() => update({ category: category.value })}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    filters.category === category.value
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {category.label}
                </button>
              ))}
            </div>
            {searching && (
              <span className="text-xs text-muted-foreground">Searching…</span>
            )}
          </div>

          <Card className="gap-0 overflow-hidden py-0">
            <ProductsTable products={products} />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
              <span className="tabular-nums">
                {meta.total} {meta.total === 1 ? "product" : "products"}
              </span>
              <div className="flex items-center gap-3">
                <span className="tabular-nums">
                  Page {meta.page} of {Math.max(meta.totalPages, 1)}
                </span>
                <div className="flex items-center gap-1.5">
                  <PagerLink
                    to={pageHref(meta.page - 1)}
                    disabled={meta.page <= 1}
                    label="Previous page"
                  >
                    <ChevronLeftIcon />
                  </PagerLink>
                  <PagerLink
                    to={pageHref(meta.page + 1)}
                    disabled={meta.page >= meta.totalPages}
                    label="Next page"
                  >
                    <ChevronRightIcon />
                  </PagerLink>
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="low">
          <Card className="gap-0 overflow-hidden py-0">
            <LowStockTable items={lowStock} />
          </Card>
          <p className="pt-2 text-xs text-muted-foreground">
            Emptiest shelves first. An item closed as out of stock at the counter lands here.
          </p>
        </TabsContent>

        <TabsContent value="expiring">
          <Card className="gap-0 overflow-hidden py-0">
            <ExpiringTable batches={expiring} />
          </Card>
          <p className="pt-2 text-xs text-muted-foreground">
            Batches expiring inside {EXPIRY_HORIZON_DAYS} days. Dispensing takes the
            earliest-expiring batch first, so moving these is a matter of using them before
            they lapse — write off what cannot be.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
