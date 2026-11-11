// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { useSwitchPortal } from "@/components/shell/use-switch-portal";
import { useShortcutPlatform } from "@/components/shortcuts/use-shortcut-platform";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { m } from "@/i18n/messages";
import type { PortalNavigation } from "@/lib/navigation";
import { ariaKeyShortcuts, portalShortcut, shortcutLabel } from "@/lib/shortcuts";

/**
 * The logo tile and the current portal's name, as in the sidebar-07 team switcher: the tile is
 * the eduLIMS Microplate mark, the subtitle the product name.
 */
function PortalIdentity({ portal }: Readonly<{ portal: PortalNavigation }>) {
  return (
    <>
      <BrandMark className="aspect-square size-8! shrink-0" />
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{portal.label()}</span>
        <span className="truncate text-xs">eduLIMS</span>
      </div>
    </>
  );
}

/** The portal's name as a tooltip on the collapsed rail, where only the logo tile shows. */
function RailTooltip({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  const { isMobile, state } = useSidebar();
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" align="center" hidden={state !== "collapsed" || isMobile}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The portal switcher at the top of the sidebar (the sidebar-07 block's `TeamSwitcher`,
 * ADR 0012). It shows the current portal, which the URL decides. With two portals or more it
 * opens a menu of the user's portals with their Alt+digit shortcuts; picking one saves it as
 * the landing portal and opens it. With one portal it is a plain heading without a menu.
 */
export function PortalSwitcher({
  portals,
  current,
}: Readonly<{ portals: readonly PortalNavigation[]; current: PortalNavigation }>) {
  const { isMobile } = useSidebar();
  const switchPortal = useSwitchPortal();
  const platform = useShortcutPlatform();
  const label = current.label();

  if (portals.length < 2) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <RailTooltip label={label}>
            <SidebarMenuButton asChild size="lg" className="hover:bg-transparent">
              <div>
                <PortalIdentity portal={current} />
              </div>
            </SidebarMenuButton>
          </RailTooltip>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {/* Non-modal like the user menu: a modal menu hides focusable content (axe). */}
        <DropdownMenu modal={false}>
          <RailTooltip label={label}>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <PortalIdentity portal={current} />
                <span className="sr-only">{m.portal_switcher_open()}</span>
                <ChevronsUpDownIcon aria-hidden="true" className="ml-auto" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
          </RailTooltip>
          <DropdownMenuContent
            className="w-fit"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {m.portal_switcher_label()}
            </DropdownMenuLabel>
            {portals.map((portal, index) => {
              const Icon = portal.icon;
              const isCurrent = portal.role === current.role;
              const hotkeys = portalShortcut(index, portal.label)?.hotkeys ?? [];
              return (
                <DropdownMenuItem
                  key={portal.role}
                  onSelect={() => {
                    if (!isCurrent) switchPortal(portal);
                  }}
                  aria-current={isCurrent ? "true" : undefined}
                  aria-keyshortcuts={
                    hotkeys.length ? ariaKeyShortcuts(hotkeys, platform) : undefined
                  }
                  className="gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    <Icon aria-hidden="true" className="size-3.5" />
                  </div>
                  {portal.label()}
                  {isCurrent && (
                    <>
                      <CheckIcon aria-hidden="true" className="size-4" />
                      <span className="sr-only">{m.portal_switcher_current()}</span>
                    </>
                  )}
                  {hotkeys.map((hotkey) => (
                    <DropdownMenuShortcut key={hotkey} aria-hidden="true">
                      {shortcutLabel(hotkey, platform)}
                    </DropdownMenuShortcut>
                  ))}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
