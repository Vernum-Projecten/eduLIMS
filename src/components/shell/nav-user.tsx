// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { ChevronsUpDownIcon, LogOutIcon } from "lucide-react";
import { useSignOut } from "@/components/shell/use-sign-out";
import { ThemeSubmenu } from "@/components/theme/theme-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { m } from "@/i18n/messages";
import { roleLabel } from "@/lib/i18n/labels";
import { initials } from "@/lib/navigation";
import type { SessionUser } from "@/server/authz";

function UserIdentity({ user }: Readonly<{ user: SessionUser }>) {
  return (
    <>
      <Avatar className="size-8 rounded-lg">
        <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">
          {initials(user.name)}
        </AvatarFallback>
      </Avatar>
      <span className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{user.name}</span>
        <span className="truncate text-xs">{user.email}</span>
      </span>
    </>
  );
}

/**
 * The user menu at the foot of the sidebar (from the sidebar-07 block's `NavUser`): the
 * avatar with initials, name, e-mail and roles, the theme submenu and signing out.
 */
export function NavUser({ user }: Readonly<{ user: SessionUser }>) {
  const { isMobile } = useSidebar();
  const { signOut, pending } = useSignOut();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {/* Non-modal like the language menu: a modal menu hides focusable content (axe). */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <UserIdentity user={user} />
              <ChevronsUpDownIcon aria-hidden="true" className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <span className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <UserIdentity user={user} />
              </span>
              <span className="flex flex-wrap gap-1 px-1 pb-1.5">
                <span className="sr-only">{m.user_menu_roles()}:</span>
                {user.roles.map((role) => (
                  <Badge key={role} variant="secondary">
                    {roleLabel(role)}
                  </Badge>
                ))}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <ThemeSubmenu />
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={pending} onSelect={() => void signOut()}>
              <LogOutIcon aria-hidden="true" />
              {m.sign_out()}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
