/**
 * The Socket.io client (T0.5) — one connection for the whole app.
 *
 * The API pushes queue changes, lab results, payments, critical vitals and
 * assistant tokens over Socket.io. The spec names the *events* but documents
 * no handshake, so the contract below was established against the deployed
 * backend rather than read out of `openapi.json`:
 *
 * ```
 * io(origin)                      → connect_error "Authentication required"
 * io(origin, {auth:{token:"x"}})  → connect_error "Invalid token"
 * ```
 *
 * So: the default namespace at the API's **origin** (not under `/api/v1`),
 * default `/socket.io` path, bearer token in `auth.token`. The token is
 * fetched from `resources/realtime-token` — see that route for why the browser
 * is allowed to hold it here and nowhere else.
 *
 * **An accelerator, not a source of truth.** Nothing here returns data a
 * screen depends on. Every caller must already work on loader data alone, and
 * `useRealtimeStatus()` is what lets it decide between "the socket will tell
 * me" and "keep polling" (see `~/hooks/use-poll`). Killing the socket must
 * cost freshness, never function.
 *
 * **SSR.** The module holds no connection until an effect asks for one, and
 * `useRealtimeStatus()` reports `down` on the server and on the first client
 * render — so a screen renders its polling fallback, then quietly stops
 * polling once the socket comes up. Never call any of this from a loader.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";

import type { RealtimeCredentials } from "~/routes/resource-realtime-token";

/** Where the browser asks for a socket credential. */
const CREDENTIALS_ROUTE = "/resources/realtime-token";

/**
 * How long the connection outlives its last subscriber.
 *
 * A client-side navigation unmounts one screen's subscribers before mounting
 * the next screen's, and React's development double-effect does the same thing
 * twice. Without this grace period both would tear the socket down and
 * re-authenticate it for no reason.
 */
const IDLE_CLOSE_MS = 10_000;

/** Backoff between attempts after the *server* refused the handshake. */
const AUTH_RETRY_DELAY_MS = 5_000;

/**
 * How many times a refused handshake is retried with a fresh token.
 *
 * A rejection is usually a lapsed access token, which one refetch fixes. If
 * three fresh tokens are all refused the problem is not the token, and
 * hammering the backend will not discover otherwise — the app stays on its
 * polling fallback until the next navigation retries.
 */
const MAX_AUTH_RETRIES = 3;

/* -------------------------------------------------------------------------
   Status, published to React
   ------------------------------------------------------------------------- */

/**
 * - `connecting` — a connection is being established; treat as down.
 * - `up` — connected; pushes are arriving and polling can stand down.
 * - `down` — no connection, or none wanted. Screens must poll.
 */
export type RealtimeStatus = "connecting" | "up" | "down";

let status: RealtimeStatus = "down";
const statusWatchers = new Set<() => void>();

function setStatus(next: RealtimeStatus) {
  if (status === next) return;
  status = next;
  for (const watcher of statusWatchers) watcher();
}

function subscribeToStatus(watcher: () => void) {
  statusWatchers.add(watcher);
  return () => {
    statusWatchers.delete(watcher);
  };
}

const getStatusSnapshot = () => status;
/** The server has no socket, and saying so keeps hydration honest. */
const getServerStatusSnapshot = (): RealtimeStatus => "down";

/* -------------------------------------------------------------------------
   The connection
   ------------------------------------------------------------------------- */

let socket: Socket | null = null;
let opening: Promise<Socket | null> | null = null;
let subscribers = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let authRetries = 0;

