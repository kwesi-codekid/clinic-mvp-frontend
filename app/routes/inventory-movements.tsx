/**
 * The stock ledger (T7.3) — `/inventory/movements`.
 *
 * Every movement, newest first, optionally narrowed to one product. It exists
 * to answer "how did we get to this number", which a stock level alone cannot:
 * a balance of four is a different conversation depending on whether six were
 * dispensed or two were written off.
 *
 * **Read-only, deliberately.** There is no edit and no delete on any line —
 * the API offers neither, and the ledger would be worthless if it did. Stock
 * is corrected by adjusting a batch, which appends another line.
 *
 * A movement carries only a product id, so the loader fetches a page of the
 * catalogue to put names on the lines. Anything the catalogue page did not
 * cover renders as a link rather than a guessed name — see {@link StockLedger}.
 */

import { ChevronLeftIcon, ChevronRightIcon, ScrollTextIcon } from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { PagerLink } from "~/components/directory";
import { PageHeader } from "~/components/page-header";
import { StockLedger } from "~/components/stock-ledger";
import { buttonVariants } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { listMovements, listProducts, getProduct } from "~/lib/api/inventory";
import { throwRouteError } from "~/lib/api/route-error";
import { requireStaff } from "~/lib/auth.server";
import { parseObjectId } from "~/models/primitives";

import type { Route } from "./+types/inventory-movements";

export function meta() {
  return [{ title: "Stock ledger · Clinic" }];
}

const PAGE_SIZE = 25;

/** The API's own ceiling on a catalogue page — enough to name most lines. */
const LABEL_LIMIT = 200;

export async function loader({ request }: Route.LoaderArgs) {
  const { accessToken } = await requireStaff(request);
  const url = new URL(request.url);
  const opts = { token: accessToken };

  const rawProductId = url.searchParams.get("productId");
  const productId = rawProductId ? parseObjectId(rawProductId, "product id") : undefined;
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page")) || 1));

  try {
    const [movements, product, catalogue] = await Promise.all([
      listMovements({ productId, page, limit: PAGE_SIZE }, opts),
      productId ? getProduct(productId, opts) : Promise.resolve(null),
      // Only needed for the unfiltered view — one product's ledger is already
      // headed by that product's name.
      productId
        ? Promise.resolve(null)
        : listProducts({ limit: LABEL_LIMIT }, opts).then((result) => result.items),
    ]);

    const productLabels: Record<string, string> = {};
    for (const entry of catalogue ?? []) productLabels[entry.id] = entry.label;

    return {
      movements: movements.items,
      meta: movements.meta,
      product,
      productLabels: productId ? undefined : productLabels,
    };
  } catch (error) {
    throwRouteError(error);
  }
}

export default function InventoryMovementsPage({ loaderData }: Route.ComponentProps) {
  const { movements, meta, product, productLabels } = loaderData;
  const [searchParams] = useSearchParams();

  const pageHref = (page: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(page));
    return `?${next}`;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={product ? `Ledger · ${product.label}` : "Stock ledger"}
        description="Append-only. Quantities are signed — negative for anything leaving the store — and the balance is the running total."
        backTo={product ? `/inventory/products/${product.id}` : "/inventory"}
        backLabel={product ? "Back to the product" : "Back to inventory"}
      >
        {product && (
          <Link
            to="/inventory/movements"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ScrollTextIcon />
            Every product
          </Link>
        )}
      </PageHeader>

      <Card className="gap-0 overflow-hidden py-0">
        <StockLedger
          movements={movements}
          unitOfIssue={product?.unitOfIssue}
          productLabels={productLabels}
          emptyText={
            product
              ? "Nothing has moved for this product yet."
              : "No stock has moved yet — receiving a delivery writes the first line."
          }
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {meta.total} {meta.total === 1 ? "movement" : "movements"}
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
    </div>
  );
}
