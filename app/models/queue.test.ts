import { describe, expect, it } from "vitest";

import {
  compareQueueEntries,
  inServiceEntry,
  isActiveEntry,
  isLongWait,
  LONG_WAIT_MINUTES,
  waitingEntries,
  type QueueEntry,
  type StationQueue,
} from "./queue";
import type { Priority, QueueStatus } from "./enums";
import type { ObjectId } from "./primitives";

/* -------------------------------------------------------------------------
   Fixtures
   ------------------------------------------------------------------------- */

let nextId = 0;

function entry(
  overrides: {
    priority?: Priority;
    status?: QueueStatus;
    /** Minutes past an arbitrary fixed origin, so arrival order is explicit. */
    at?: number;
    calledAt?: number;
    name?: string;
  } = {},
): QueueEntry {
  const { priority = "routine", status = "waiting", at = 0, calledAt, name } = overrides;
  const id = `65f0000000000000000000${String(nextId++).padStart(2, "0")}` as ObjectId;
  const stamp = (minutes: number) =>
    new Date(Date.UTC(2026, 7, 12, 8, minutes)).toISOString();

  return {
    id,
    visitId: id,
    visitNumber: `V-${id.slice(-2)}`,
    patient: {
      id,
      folderNumber: `F-${id.slice(-2)}`,
      fullName: name ?? `Patient ${id.slice(-2)}`,
      surname: "Test",
      firstName: "Patient",
      sex: "female",
      age: { display: "30y", accuracy: "exact", years: 30 },
      primaryPayer: {
        payerType: "cash",
        label: "Cash",
        status: "active",
        isPrimary: true,
        valid: true,
      },
    },
    station: "consulting",
    priority,
    status,
    position: 1,
    enqueuedAt: stamp(at),
    calledAt: calledAt === undefined ? undefined : stamp(calledAt),
    waitingMinutes: 0,
  };
}

function queueOf(entries: QueueEntry[]): StationQueue {
  return {
    station: "consulting",
    waiting: entries.filter((e) => e.status === "waiting").length,
    inService: entries.filter((e) => e.status === "in_service").length,
    completedToday: 0,
    longestWaitMinutes: 0,
    averageWaitMinutes: 0,
    entries,
  };
}

const names = (entries: QueueEntry[]) => entries.map((e) => e.patient.fullName);

/* -------------------------------------------------------------------------
   Ordering — the rule the whole screen rests on
   ------------------------------------------------------------------------- */

describe("compareQueueEntries", () => {
  it("puts emergency before urgent before routine", () => {
    const list = [
      entry({ priority: "routine", name: "routine" }),
      entry({ priority: "emergency", name: "emergency" }),
      entry({ priority: "urgent", name: "urgent" }),
    ];

    expect(names(list.sort(compareQueueEntries))).toEqual(["emergency", "urgent", "routine"]);
  });

  it("is not the alphabetical order sorting the raw strings would give", () => {
    // Sorted as plain strings this would be emergency, routine, urgent — the
    // bug this comparator exists to prevent.
    const list = [
      entry({ priority: "urgent", name: "urgent" }),
      entry({ priority: "routine", name: "routine" }),
    ];

    expect(names(list.sort(compareQueueEntries))).toEqual(["urgent", "routine"]);
  });

  it("falls back to arrival order within one priority", () => {
    const list = [
      entry({ priority: "routine", at: 30, name: "third" }),
      entry({ priority: "routine", at: 10, name: "first" }),
      entry({ priority: "routine", at: 20, name: "second" }),
    ];

    expect(names(list.sort(compareQueueEntries))).toEqual(["first", "second", "third"]);
  });

  it("lets a late emergency jump patients who arrived first", () => {
    const list = [
      entry({ priority: "routine", at: 0, name: "waiting since eight" }),
      entry({ priority: "routine", at: 15, name: "waiting since quarter past" }),
      entry({ priority: "emergency", at: 55, name: "just arrived, bleeding" }),
    ];

    expect(names(list.sort(compareQueueEntries))[0]).toBe("just arrived, bleeding");
  });
});

/* -------------------------------------------------------------------------
   Views
   ------------------------------------------------------------------------- */

describe("waitingEntries", () => {
  it("returns only those still waiting, in the order they will be called", () => {
    const queue = queueOf([
      entry({ status: "done", name: "gone" }),
      entry({ status: "waiting", priority: "routine", at: 5, name: "routine" }),
      entry({ status: "in_service", name: "being seen" }),
      entry({ status: "waiting", priority: "emergency", at: 40, name: "emergency" }),
      entry({ status: "skipped", name: "skipped" }),
    ]);

    expect(names(waitingEntries(queue))).toEqual(["emergency", "routine"]);
  });

  it("is empty when nobody is waiting", () => {
    expect(waitingEntries(queueOf([entry({ status: "done" })]))).toEqual([]);
  });
});

describe("inServiceEntry", () => {
  it("returns the patient called longest ago when a station serves several", () => {
    const queue = queueOf([
      entry({ status: "in_service", calledAt: 30, name: "called at half past" }),
      entry({ status: "in_service", calledAt: 10, name: "called at ten past" }),
      entry({ status: "waiting", name: "waiting" }),
    ]);

    expect(inServiceEntry(queue)?.patient.fullName).toBe("called at ten past");
  });

  it("returns nothing when nobody is being seen", () => {
    expect(inServiceEntry(queueOf([entry({ status: "waiting" })]))).toBeUndefined();
  });

  it("does not reorder the queue it was given", () => {
    const entries = [
      entry({ status: "in_service", calledAt: 30, name: "second" }),
      entry({ status: "in_service", calledAt: 10, name: "first" }),
    ];
    const queue = queueOf(entries);
    inServiceEntry(queue);

    expect(names(queue.entries)).toEqual(["second", "first"]);
  });
});

describe("isActiveEntry", () => {
  it("counts waiting and in-service as still on the list", () => {
    expect(isActiveEntry(entry({ status: "waiting" }))).toBe(true);
    expect(isActiveEntry(entry({ status: "in_service" }))).toBe(true);
  });

  it("counts done, skipped and left as off it", () => {
    // Skipped is recoverable, but the patient is not on the list until
    // `requeue` puts them back.
    expect(isActiveEntry(entry({ status: "skipped" }))).toBe(false);
    expect(isActiveEntry(entry({ status: "done" }))).toBe(false);
    expect(isActiveEntry(entry({ status: "left" }))).toBe(false);
  });
});

describe("isLongWait", () => {
  it("flags a wait at or past the threshold", () => {
    expect(isLongWait(LONG_WAIT_MINUTES)).toBe(true);
    expect(isLongWait(LONG_WAIT_MINUTES + 1)).toBe(true);
    expect(isLongWait(LONG_WAIT_MINUTES - 1)).toBe(false);
    expect(isLongWait(0)).toBe(false);
  });
});
