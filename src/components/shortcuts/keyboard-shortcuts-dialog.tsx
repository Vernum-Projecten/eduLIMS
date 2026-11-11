// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { HotkeysProvider, useHotkeys } from "@tanstack/react-hotkeys";
import { Fragment, useId } from "react";
import { useCharacterKeyShortcuts } from "@/components/shortcuts/use-character-key-shortcuts";
import { useShortcutPlatform } from "@/components/shortcuts/use-shortcut-platform";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { m } from "@/i18n/messages";
import type { PortalNavigation } from "@/lib/navigation";
import {
  ariaKeyShortcuts,
  isCharacterKeyShortcut,
  portalShortcut,
  SHORTCUTS,
  type Shortcut,
  shortcutKeys,
} from "@/lib/shortcuts";

/** Returns every shortcut the signed-in user has: the portal shortcuts from two portals up. */
function shortcutsFor(portals: readonly PortalNavigation[]): Shortcut[] {
  const portalShortcuts =
    portals.length < 2
      ? []
      : portals
          .map((portal, index) => portalShortcut(index, portal.label))
          .filter((shortcut) => shortcut !== null);
  return [...portalShortcuts, SHORTCUTS.showShortcuts, SHORTCUTS.focusSearch];
}

function ShortcutRow({ shortcut }: Readonly<{ shortcut: Shortcut }>) {
  const platform = useShortcutPlatform();
  const spoken = shortcut.hotkeys
    .map((hotkey) => ariaKeyShortcuts([hotkey], platform))
    .join(` ${m.shortcuts_or()} `);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
      <dt>{shortcut.label()}</dt>
      <dd className="flex flex-wrap items-center gap-1.5">
        {shortcut.hotkeys.map((hotkey, index) => (
          <Fragment key={hotkey}>
            {index > 0 && (
              <span aria-hidden="true" className="text-xs text-muted-foreground">
                {m.shortcuts_or()}
              </span>
            )}
            <KbdGroup aria-hidden="true">
              {shortcutKeys(hotkey, platform).map((key) => (
                <Kbd key={key} className="text-foreground">
                  {key}
                </Kbd>
              ))}
            </KbdGroup>
          </Fragment>
        ))}
        <span className="sr-only">{spoken}</span>
      </dd>
    </div>
  );
}

/** The dialog's body, inside its own exclusive hotkey scope. */
function ShortcutsBody({
  portals,
  onClose,
}: Readonly<{ portals: readonly PortalNavigation[]; onClose: () => void }>) {
  const [characterKeys, setCharacterKeys] = useCharacterKeyShortcuts();
  const switchId = useId();
  const descriptionId = useId();
  // The keys that opened the dialog close it again; the page's shortcuts are suspended.
  useHotkeys(
    SHORTCUTS.showShortcuts.hotkeys.map((hotkey) => ({
      hotkey,
      callback: onClose,
      options: { enabled: characterKeys || !isCharacterKeyShortcut(hotkey) },
    })),
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>{m.shortcuts_dialog_title()}</DialogTitle>
        <DialogDescription>{m.shortcuts_dialog_description()}</DialogDescription>
      </DialogHeader>
      <dl className="divide-y">
        {shortcutsFor(portals).map((shortcut) => (
          <ShortcutRow key={shortcut.id} shortcut={shortcut} />
        ))}
      </dl>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor={switchId}>{m.shortcuts_character_keys_label()}</FieldLabel>
          <FieldDescription id={descriptionId}>
            {m.shortcuts_character_keys_description()}
          </FieldDescription>
        </FieldContent>
        <Switch
          id={switchId}
          checked={characterKeys}
          onCheckedChange={setCharacterKeys}
          aria-describedby={descriptionId}
        />
      </Field>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">{m.shortcuts_close()}</Button>
        </DialogClose>
      </DialogFooter>
    </>
  );
}

/**
 * The keyboard shortcuts dialog (`?`): every shortcut from the registry, with the keys of the
 * user's platform, and the switch that turns single-key shortcuts off (WCAG 2.1.4). While it is
 * open it owns the keyboard through an exclusive hotkey scope.
 */
export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
  portals,
  returnFocus,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portals: readonly PortalNavigation[];
  /** The element that gets focus back on close, when the opener is gone (a menu item). */
  returnFocus: () => HTMLElement | null;
}>) {
  const scope = `shortcuts-dialog-${useId()}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        onCloseAutoFocus={(event) => {
          const target = returnFocus();
          if (!target?.isConnected) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <HotkeysProvider scope={scope} exclusive>
          <ShortcutsBody portals={portals} onClose={() => onOpenChange(false)} />
        </HotkeysProvider>
      </DialogContent>
    </Dialog>
  );
}
