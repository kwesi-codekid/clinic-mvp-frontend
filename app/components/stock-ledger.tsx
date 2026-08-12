/**
 * The stock ledger (T7.3), shared by the product page and `/inventory/movements`.
 *
 * The one rule this component exists to enforce: **quantities are signed.**
 * `StockMovement.quantity` is negative for anything leaving the store and
 * `balanceAfter` is the running total, so the quantity column renders with its
 * sign and its direction coloured. Printing the magnitude alone would turn a
 * write-off into a delivery.
 *
 * There is no edit affordance, here or anywhere: the ledger is append-only,
 * and a mistake is corrected by another movement rather than by rewriting one.
 * That is why a reason rides on the line — it is the only explanation the
 * record will ever carry.
 */

import { format } from "date-fns";
import { ArrowDownRightIcon, ArrowUpRightIcon } from "lucide-react";
import { Link } from "react-router";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { cn } from "~/lib/utils";
import { StockMovementTypes } from "~/models/enums";
import { formatSignedQuantity, isOutwardMovement, type StockMovement } from "~/models/inventory";

const HEAD =
  "h-10 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase";

export function StockLedger({
  movements,
  unitOfIssue,
  /** Product labels by id. Pass to render a product column. */
  productLabels,
  emptyText = "No movement recorded yet.",
}: {
  movements: readonly StockMovement[];
  unitOfIssue?: string;
  productLabels?: Record<string, string>;
  emptyText?: string;
}) {
  if (movements.length === 0) {
    return <p className="px-3 py-10 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={HEAD}>When</TableHead>
          {productLabels && <TableHead className={HEAD}>Product</TableHead>}
          <TableHead className={HEAD}>Cause</TableHead>
          <TableHead className={cn(HEAD, "text-right")}>Quantity</TableHead>
          <TableHead className={cn(HEAD, "text-right")}>Balance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {movements.map((movement) => {
          const outward = isOutwardMovement(movement);

          return (
            <TableRow key={movement.id}>
              <TableCell className="px-4 py-2.5 text-sm" suppressHydrationWarning>
                {format(new Date(movement.at), "d MMM, HH:mm")}
                {movement.byName && (
                  <div className="text-xs text-muted-foreground">{movement.byName}</div>
                )}
              </TableCell>

              {productLabels && (
                <TableCell className="px-4 py-2.5 text-sm">
                  <Link
                    to={`/inventory/products/${movement.productId}`}
                    className="hover:underline"
                  >
                    {/* A movement carries only the product id. Anything the
                        catalogue page did not cover reads as a link, not a
                        guessed name. */}
                    {productLabels[movement.productId] ?? "View product"}
                  </Link>
                </TableCell>
              )}

              <TableCell className="px-4 py-2.5 text-sm">
                {StockMovementTypes.labelOr(movement.type)}
                {(movement.reason || movement.reference) && (
                  <div className="text-xs text-muted-foreground">
                    {movement.reason}
                    {movement.reason && movement.reference ? " · " : ""}
                    {movement.reference}
                  </div>
                )}
              </TableCell>

              <TableCell
                className={cn(
                  "px-4 py-2.5 text-right text-sm font-medium tabular-nums",
                  outward ? "text-destructive" : "text-emerald-700 dark:text-emerald-400",
                )}
              >
                <span className="inline-flex items-center gap-1">
                  {outward ? (
                    <ArrowDownRightIcon className="size-3.5" aria-hidden />
                  ) : (
                    <ArrowUpRightIcon className="size-3.5" aria-hidden />
                  )}
                  {formatSignedQuantity(movement.quantity)}
                </span>
              </TableCell>

              <TableCell className="px-4 py-2.5 text-right text-sm tabular-nums">
                {movement.balanceAfter}
                {unitOfIssue && (
                  <span className="text-xs text-muted-foreground"> {unitOfIssue}</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
