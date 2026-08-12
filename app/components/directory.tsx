/**
 * The furniture every directory screen is built from — stat cards, status
 * pills, the pager, the avatar stand-in, and the CSV download.
 *
 * Staff (T14.1) and Patients (T2.2) are the same screen wearing different
 * columns: counters across the top, a filtered and searchable table below, a
 * pager under that. These are the pieces both mount, so the two stay visually
 * identical without either owning the other's copy.
 */

import type { ReactNode } from "react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
} from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { buttonVariants } from "~/components/ui/button";
import { Link } from "react-router";
import { cn } from "~/lib/utils";

/* -------------------------------------------------------------------------
   Counters
   ------------------------------------------------------------------------- */

export function StatCard({
  label,
  value,
  icon: Icon,
  children,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children: ReactNode;
}) {
  return (
    <Card size="sm" className="gap-2">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction>
          <span className="flex size-8 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
            <Icon className="size-4" strokeWidth={1.75} />
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-0.5">
        <div className="font-heading text-3xl font-semibold tracking-tight tabular-nums">
          {value}
        </div>
        <div className="text-xs text-muted-foreground">{children}</div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
   Status
   ------------------------------------------------------------------------- */

export function StatusPill({
  tone,
  children,
}: {
  tone: "positive" | "warning" | "critical" | "muted";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        tone === "positive" &&
          "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
        tone === "warning" &&
          "bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
        tone === "critical" && "bg-destructive/10 text-destructive",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          tone === "positive" && "bg-emerald-500",
          tone === "warning" && "bg-amber-500",
          tone === "critical" && "bg-destructive",
          tone === "muted" && "bg-muted-foreground/50",
        )}
      />
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------
   Paging
   ------------------------------------------------------------------------- */

export function PagerLink({
  to,
  disabled,
  label,
  children,
}: {
  to: string;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  if (disabled) {
    return (
      <Button variant="outline" size="icon-sm" disabled aria-label={label}>
        {children}
      </Button>
    );
  }
  return (
    <Link
      to={to}
      preventScrollReset
      aria-label={label}
      className={buttonVariants({ variant: "outline", size: "icon-sm" })}
    >
      {children}
    </Link>
  );
}

/* -------------------------------------------------------------------------
   Avatars — a stand-in for the photos the API does not carry
   ------------------------------------------------------------------------- */

const AVATAR_TINTS = [
  "bg-primary/10 text-primary",
  "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
];

/** Deterministic tint per record, so a face keeps its colour between pages. */
export function avatarTint(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}

export function initialsOf(firstName: string, surname: string): string {
  return (firstName[0] ?? "") + (surname[0] ?? "");
}

/* -------------------------------------------------------------------------
   CSV export — whatever is in view, entirely client-side
   ------------------------------------------------------------------------- */

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Builds a CSV from `rows` (header first) and hands it to the browser. */
export function downloadCsv(rows: string[][], filename: string) {
  const csv = rows.map((row) => row.map(csvField).join(",")).join("\r\n");

  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
