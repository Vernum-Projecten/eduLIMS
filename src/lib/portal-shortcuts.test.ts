// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  isApplePlatform,
  portalAriaShortcut,
  portalShortcutIndex,
  portalShortcutLabel,
  type ShortcutKeyEvent,
} from "./portal-shortcuts";

function key(overrides: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return {
    code: "Digit2",
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    target: document.body,
    ...overrides,
  };
}

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

describe("shortcut labels", () => {
  it("shows ⌥ on Apple platforms and Alt elsewhere, and announces Alt+digit", () => {
    expect(portalShortcutLabel(0, true)).toBe("⌥1");
    expect(portalShortcutLabel(1, false)).toBe("Alt+2");
    expect(portalAriaShortcut(1)).toBe("Alt+2");
  });
});

describe("portalShortcutIndex", () => {
  it("reads Alt+digit by its physical key (event.code)", () => {
    expect(portalShortcutIndex(key({ code: "Digit1" }), 2)).toBe(0);
    expect(portalShortcutIndex(key({ code: "Digit2" }), 2)).toBe(1);
  });

  it("ignores a digit beyond the user's portals, the numpad and other keys", () => {
    expect(portalShortcutIndex(key({ code: "Digit3" }), 2)).toBeNull();
    expect(portalShortcutIndex(key({ code: "Numpad1" }), 2)).toBeNull();
    expect(portalShortcutIndex(key({ code: "KeyA" }), 2)).toBeNull();
    expect(portalShortcutIndex(key({ code: "Digit0" }), 2)).toBeNull();
  });

  it.each([
    [{ altKey: false }],
    [{ ctrlKey: true }],
    [{ metaKey: true }],
    [{ shiftKey: true }],
    [{ repeat: true }],
  ])("ignores %j", (overrides) => {
    expect(portalShortcutIndex(key(overrides), 2)).toBeNull();
  });

  it.each(["input", "textarea", "select"])("does nothing while focus is in a %s", (tag) => {
    const field = document.createElement(tag);
    document.body.append(field);
    expect(portalShortcutIndex(key({ target: field }), 2)).toBeNull();
    field.remove();
  });

  it("does nothing in a contenteditable element, but works in a non-editable one", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const inner = document.createElement("span");
    editable.append(inner);
    const fixed = document.createElement("div");
    fixed.setAttribute("contenteditable", "false");
    document.body.append(editable, fixed);
    expect(portalShortcutIndex(key({ target: inner }), 2)).toBeNull();
    expect(portalShortcutIndex(key({ target: fixed }), 2)).toBe(1);
    editable.remove();
    fixed.remove();
  });
});
