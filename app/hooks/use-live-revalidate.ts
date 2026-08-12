/**
 * Keep a screen current: pushed over the socket when it is up, polled when it
 * is not (T0.5).
 *
 * Every live screen in the app — the station worklists, the lab bench, the
 * dispensing counter — wants the same three things, and getting any of them
 * subtly wrong is how a clinic ends up acting on a patient who has already
 * moved on:
 *
 * 1. **Join the room, re-join on reconnect.** Rooms are per-connection. A
 *    socket that drops and comes back is in no rooms at all, so a screen that
 *    joined once would sit there looking live and be entirely stale.
 * 2. **Never stack requests.** A revalidation is skipped while another is in
 *    flight, because the network that made the first one slow is the same one
 *    that would have to carry the second.
 * 3. **Keep a backstop poll even when live.** This is the important one. The
 *    socket's *handshake* is verified (see `~/lib/realtime`), but the room-join
 *    payload for `queue:subscribe` is not documented anywhere, so a join could
 *    silently not take. Stopping polling outright the moment `status === "up"`
 *    would turn that into a screen that is confidently, invisibly frozen.
 *    Instead the interval stretches — {@link LIVE_POLL_MS} rather than
 *    {@link POLL_MS} — so the socket earns most of the saving and a wrong
 *    guess about the room costs freshness measured in a minute, not a shift.
 *
 * The return value is for the "updates every …" line in a screen's footer, so
 * the person reading it knows which of the two is currently keeping it honest.
 */

import { useCallback } from "react";
import { useRevalidator } from "react-router";

import { usePoll } from "~/hooks/use-poll";
import { useRealtime, useRealtimeRoom, useRealtimeStatus } from "~/lib/realtime";

/** Interval with no socket. TASK.md suggests 15–30s; this is the middle. */
export const POLL_MS = 20_000;

/** Backstop interval while the socket is up. See point 3 above. */
export const LIVE_POLL_MS = 60_000;

export type LiveRevalidation = {
  /** True when pushes are arriving and polling has stepped back. */
  live: boolean;
  /** True while a revalidation is in flight — for the spinner. */
  refreshing: boolean;
  /** The interval currently in force, in milliseconds. */
  intervalMs: number;
};

export function useLiveRevalidate({
  events,
  room,
  roomPayload,
  pollMs = POLL_MS,
  livePollMs = LIVE_POLL_MS,
}: {
  /** Server events that mean "this screen's data changed". */
  events: string | readonly string[];
  /** Emitted to join the room those events are sent to. Omit if global. */
  room?: string;
  /** Body of the join emit — the station, the order id, whatever it scopes to. */
  roomPayload?: unknown;
  /** Interval with no socket. `0` disables polling entirely. */
  pollMs?: number;
  /** Backstop interval while the socket is up. `0` disables the backstop. */
  livePollMs?: number;
}): LiveRevalidation {
  const revalidator = useRevalidator();
  const status = useRealtimeStatus();
  const live = status === "up";

  const refresh = useCallback(() => {
    if (revalidator.state === "idle") void revalidator.revalidate();
  }, [revalidator]);

  useRealtimeRoom(room ?? "", roomPayload, Boolean(room));
  useRealtime(events, refresh);

  const intervalMs = live ? livePollMs : pollMs;
  usePoll(refresh, intervalMs, revalidator.state === "idle");

  return { live, refreshing: revalidator.state !== "idle", intervalMs };
}
