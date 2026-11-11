// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useHotkeys } from "@tanstack/react-hotkeys";
import type { RefObject } from "react";
import { useCharacterKeyShortcuts } from "@/components/shortcuts/use-character-key-shortcuts";
import { useShortcutPlatform } from "@/components/shortcuts/use-shortcut-platform";
import {
  ariaKeyShortcuts,
  isCharacterKeyShortcut,
  isOverlayOpen,
  SHORTCUTS,
} from "@/lib/shortcuts";

/**
 * Makes `/` and `Mod+K` (⌘K on macOS, Ctrl+K elsewhere) focus the page's primary search field
 * while the calling component is mounted. Neither fires while focus is in a text field, select
 * or contenteditable, nor while a dialog or menu is open; `/` stays off when the user turned
 * single-key shortcuts off. Spread the returned props on the search input so assistive
 * technology announces the shortcut.
 *
 * @example
 * ```tsx
 * const searchRef = useRef<HTMLInputElement>(null);
 * const shortcutProps = useRegisterSearchShortcut(searchRef);
 * return <Input ref={searchRef} type="search" {...shortcutProps} />;
 * ```
 */
export function useRegisterSearchShortcut(ref: RefObject<HTMLInputElement | null>): {
  "aria-keyshortcuts": string | undefined;
} {
  const [characterKeys] = useCharacterKeyShortcuts();
  const platform = useShortcutPlatform();
  const { hotkeys, label } = SHORTCUTS.focusSearch;
  const active = hotkeys.filter((hotkey) => characterKeys || !isCharacterKeyShortcut(hotkey));

  useHotkeys(
    hotkeys.map((hotkey) => ({
      hotkey,
      callback: (event: KeyboardEvent) => {
        const field = ref.current;
        if (!field || isOverlayOpen(document)) return;
        event.preventDefault();
        field.focus();
        field.select();
      },
      options: {
        enabled: active.includes(hotkey),
        // Mod chords fire in fields by default; this one must not.
        ignoreInputs: true,
        // Prevented in the callback, so a key it does not act on keeps its default.
        preventDefault: false,
        meta: { name: label() },
      },
    })),
  );

  return { "aria-keyshortcuts": active.length ? ariaKeyShortcuts(active, platform) : undefined };
}
