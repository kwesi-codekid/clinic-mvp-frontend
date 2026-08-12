/**
 * The authenticated layout: gates every child route behind {@link requireStaff}
 * and frames it in the {@link AppShell} (sidebar + topbar).
 *
 * Child loaders still call `requireStaff` themselves when they need the access
 * token — loaders run in parallel, so this one existing does not mean a child
 * ran after it. What lives here is the shell's own data: the staff member for
 * the topbar, and the persisted sidebar state so SSR doesn't flash it open.
 */

import { Outlet } from "react-router";

import { AppShell } from "~/components/app-shell";
import { requireStaff } from "~/lib/auth.server";
import type { Route } from "./+types/app-layout";

export async function loader({ request }: Route.LoaderArgs) {
  const { staff } = await requireStaff(request);

  // Written by SidebarProvider on every toggle; absent means open.
  const cookie = request.headers.get("Cookie") ?? "";
  const sidebarOpen = !/(?:^|;\s*)sidebar_state=false(?:;|$)/.test(cookie);

  return { staff, sidebarOpen };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { staff, sidebarOpen } = loaderData;

  return (
    <AppShell staff={staff} defaultSidebarOpen={sidebarOpen}>
      <Outlet />
    </AppShell>
  );
}
