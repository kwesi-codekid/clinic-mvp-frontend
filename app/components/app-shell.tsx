/**
 * The frame every authenticated screen renders inside, built from the design:
 * a grouped icon sidebar (Clinical / Diagnostics / Operations / Finance &
 * Insights), and a topbar carrying global search, theme, notifications and
 * the signed-in staff member.
 *
 * The shell is dumb about permissions on purpose: it renders whatever
 * {@link buildNav} hands it, and that function — not this file — is where the
 * facility's feature flags and the staff member's roles decide what exists.
 *
 * The sidebar collapses to an icon rail (trigger in its header, the rail edge
 * or ⌘/Ctrl+B to bring it back) and becomes a sheet on mobile, where the
 * trigger moves into the topbar.
 */

import { useMemo, type ReactNode } from "react";
import {
  BellIcon,
  ChevronsUpDownIcon,
  CrossIcon,
  LogOutIcon,
  SearchIcon,
} from "lucide-react";
import { Link, useLocation, useSubmit } from "react-router";
import { toast } from "sonner";

import { ThemeToggle } from "~/components/theme-toggle";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "~/components/ui/sidebar";
import { buildNav, findNavItem, type NavGroup } from "~/lib/navigation";
import type { Facility } from "~/models/facility";
import type { Staff } from "~/models/staff";

/* -------------------------------------------------------------------------
   Sidebar
   ------------------------------------------------------------------------- */

function AppSidebar({ nav }: { nav: NavGroup[] }) {
  const { pathname } = useLocation();
  // Matched against the whole catalogue, not `nav`: a module someone is not
  // offered can still be the page they are standing on.
  const active = findNavItem(pathname)?.to;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-16 justify-center">
        <Link
          to="/"
          className="flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:justify-center"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CrossIcon className="size-4" fill="currentColor" strokeWidth={1} />
          </span>
          <span className="truncate font-heading text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            Clinic
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {nav.map((group) => (
          <SidebarGroup key={group.label ?? "main"} className="py-1">
            {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      isActive={active === item.to}
                      tooltip={item.label}
                      render={<Link to={item.to} />}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}

/* -------------------------------------------------------------------------
   Topbar
   ------------------------------------------------------------------------- */

function initials(staff: Staff): string {
  return (staff.firstName[0] ?? "") + (staff.surname[0] ?? "");
}

function UserMenu({ staff }: { staff: Staff }) {
  const submit = useSubmit();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="h-11 gap-2.5 px-1.5 sm:pr-2.5"
            aria-label="Account"
          />
        }
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary uppercase">
            {initials(staff)}
          </AvatarFallback>
        </Avatar>
        <span className="hidden min-w-0 flex-col items-start sm:flex">
          <span className="max-w-36 truncate text-sm font-medium leading-tight">
            {staff.fullName}
          </span>
          <span className="max-w-36 truncate text-xs font-normal leading-tight text-muted-foreground">
            {staff.email}
          </span>
        </span>
        <ChevronsUpDownIcon className="hidden size-3.5 text-muted-foreground sm:block" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-56">
        {/* Base UI's GroupLabel throws unless it sits inside a Group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col">
            <span>{staff.fullName}</span>
            <span className="text-xs font-normal text-muted-foreground">{staff.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => submit(null, { method: "post", action: "/logout" })}
        >
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Topbar({ staff }: { staff: Staff }) {
  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/80 sm:px-6">
      {/* Always visible here — the one place that exists in every sidebar state. */}
      <SidebarTrigger className="-ml-1" aria-label="Toggle sidebar" />

      <div className="relative w-full max-w-md">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search patients, appointments, records..."
          aria-label="Search"
          className="h-9 rounded-full border-transparent bg-muted/60 pl-9 shadow-none focus-visible:border-input focus-visible:bg-background"
        />
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <ThemeToggle />
        <Button
          variant="outline"
          size="icon"
          aria-label="Notifications"
          onClick={() =>
            toast.info("Notifications are on the way", {
              description: "You'll see queue and result alerts here.",
            })
          }
        >
          <BellIcon />
        </Button>
        <UserMenu staff={staff} />
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------
   Shell
   ------------------------------------------------------------------------- */

export function AppShell({
  staff,
  facility,
  defaultSidebarOpen = true,
  children,
}: {
  staff: Staff;
  /**
   * The clinic, for the feature flags that switch modules on and off.
   * `null` when `GET /facility` could not be read — the nav falls open rather
   * than hiding modules over a failed request.
   */
  facility: Facility | null;
  /** From the `sidebar_state` cookie, so SSR renders the persisted state. */
  defaultSidebarOpen?: boolean;
  children: ReactNode;
}) {
  // Built here rather than in the loader: `NavItem.icon` is a React component
  // and would not survive serialisation across that boundary.
  const nav = useMemo(() => buildNav(staff, facility), [staff, facility]);

  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen}>
      <AppSidebar nav={nav} />
      <SidebarInset>
        <Topbar staff={staff} />
        <div className="flex-1 bg-muted/40 px-4 py-6 dark:bg-transparent sm:px-6">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
