// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useSyncExternalStore } from "react";

// NOTE: WCAG 2.1.4 (Character Key Shortcuts): `?` and `/` need a way to turn them off.
const STORAGE_KEY = "edulims.characterKeyShortcuts";
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** On unless this browser stored "off"; storage that cannot be read leaves them on. */
function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function writeEnabled(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, "off");
  } catch {
    // Storage blocked: the choice holds until the page reloads.
  }
}

/** The choice made on this page, which wins over storage that could not be written. */
let chosen: boolean | null = null;

/**
 * Returns whether single-key shortcuts (`?`, `/`) are on in this browser, and a setter. The
 * choice is a per-browser convenience kept in `localStorage`; the server renders them on.
 */
export function useCharacterKeyShortcuts(): readonly [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(
    subscribe,
    () => chosen ?? readEnabled(),
    () => true,
  );
  const setEnabled = useCallback((next: boolean) => {
    writeEnabled(next);
    chosen = next;
    for (const listener of listeners) listener();
  }, []);
  return [enabled, setEnabled] as const;
}
