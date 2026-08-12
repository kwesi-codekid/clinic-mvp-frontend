/**
 * The authenticated layout: gates every child route behind {@link requireStaff}
 * and frames it in the {@link AppShell} (sidebar + topbar).
 *
 * Child loaders still call `requireStaff` themselves when they need the access
 * token — loaders run in parallel, so this one existing does not mean a child
 * ran after it. What lives here is the shell's own data: the staff member for
 * the topbar, the clinic for the nav, and the persisted sidebar state so SSR
 * doesn't flash it open.
 *
 * `GET /facility` is fetched here rather than on the settings screen that
 * eventually edits it (T14.2), because its flags decide which modules exist at
 * all — the admin UI is a late screen but an early dependency. It is read
 * through {@link getFacilityOrNull}: the nav degrades to "show what the role
 * allows" if the clinic profile is unreachable, instead of the shell failing.
 */

import { Outlet } from "react-router";

import { AppShell } from "~/components/app-shell";
import { getFacilityOrNull } from "~/lib/api/facility";
import { requireStaff } from "~/lib/auth.server";
import type { Route } from "./+types/app-layout";

export async function loader({ request }: Route.LoaderArgs) {
  const { staff, accessToken } = await requireStaff(request);

  const facility = await getFacilityOrNull({ token: accessToken });

  // Written by SidebarProvider on every toggle; absent means open.
  const cookie = request.headers.get("Cookie") ?? "";
  const sidebarOpen = !/(?:^|;\s*)sidebar_state=false(?:;|$)/.test(cookie);

  return { staff, facility, sidebarOpen };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { staff, facility, sidebarOpen } = loaderData;

  return (
    <AppShell staff={staff} facility={facility} defaultSidebarOpen={sidebarOpen}>
      <Outlet />
    </AppShell>
  );
}
