// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { m } from "@/i18n/messages";
import type { PortalNavigation } from "@/lib/navigation";
import { browserPlatform, isApplePlatform, portalShortcutIndex } from "@/lib/portal-shortcuts";
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

const noSubscription = () => () => {};

/**
 * Returns whether the browser runs on an Apple platform, so shortcuts show ⌥ instead of Alt.
 * The server and the hydration pass render the non-Apple label; the client corrects it after.
 */
export function useApplePlatform(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => isApplePlatform(browserPlatform()),
    () => false,
  );
}

/**
 * Listens for Alt+1 to Alt+9 (⌥1 on macOS) anywhere on the page and opens the portal at that
 * position. Active only with two portals or more; a key press it does not act on keeps its
 * default.
 */
export function usePortalShortcuts(
  portals: readonly PortalNavigation[],
  current: PortalNavigation | null,
): void {
  const switchPortal = useSwitchPortal();
  useEffect(() => {
    if (portals.length < 2) return;
    function onKeyDown(event: KeyboardEvent) {
      const index = portalShortcutIndex(event, portals.length);
      if (index === null) return;
      const portal = portals[index];
      if (!portal) return;
      event.preventDefault();
      if (portal.role !== current?.role) switchPortal(portal);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [portals, current, switchPortal]);
}
