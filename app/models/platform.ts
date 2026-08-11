/**
 * Platform-level models. `GET /health` is unauthenticated and safe to poll;
 * the admin screens that consume the rest of this domain land in T14.3.
 */

/** Liveness and dependency status. */
export type Health = {
  status: "ok" | "degraded";
  uptimeSeconds: number;
  version: string;
  environment: string;
  checks: {
    database: "up" | "down";
    /** False when the node is reachable but not primary — nothing will read or write. */
    databaseWritable: boolean;
    realtime: "up" | "down";
    ai: "enabled" | "disabled";
  };
  replicaSet: string | null;
  transactionsAvailable: boolean;
};
