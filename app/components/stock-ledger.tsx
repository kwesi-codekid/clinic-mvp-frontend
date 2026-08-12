/**
 * The stock ledger (T7.3), shared by the product page and `/inventory/movements`.
 *
 * Drawn as the bin card it replaces: ledger figures in the mono face, the
 * quantity **signed** — `StockMovement.quantity` is negative for anything
 * leaving the store, and printing the magnitude alone would turn a write-off
 * into a delivery — and the running balance as the emphasized column, because
 * the balance is what a storekeeper opens the card to read. The sign carries
 * the direction on its own; colour is kept for the one event worth spotting in
 * a column of issues, stock arriving, which reads emerald. Nothing here is
 * red: a wastage line is a normal record, and the cause column already names
 * it.
 *
 * There is no edit affordance, here or anywhere: the ledger is append-only,
 * and a mistake is corrected by another movement rather than by rewriting one.
 * That is why a reason rides on the line — it is the only explanation the
 * record will ever carry.
 */

import { format } from "date-fns";
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
                    {movement.reference && <span className="font-mono">{movement.reference}</span>}
                  </div>
                )}
              </TableCell>

              <TableCell
                className={cn(
                  "px-4 py-2.5 text-right font-mono text-sm font-medium tabular-nums",
                  outward ? "text-foreground" : "text-emerald-700 dark:text-emerald-400",
                )}
              >
                {formatSignedQuantity(movement.quantity)}
              </TableCell>

              <TableCell className="px-4 py-2.5 text-right font-mono text-sm font-semibold tabular-nums">
                {movement.balanceAfter}
                {unitOfIssue && (
                  <span className="font-sans text-xs font-normal text-muted-foreground">
                    {" "}
                    {unitOfIssue}
                  </span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
