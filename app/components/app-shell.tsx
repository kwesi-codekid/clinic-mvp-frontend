import type { ReactNode } from "react";
import { Link } from "react-router";

import { ThemeToggle } from "~/components/theme-toggle";

/**
 * The frame every authenticated screen renders inside: a sticky header and a
 * content column.
 *
 * Deliberately nav-agnostic — which modules a staff member may see depends on
 * their roles and station and on the facility's feature flags, so T1.3 passes
 * an already-filtered `nav` in rather than this component deciding.
 */
export function AppShell({
  nav,
  actions,
  children,
}: {
  /** Role- and station-filtered navigation. */
  nav?: ReactNode;
  /** Header-right controls: on-call staff, till state, health indicator. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
          <Link to="/" className="font-heading text-sm font-semibold tracking-tight">
            Clinic
          </Link>
          {nav && <div className="min-w-0 flex-1">{nav}</div>}
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
