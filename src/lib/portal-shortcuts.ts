// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The portal switcher's keyboard shortcuts (ADR 0012): Alt+1 to Alt+9 (⌥1 on macOS) open the
// user's portals in switcher order. Browsers keep Ctrl+digit and ⌘+digit for switching tabs.

/** The most portals a shortcut can reach (Digit1 to Digit9). */
export const MAX_PORTAL_SHORTCUTS = 9;

/** Returns whether a platform string (`navigator.userAgentData.platform`) is an Apple one. */
export function isApplePlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
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

/** Returns the shortcut of the portal at `index` (0-based) for `aria-keyshortcuts`. */
export function portalAriaShortcut(index: number): string {
  return `Alt+${index + 1}`;
}

/** Returns the visible shortcut of the portal at `index` (0-based): `⌥1` on Apple, else `Alt+1`. */
export function portalShortcutLabel(index: number, apple: boolean): string {
  return apple ? `⌥${index + 1}` : `Alt+${index + 1}`;
}

/** The parts of a `KeyboardEvent` the shortcut reads. */
export interface ShortcutKeyEvent {
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  target: EventTarget | null;
}

/** Returns whether `target` takes text input, where Alt+digit types a character instead. */
function isEditable(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  if (target.closest("input, textarea, select")) return true;
  return target.closest("[contenteditable]:not([contenteditable='false'])") !== null;
}

/**
 * Returns the 0-based portal index an Alt+digit key press asks for, or `null` when the event is
 * not a portal shortcut: another modifier held, a repeat, or focus in a text field. Reads
 * `event.code` (Digit1 to Digit9), so it works on every keyboard layout without the numpad.
 */
export function portalShortcutIndex(event: ShortcutKeyEvent, portalCount: number): number | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) {
    return null;
  }
  const match = /^Digit([1-9])$/.exec(event.code);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  if (index >= Math.min(portalCount, MAX_PORTAL_SHORTCUTS)) return null;
  if (isEditable(event.target)) return null;
  return index;
}
