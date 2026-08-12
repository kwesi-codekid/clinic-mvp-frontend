/**
 * The line in a live screen's footer that says how it is staying current.
 *
 * Three states, and the distinction between the first two is the point:
 * "Live" means the socket is pushing changes, "Updates every 20s" means it is
 * not and the screen is polling. Someone deciding whether to trust what is in
 * front of them — a nurse about to call the next patient — should not have to
 * guess which. See `~/hooks/use-live-revalidate`, whose return value this
 * renders.
 */

import { Loader2Icon } from "lucide-react";

import type { LiveRevalidation } from "~/hooks/use-live-revalidate";

export function FreshnessNote({ live, refreshing, intervalMs }: LiveRevalidation) {
  if (refreshing) {
    return (
      <span className="flex items-center gap-1.5">
        <Loader2Icon className="size-3.5 animate-spin" />
        Refreshing…
      </span>
    );
  }

  if (live) {
    return (
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-2 rounded-full bg-chart-3" />
        Live
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      Updates every {Math.round(intervalMs / 1000)}s
    </span>
  );
}
