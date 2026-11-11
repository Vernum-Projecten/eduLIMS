// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { HotkeysProvider, useHotkeys } from "@tanstack/react-hotkeys";
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";
import { KeyboardShortcutsDialog } from "@/components/shortcuts/keyboard-shortcuts-dialog";
import { useCharacterKeyShortcuts } from "@/components/shortcuts/use-character-key-shortcuts";
import { useShortcutPlatform } from "@/components/shortcuts/use-shortcut-platform";
import type { PortalNavigation } from "@/lib/navigation";
import { isCharacterKeyShortcut, isOverlayOpen, SHORTCUTS } from "@/lib/shortcuts";

/** Opens the keyboard shortcuts dialog; focus returns to `returnFocus` when it closes. */
type OpenShortcutsDialog = (returnFocus?: HTMLElement | null) => void;

const ShortcutsDialogContext = createContext<OpenShortcutsDialog | null>(null);

/** Returns the function that opens the keyboard shortcuts dialog. */
export function useOpenShortcutsDialog(): OpenShortcutsDialog {
  const open = useContext(ShortcutsDialogContext);
  if (!open) throw new Error("useOpenShortcutsDialog needs a ShortcutsProvider");
  return open;
}

function ShortcutsDialogHost({
  portals,
  children,
}: Readonly<{ portals: readonly PortalNavigation[]; children: ReactNode }>) {
  const [open, setOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [characterKeys] = useCharacterKeyShortcuts();
  const openDialog = useCallback<OpenShortcutsDialog>((target) => {
    returnFocus.current = target ?? null;
    setOpen(true);
  }, []);
  const { hotkeys, label } = SHORTCUTS.showShortcuts;
  useHotkeys(
    hotkeys.map((hotkey) => ({
      hotkey,
      callback: (event: KeyboardEvent) => {
        if (isOverlayOpen(document)) return;
        event.preventDefault();
        openDialog();
      },
      options: {
        enabled: characterKeys || !isCharacterKeyShortcut(hotkey),
        // Prevented in the callback, so a key it does not act on keeps its default.
        preventDefault: false,
        meta: { name: label() },
      },
    })),
  );

  return (
    <ShortcutsDialogContext value={openDialog}>
      {children}
      <KeyboardShortcutsDialog
        open={open}
        onOpenChange={setOpen}
        portals={portals}
        returnFocus={() => returnFocus.current}
      />
    </ShortcutsDialogContext>
  );
}

/**
 * The keyboard shortcuts of the signed-in app: TanStack Hotkeys with the user's platform (so
 * `Mod` is ⌘ on macOS and Ctrl elsewhere), the `?` shortcut, and the shortcuts dialog. Radix
 * overlays that handle a key themselves (Escape in a menu) keep it.
 */
export function ShortcutsProvider({
  portals,
  children,
}: Readonly<{ portals: readonly PortalNavigation[]; children: ReactNode }>) {
  const platform = useShortcutPlatform();
  return (
    <HotkeysProvider
      defaultOptions={{ platform, hotkey: { platform, ignoreDefaultPrevented: true } }}
    >
      <ShortcutsDialogHost portals={portals}>{children}</ShortcutsDialogHost>
    </HotkeysProvider>
  );
}
