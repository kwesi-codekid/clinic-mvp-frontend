/**
 * Run something on an interval, but only while anyone is looking.
 *
 * The station worklists need to stay current without a socket (see
 * `~/lib/api/queues` on why), and the naive `setInterval(revalidate, 20_000)`
 * misbehaves in exactly the ways a clinic will notice:
 *
 * - a tablet left on the vitals bench overnight would poll ~4,000 times before
 *   morning, so polling stops while the tab is hidden;
 * - the screen someone comes back to would then be stale for up to a full
 *   interval, so returning to the tab fires immediately rather than waiting;
 * - a changing `callback` identity would otherwise tear down and restart the
 *   interval on every render, quietly resetting the clock — the callback is
 *   held in a ref so the interval survives re-renders.
 */

import { useEffect, useRef } from "react";

export function usePoll(callback: () => void, intervalMs: number, enabled = true) {
  const saved = useRef(callback);

  // Kept current without restarting the interval below.
  useEffect(() => {
    saved.current = callback;
  });

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    const run = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      saved.current();
    };

    const timer = setInterval(run, intervalMs);

    // Coming back to a backgrounded tab should show fresh data at once, not
    // whatever it was showing when it was put down.
    const onVisibilityChange = () => {
      if (!document.hidden) saved.current();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs, enabled]);
}
