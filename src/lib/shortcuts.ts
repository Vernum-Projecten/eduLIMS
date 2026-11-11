// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The keyboard shortcut registry. Every shortcut eduLIMS binds is defined here once, and both
// the bindings (TanStack Hotkeys) and every place that shows a shortcut (the portal switcher,
// `aria-keyshortcuts`, the keyboard shortcuts dialog) read it from here.
import {
  formatForDisplay,
  type HotkeyChord,
  type HotkeyPlatform,
  parseHotkey,
} from "@tanstack/react-hotkeys";
import { m } from "@/i18n/messages";

/**
 * Where a shortcut works: `global` on every signed-in page, `page` only on a page that
 * registers it (the search shortcut, `useRegisterSearchShortcut`).
 */
export type ShortcutScope = "global" | "page";

/** One action and the key presses that run it. */
export interface Shortcut {
  /** Stable id, such as `portal.1` or `search.focus`. */
  readonly id: string;
  /** The key presses, in the order the UI shows them; any one runs the action. */
  readonly hotkeys: readonly HotkeyChord[];
  readonly scope: ShortcutScope;
  /** The action's name in the active locale. */
  readonly label: () => string;
}

/**
 * Alt+1 to Alt+9 (⌥1 on macOS) open the user's portals in switcher order (ADR 0012). They
 * match the physical digit key (`event.code`), so they work on every keyboard layout and on
 * macOS, where Option+1 types a character. Browsers keep Ctrl+digit and ⌘+digit for tabs.
 */
export const PORTAL_HOTKEYS = [
  "Alt+[Digit1]",
  "Alt+[Digit2]",
  "Alt+[Digit3]",
  "Alt+[Digit4]",
  "Alt+[Digit5]",
  "Alt+[Digit6]",
  "Alt+[Digit7]",
  "Alt+[Digit8]",
  "Alt+[Digit9]",
] as const satisfies readonly HotkeyChord[];

/** The fixed shortcuts; the portal shortcuts come from {@link portalShortcut}. */
export const SHORTCUTS = {
  showShortcuts: {
    id: "help.shortcuts",
    hotkeys: ["?"],
    scope: "global",
    label: () => m.shortcut_show_shortcuts(),
  },
  focusSearch: {
    id: "search.focus",
    hotkeys: ["/", "Mod+K"],
    scope: "page",
    label: () => m.shortcut_focus_search(),
  },
} as const satisfies Record<string, Shortcut>;

/**
 * Returns the shortcut that opens the portal at `index` (0-based), or `null` past the ninth.
 *
 * @param portalLabel - the portal's name in the active locale
 */
export function portalShortcut(index: number, portalLabel: () => string): Shortcut | null {
  const hotkey = PORTAL_HOTKEYS[index];
  if (hotkey === undefined) return null;
  return {
    id: `portal.${index + 1}`,
    hotkeys: [hotkey],
    scope: "global",
    label: () => m.shortcut_open_portal({ portal: portalLabel() }),
  };
}

/** Returns whether a platform string (`navigator.userAgentData.platform`) is an Apple one. */
export function isApplePlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Returns the hotkey platform for a browser platform string: `Mod` is ⌘ on `mac`, else Ctrl. */
export function hotkeyPlatform(platform: string): HotkeyPlatform {
  if (isApplePlatform(platform)) return "mac";
  if (/^win/i.test(platform)) return "windows";
  return "linux";
}

/**
 * Returns the browser's platform string: `navigator.userAgentData.platform` where the browser
 * has it, else `navigator.platform`, else an empty string (on the server).
 */
export function browserPlatform(): string {
  if (typeof navigator === "undefined") return "";
  const data: unknown = Reflect.get(navigator, "userAgentData");
  const platform: unknown =
    typeof data === "object" && data !== null ? Reflect.get(data, "platform") : undefined;
  if (typeof platform === "string" && platform) return platform;
  return navigator.platform;
}

/** Returns the keys of `hotkey` as the user sees them: `["⌥", "1"]` on macOS, `["Alt", "1"]` else. */
export function shortcutKeys(hotkey: HotkeyChord, platform: HotkeyPlatform): string[] {
  return formatForDisplay(hotkey, { platform, parts: true });
}

/** Returns `hotkey` as one visible label: `⌥1` or `⌘K` on macOS, `Alt+1` or `Ctrl+K` else. */
export function shortcutLabel(hotkey: HotkeyChord, platform: HotkeyPlatform): string {
  return shortcutKeys(hotkey, platform).join(platform === "mac" ? "" : "+");
}

/**
 * Returns whether `hotkey` is a character key shortcut in the sense of WCAG 2.1.4: a letter,
 * digit, punctuation or symbol key without Ctrl, Alt or ⌘ (Shift does not count).
 */
export function isCharacterKeyShortcut(hotkey: HotkeyChord): boolean {
  const chord = parseHotkey(hotkey);
  return !chord.ctrl && !chord.alt && !chord.meta;
}

/**
 * Returns the `aria-keyshortcuts` value for `hotkeys` on `platform` (WAI-ARIA 1.2): the
 * modifiers by their `KeyboardEvent.key` names, then the key, with alternatives separated by
 * a space, such as `Alt+1` or `/ Meta+K`.
 */
export function ariaKeyShortcuts(
  hotkeys: readonly HotkeyChord[],
  platform: HotkeyPlatform,
): string {
  return hotkeys
    .map((hotkey) => {
      const chord = parseHotkey(hotkey, platform);
      const modifiers = [
        chord.ctrl ? "Control" : null,
        chord.alt ? "Alt" : null,
        chord.shift ? "Shift" : null,
        chord.meta ? "Meta" : null,
      ].filter((modifier) => modifier !== null);
      // The last display part is the key itself; a physical `[Digit1]` shows as `1`.
      const key = shortcutKeys(hotkey, platform).at(-1) ?? hotkey;
      return [...modifiers, key].join("+");
    })
    .join(" ");
}

/** The roles of an open overlay that owns the keyboard: a dialog, a sheet, a menu or a listbox. */
const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** Returns whether a dialog, sheet, menu or listbox is open in `doc`. */
export function isOverlayOpen(doc: Document): boolean {
  return doc.querySelector(OVERLAY_SELECTOR) !== null;
}
