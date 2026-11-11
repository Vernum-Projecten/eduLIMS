// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type HotkeyPlatform, useDefaultHotkeysOptions } from "@tanstack/react-hotkeys";
import { useSyncExternalStore } from "react";
import { browserPlatform, hotkeyPlatform } from "@/lib/shortcuts";

const noSubscription = () => () => {};

/**
 * Returns the platform shortcuts resolve and display for: `mac` shows ⌥ and ⌘, `windows` and
 * `linux` show Alt and Ctrl. Inside a `HotkeysProvider` that sets one, that platform; else the
 * browser's. The server and the hydration pass render the non-Apple labels; the client corrects
 * them after.
 */
export function useShortcutPlatform(): HotkeyPlatform {
  const provided = useDefaultHotkeysOptions().platform;
  const detected = useSyncExternalStore(
    noSubscription,
    () => hotkeyPlatform(browserPlatform()),
    (): HotkeyPlatform => "linux",
  );
  return provided ?? detected;
}
