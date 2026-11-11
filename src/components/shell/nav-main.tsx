// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link, useLocation } from "@tanstack/react-router";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { m } from "@/i18n/messages";
import { type NavItem, normalizePath, type PortalNavigation } from "@/lib/navigation";

/**
 * The portal navigation (from the sidebar-07 block's `NavMain`): one group per portal given
 * (the current portal), with its overview and sections. The current page carries
 * `aria-current="page"`; collapsed to icons, every item shows its label as a tooltip.
 */
export function NavMain({ portals }: Readonly<{ portals: readonly PortalNavigation[] }>) {
  const pathname = useLocation({ select: (location) => normalizePath(location.pathname) });
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <nav aria-label={m.main_menu()}>
      {portals.map((portal) => (
        <SidebarGroup key={portal.role}>
          <SidebarGroupLabel>{portal.label()}</SidebarGroupLabel>
          <SidebarMenu>
            {[portal.overview, ...portal.sections].map((item) => (
              <NavMainItem
                key={item.to}
                item={item}
                active={item.to === pathname}
                onNavigate={() => {
                  if (isMobile) setOpenMobile(false);
                }}
              />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </nav>
  );
}

function NavMainItem({
  item,
  active,
  onNavigate,
}: Readonly<{ item: NavItem; active: boolean; onNavigate: () => void }>) {
  const Icon = item.icon;
  const label = item.label();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={label}>
        <Link
          to={item.to}
          activeOptions={{ exact: true }}
          aria-current={active ? "page" : undefined}
          onClick={onNavigate}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
