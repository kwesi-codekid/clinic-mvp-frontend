/**
 * Catch-all under the authenticated layout. The sidebar ships with the full
 * module map from the design while the modules themselves land phase by phase
 * (TASK.md) — so an unbuilt path renders this placeholder inside the shell
 * instead of a bare 404, and a real route module simply takes over the path
 * when it lands.
 *
 * Still a 404 at the HTTP level: the page genuinely isn't there yet.
 */

import { ConstructionIcon } from "lucide-react";
import { data, Link, useLocation } from "react-router";

import { findNavItem } from "~/components/app-shell";
import { buttonVariants } from "~/components/ui/button";
import type { Route } from "./+types/coming-soon";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Coming soon · Clinic" }];
}

export function loader() {
  return data(null, { status: 404 });
}

export default function ComingSoon() {
  const { pathname } = useLocation();
  const module = findNavItem(pathname);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <ConstructionIcon className="size-7" strokeWidth={1.5} />
      </div>
      <div className="space-y-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          {module ? `${module.label} isn't ready yet` : "This page doesn't exist"}
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          {module
            ? "This module is on the build plan and will appear here when it lands."
            : "Check the address, or head back to the dashboard."}
        </p>
      </div>
      <Link to="/" className={buttonVariants({ variant: "outline" })}>
        Back to dashboard
      </Link>
    </div>
  );
}
