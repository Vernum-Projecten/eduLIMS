// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  ariaKeyShortcuts,
  hotkeyPlatform,
  isApplePlatform,
  isCharacterKeyShortcut,
  isOverlayOpen,
  PORTAL_HOTKEYS,
  portalShortcut,
  SHORTCUTS,
  shortcutKeys,
  shortcutLabel,
} from "./shortcuts";

describe("isApplePlatform", () => {
  it.each([
    ["macOS", true],
    ["MacIntel", true],
    ["iPhone", true],
    ["iPad", true],
    ["Windows", false],
    ["Win32", false],
    ["Linux x86_64", false],
    ["Chrome OS", false],
    ["", false],
  ])("%j -> %j", (platform, apple) => {
    expect(isApplePlatform(platform)).toBe(apple);
  });
});

describe("hotkeyPlatform", () => {
  it.each([
    ["MacIntel", "mac"],
    ["macOS", "mac"],
    ["Win32", "windows"],
    ["Windows", "windows"],
    ["Linux x86_64", "linux"],
    ["", "linux"],
  ] as const)("%j -> %s", (platform, expected) => {
    expect(hotkeyPlatform(platform)).toBe(expected);
  });
});

describe("the registry's labels per platform", () => {
  it("shows the portal shortcuts as ⌥1 on macOS and Alt+1 elsewhere", () => {
    expect(shortcutLabel("Alt+[Digit1]", "mac")).toBe("⌥1");
    expect(shortcutLabel("Alt+[Digit2]", "windows")).toBe("Alt+2");
    expect(shortcutLabel("Alt+[Digit2]", "linux")).toBe("Alt+2");
  });

  it("shows Mod+K as ⌘K on macOS and Ctrl+K elsewhere", () => {
    expect(shortcutLabel("Mod+K", "mac")).toBe("⌘K");
    expect(shortcutLabel("Mod+K", "windows")).toBe("Ctrl+K");
    expect(shortcutKeys("Mod+K", "mac")).toEqual(["⌘", "K"]);
    expect(shortcutKeys("Mod+K", "windows")).toEqual(["Ctrl", "K"]);
  });

  it("shows ? and / as themselves on every platform", () => {
    for (const platform of ["mac", "windows", "linux"] as const) {
      expect(shortcutLabel("?", platform)).toBe("?");
      expect(shortcutLabel("/", platform)).toBe("/");
    }
  });
});

describe("ariaKeyShortcuts", () => {
  it("announces the portal shortcut as Alt+digit on every platform", () => {
    expect(ariaKeyShortcuts(["Alt+[Digit2]"], "mac")).toBe("Alt+2");
    expect(ariaKeyShortcuts(["Alt+[Digit1]"], "windows")).toBe("Alt+1");
  });

  it("resolves Mod to Meta on macOS and Control elsewhere, alternatives space-separated", () => {
    expect(ariaKeyShortcuts(SHORTCUTS.focusSearch.hotkeys, "mac")).toBe("/ Meta+K");
    expect(ariaKeyShortcuts(SHORTCUTS.focusSearch.hotkeys, "windows")).toBe("/ Control+K");
  });

  it("announces ? by its character", () => {
    expect(ariaKeyShortcuts(SHORTCUTS.showShortcuts.hotkeys, "mac")).toBe("?");
  });
});

describe("isCharacterKeyShortcut (WCAG 2.1.4)", () => {
  it("counts ? and / as character keys", () => {
    expect(isCharacterKeyShortcut("?")).toBe(true);
    expect(isCharacterKeyShortcut("/")).toBe(true);
  });

  it("does not count chords with Ctrl, Alt or ⌘", () => {
    expect(isCharacterKeyShortcut("Mod+K")).toBe(false);
    expect(isCharacterKeyShortcut("Alt+[Digit1]")).toBe(false);
  });
});

describe("portalShortcut", () => {
  it("gives the portal at each position its Alt+digit, with a translated label", () => {
    const shortcut = portalShortcut(1, () => "Admin portal");
    expect(shortcut?.id).toBe("portal.2");
    expect(shortcut?.hotkeys).toEqual(["Alt+[Digit2]"]);
    expect(shortcut?.scope).toBe("global");
    expect(shortcut?.label()).toBe("Go to the Admin portal");
  });

  it("stops after the ninth portal", () => {
    expect(PORTAL_HOTKEYS).toHaveLength(9);
    expect(portalShortcut(8, () => "Ninth")).not.toBeNull();
    expect(portalShortcut(9, () => "Tenth")).toBeNull();
  });
});

describe("isOverlayOpen", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("is false on a page without an open overlay", () => {
    document.body.innerHTML = "<main><input aria-label='Search'></main>";
    expect(isOverlayOpen(document)).toBe(false);
  });

  it.each(["dialog", "alertdialog", "menu", "listbox"])("is true with a %s open", (role) => {
    const overlay = document.createElement("div");
    overlay.setAttribute("role", role);
    document.body.append(overlay);
    expect(isOverlayOpen(document)).toBe(true);
  });
});
