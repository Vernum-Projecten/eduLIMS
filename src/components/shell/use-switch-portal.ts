// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useHotkeys } from "@tanstack/react-hotkeys";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback } from "react";
import { toast } from "sonner";
import { m } from "@/i18n/messages";
import type { PortalNavigation } from "@/lib/navigation";
import { PORTAL_HOTKEYS, portalShortcut } from "@/lib/shortcuts";
import { saveLastPortal } from "@/server/preferences/functions";

/**
 * Returns a function that opens a portal: it saves the portal on the account as the landing
 * portal (ADR 0012) and navigates to its overview. A failed save keeps the navigation and
 * shows a toast.
 */
export function useSwitchPortal(): (portal: PortalNavigation) => void {
  const navigate = useNavigate();
  const save = useServerFn(saveLastPortal);
  return useCallback(
    (portal: PortalNavigation) => {
      save({ data: { portal: portal.role } }).catch(() => {
        toast.error(m.portal_switch_save_failed());
      });
      void navigate({ to: portal.overview.to });
    },
    [navigate, save],
  );
}

/**
 * Binds Alt+1 to Alt+9 (⌥1 on macOS) to the user's portals in switcher order, from the shortcut
 * registry. Active only with two portals or more. The bindings match the physical digit key,
 * fire once per press, skip text fields and any other modifier, and leave digits past the last
 * portal to the browser.
 */
export function usePortalShortcuts(
  portals: readonly PortalNavigation[],
  current: PortalNavigation | null,
): void {
  const switchPortal = useSwitchPortal();
  const reachable = portals.length < 2 ? [] : portals.slice(0, PORTAL_HOTKEYS.length);
  useHotkeys(
    reachable.flatMap((portal, index) => {
      const shortcut = portalShortcut(index, portal.label);
      if (!shortcut) return [];
      return shortcut.hotkeys.map((hotkey) => ({
        hotkey,
        callback: () => {
          if (portal.role !== current?.role) switchPortal(portal);
        },
        options: { requireReset: true, meta: { name: shortcut.label() } },
      }));
    }),
  );
}
