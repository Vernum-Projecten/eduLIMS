// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useLocation } from "@tanstack/react-router";
import { NavMain } from "@/components/shell/nav-main";
import { NavUser } from "@/components/shell/nav-user";
import { PortalSwitcher } from "@/components/shell/portal-switcher";
import { usePortalShortcuts } from "@/components/shell/use-switch-portal";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { navigationFor, portalOfPath } from "@/lib/navigation";
import type { SessionUser } from "@/server/authz";

/**
 * The application sidebar (the sidebar-07 block, "collapses to icons"): the portal switcher at
 * the top, the navigation of the current portal, and the user menu at the foot. The current
 * portal comes from the URL (ADR 0012). On a phone it opens as a sheet.
 */
export function AppSidebar({ user }: Readonly<{ user: SessionUser }>) {
  const portals = navigationFor(user);
  const inUrl = useLocation({ select: (location) => portalOfPath(location.pathname)?.role });
  const current = portals.find((portal) => portal.role === inUrl) ?? portals.at(0) ?? null;
  usePortalShortcuts(portals, current);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {current && <PortalSwitcher portals={portals} current={current} />}
      </SidebarHeader>
      <SidebarContent>
        <NavMain portals={current ? [current] : []} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
