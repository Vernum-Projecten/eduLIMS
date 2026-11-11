// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useHotkeys } from "@tanstack/react-hotkeys";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback } from "react";
import { toast } from "sonner";
import { m } from "@/i18n/messages";
import type { PortalNavigation } from "@/lib/navigation";
import { PORTAL_HOTKEYS, portalShortcut } from "@/lib/shortcuts";
import { saveLastPortal } from "@/server/preferences/functions";
import { saveLastPortalMutationOptions } from "@/server/preferences/query-options";

/**
 * Returns a function that opens a portal: it saves the portal on the account as the landing
 * portal (ADR 0012), optimistically in the cached session, and navigates to its overview. A
 * failed save rolls the cached portal back, keeps the navigation and shows a toast.
 */
export function useSwitchPortal(): (portal: PortalNavigation) => void {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const save = useServerFn(saveLastPortal);
  const options = saveLastPortalMutationOptions(queryClient, save);
  const { mutate } = useMutation({
    ...options,
    onError: async (...args) => {
      await options.onError?.(...args);
      toast.error(m.portal_switch_save_failed());
    },
  });
  return useCallback(
    (portal: PortalNavigation) => {
      mutate(portal.role);
      void navigate({ to: portal.overview.to });
    },
    [navigate, mutate],
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