async function loadCredentials(): Promise<RealtimeCredentials | null> {
  try {
    const response = await fetch(CREDENTIALS_ROUTE, {
      headers: { accept: "application/json" },
      // The session cookie is what authorises this; it is same-origin anyway,
      // but saying so survives any future change of base.
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    return (await response.json()) as RealtimeCredentials;
  } catch {
    // Offline, or the app server is down. The caller is polling regardless.
    return null;
  }
}

async function create(): Promise<Socket | null> {
  setStatus("connecting");

  const credentials = await loadCredentials();
  if (!credentials) {
    setStatus("down");
    return null;
  }

  // Transports are left at their defaults on purpose: Socket.io's own
  // polling-then-upgrade path is the one that survives a clinic's proxy.
  const next = io(credentials.url, {
    auth: { token: credentials.token },
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 15_000,
  });

  next.on("connect", () => {
    authRetries = 0;
    setStatus("up");
  });

  next.on("disconnect", () => {
    // Socket.io reconnects itself for transport-level drops, so this is a
    // pause rather than an end — unless nobody is listening any more.
    setStatus(subscribers > 0 ? "connecting" : "down");
  });

  next.on("connect_error", (error) => {
    setStatus("down");

    // `active` means Socket.io intends to retry on its own — a transport
    // failure. Only a *refusal* by the server's handshake middleware lands
    // here inactive, and that is the case a new token can fix.
    if (next.active) return;
    if (authRetries >= MAX_AUTH_RETRIES) {
      console.warn(`Realtime: giving up after a refused handshake (${error.message}).`);
      return;
    }

    authRetries += 1;
    const attempt = authRetries;
    setTimeout(async () => {
      if (socket !== next || subscribers === 0) return;

      const fresh = await loadCredentials();
      if (!fresh || socket !== next) return;

      next.auth = { token: fresh.token };
      setStatus("connecting");
      next.connect();
    }, AUTH_RETRY_DELAY_MS * attempt);
  });

  socket = next;
  return next;
}

function open(): Promise<Socket | null> {
  if (socket) return Promise.resolve(socket);
  if (!opening) {
    opening = create().finally(() => {
      opening = null;
    });
  }
  return opening;
}

function closeIfIdle() {
  idleTimer = null;
  if (subscribers > 0) return;

  const live = socket;
  socket = null;
  authRetries = 0;
  setStatus("down");
  live?.close();
}

/**
 * Claim the shared connection, opening it if this is the first caller.
 * Returns the matching release — call it from the effect's cleanup.
 */
function retain(): () => void {
  subscribers += 1;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  void open();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    subscribers -= 1;
    if (subscribers > 0 || idleTimer) return;
    idleTimer = setTimeout(closeIfIdle, IDLE_CLOSE_MS);
  };
}

/**
 * Runs `attach` against the live socket for as long as the effect is mounted,
 * and hands back whatever teardown `attach` returns.
 *
 * Every hook below is this plus a listener: claim the connection, wait for it
 * (opening is asynchronous — the token is fetched first), bail if the effect
 * was torn down in the meantime, release on cleanup.
 */
function useSocketEffect(
  attach: (socket: Socket) => void | (() => void),
  enabled: boolean,
  deps: readonly unknown[],
) {
  const saved = useRef(attach);
  useEffect(() => {
    saved.current = attach;
  });

  useEffect(() => {
    if (!enabled) return;

    let live = true;
    let detach: void | (() => void);
    const release = retain();

    void open().then((connection) => {
      if (!live || !connection) return;
      detach = saved.current(connection);
    });

    return () => {
      live = false;
      detach?.();
      release();
    };
    // `attach` is held in a ref so a new closure each render does not
    // re-subscribe; the caller's `deps` say when it genuinely changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
}

/* -------------------------------------------------------------------------
   Hooks
   ------------------------------------------------------------------------- */

/**
 * Whether pushes are arriving right now.
 *
 * The one thing a screen needs in order to treat the socket as an accelerator:
 * `usePoll(revalidate, POLL_MS, useRealtimeStatus() !== "up")`.
 */
export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(subscribeToStatus, getStatusSnapshot, getServerStatusSnapshot);
}

/**
 * Hold the connection open without listening for anything.
 *
 * For a screen that only wants {@link useRealtimeStatus} to be meaningful —
 * the health indicator, say. Anything that subscribes to an event already
 * retains the connection itself.
 */
export function useRealtimeConnection(enabled = true) {
  useSocketEffect(() => undefined, enabled, []);
}

/**
 * Subscribe to one server event — or several that mean the same thing — for as
 * long as the component is mounted.
 *
 * `handler` may change identity every render; it is read through a ref, so
 * only the event names and `enabled` cause a re-subscribe.
 *
 * @example
 * useRealtime<StationQueue>("queue:updated", () => revalidate());
 * useRealtime(["lab:ordered", "lab:updated"], () => revalidate());
 */
export function useRealtime<T = unknown>(
  event: string | readonly string[],
  handler: (payload: T, event: string) => void,
  enabled = true,
) {
  const saved = useRef(handler);
  useEffect(() => {
    saved.current = handler;
  });

  // Depend on the names, not the array identity — a caller writing the list
  // inline would otherwise re-subscribe on every render.
  const names = typeof event === "string" ? event : [...event].join(" ");

  const attach = useCallback((connection: Socket) => {
    const bound = names.split(" ").map((name) => {
      const listener = (payload: T) => saved.current(payload, name);
      connection.on(name, listener as (...args: unknown[]) => void);
      return [name, listener] as const;
    });

    return () => {
      for (const [name, listener] of bound) {
        connection.off(name, listener as (...args: unknown[]) => void);
      }
    };
  }, [names]);

  useSocketEffect(attach, enabled, [names]);
}

/**
 * Subscribe to *every* server event, name included.
 *
 * A blunt instrument, and deliberately available: the assistant's token stream
 * (T13.4) is documented only as "join the `ai:<streamId>` room", with no event
 * name given, so the one consumer that cannot name its event filters by prefix
 * instead. Prefer {@link useRealtime} everywhere the name is known.
 */
export function useRealtimeAny(
  handler: (event: string, ...args: unknown[]) => void,
  enabled = true,
) {
  const saved = useRef(handler);
  useEffect(() => {
    saved.current = handler;
  });

  const attach = useCallback((connection: Socket) => {
    const listener = (event: string, ...args: unknown[]) => saved.current(event, ...args);
    connection.onAny(listener);
    return () => {
      connection.offAny(listener);
    };
  }, []);

  useSocketEffect(attach, enabled, []);
}

/**
 * Join a server room for as long as the component is mounted.
 *
 * The join is re-emitted on every reconnect — a room is per-connection, so a
 * dropped socket that comes back is in no rooms at all, and a worklist that
 * joined once would go quietly stale afterwards.
 *
 * @example
 * useRealtimeRoom("queue:subscribe", { station });
 */
export function useRealtimeRoom(event: string, payload?: unknown, enabled = true) {
  const savedPayload = useRef(payload);
  useEffect(() => {
    savedPayload.current = payload;
  });

  // Re-join when the payload's *content* changes (a different station), not
  // when a fresh object literal arrives with the same content.
  const identity = JSON.stringify(payload ?? null);

  const attach = useCallback((connection: Socket) => {
    const join = () => {
      if (savedPayload.current === undefined) connection.emit(event);
      else connection.emit(event, savedPayload.current);
    };

    connection.on("connect", join);
    if (connection.connected) join();

    return () => {
      connection.off("connect", join);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, identity]);

  useSocketEffect(attach, enabled, [event, identity]);
}

/**
 * Fire-and-forget emit on the shared connection, outside a component.
 *
 * Retains the connection across the emit and releases it straight afterwards,
 * so a caller that is not a mounted subscriber cannot leave a socket open with
 * nobody listening.
 *
 * Resolves to `false` when there is no connection to emit on — which is not an
 * error anywhere in this app, only a reason to fall back.
 */
export async function emitRealtime(event: string, payload?: unknown): Promise<boolean> {
  const release = retain();
  try {
    const connection = await open();
    if (!connection) return false;
    if (payload === undefined) connection.emit(event);
    else connection.emit(event, payload);
    return true;
  } finally {
    release();
  }
}
