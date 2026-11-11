// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand-mark";
import { NavMain } from "@/components/shell/nav-main";
import { NavUser } from "@/components/shell/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { m } from "@/i18n/messages";
import { navigationFor } from "@/lib/navigation";
import type { SessionUser } from "@/server/authz";

/**
 * The application sidebar (the sidebar-07 block, "collapses to icons"): the brand at the top,
 * the navigation of the user's own portals, and the user menu at the foot. On a phone it opens
 * as a sheet.
 */
export function AppSidebar({ user }: Readonly<{ user: SessionUser }>) {
  const portals = navigationFor(user);
  const home = portals.at(0)?.overview.to ?? "/";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="eduLIMS">
              <Link to={home}>
                <BrandMark className="size-8! shrink-0" />
                <span className="truncate text-lg tracking-tight">
                  edu<span className="font-bold text-primary">LIMS</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain portals={portals} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail aria-label={m.sidebar_toggle()} title={m.sidebar_toggle()} />
    </Sidebar>
  );
}
