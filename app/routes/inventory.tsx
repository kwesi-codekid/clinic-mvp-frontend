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
import { Card } from "~/components/ui/card";
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

/**
 * The stock take, as one strip: held minus expired is what the shelves are
 * actually worth. The three figures sit side by side so the subtraction reads
 * without being spelled out — a valuation that folds expired stock into the
 * total overstates what the clinic has.
 */
function Valuation({ valuation }: { valuation: StockValuation }) {
  const expired = valuation.expiredPesewas > 0;
  // Integer pesewas minus integer pesewas — no float maths on money.
  const usableFormatted = formatPesewas(valuation.totalPesewas - valuation.expiredPesewas);

  const cells = [
    {
      label: "Held at cost",
      figure: valuation.totalFormatted,
      tone: "",
      note: `Across ${valuation.batches} ${valuation.batches === 1 ? "batch" : "batches"}.`,
    },
    {
      label: "Of that, expired",
      figure: valuation.expiredFormatted,
      tone: expired ? "text-destructive" : "text-muted-foreground",
      note: expired
        ? "Already a write-off. It is stock on a shelf, not stock the clinic has."
        : "Nothing on the shelves has expired.",
    },
    {
      label: "Usable at cost",
      figure: usableFormatted,
      tone: "",
      note: "What the shelves are actually worth.",
    },
  ];

  return (
    <Card className="grid gap-0 divide-y overflow-hidden py-0 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {cells.map((cell) => (
        <div key={cell.label} className="space-y-1 px-5 py-4">
          <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            {cell.label}
          </p>
          <p
            className={cn(
              "font-mono text-2xl font-semibold tracking-tight tabular-nums",
              cell.tone,
            )}
          >
            {cell.figure}
          </p>
          <p className="text-xs text-muted-foreground">{cell.note}</p>
        </div>
      ))}
    </Card>
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
            <TableCell className="px-4 py-2.5 font-mono text-sm tabular-nums">
              {product.reorderLevel}
              {product.belowReorderLevel && (
                <div className="font-sans">
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
            <TableCell className="px-4 py-2.5 font-mono text-sm tabular-nums">
              <span className={cn(item.onHand <= 0 && "font-medium text-destructive")}>
                {item.onHand}
                <span className="font-sans text-xs text-muted-foreground"> {item.unitOfIssue}</span>
              </span>
            </TableCell>
            <TableCell className="px-4 py-2.5 font-mono text-sm tabular-nums">
              {item.reorderLevel}
            </TableCell>
            <TableCell className="px-4 py-2.5 font-mono text-sm font-medium tabular-nums">
              {Math.max(item.reorderLevel - item.onHand, 0)}
              <span className="font-sans text-xs font-normal text-muted-foreground">
                {" "}
                {item.unitOfIssue}
              </span>
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
              <span className="font-mono text-xs font-medium">{batch.batchNumber}</span>
              <div className="text-xs text-muted-foreground">
                <span className="font-mono tabular-nums">{batch.quantityRemaining}</span> left
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
            <TableCell className="px-4 py-2.5 font-mono text-sm font-medium tabular-nums">
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            What the store holds, what needs buying, and what expires before it can be used.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <Link
            to="/inventory/receive"
            className={buttonVariants({ variant: "default", size: "sm" })}
          >
            <PackagePlusIcon />
            Receive a delivery
          </Link>
        </div>
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
