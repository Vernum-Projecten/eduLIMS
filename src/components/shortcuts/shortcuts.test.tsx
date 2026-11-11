// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import { HotkeyManager, type HotkeyPlatform, HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { usePortalShortcuts } from "@/components/shell/use-switch-portal";
import { useCharacterKeyShortcuts } from "@/components/shortcuts/use-character-key-shortcuts";
import { useRegisterSearchShortcut } from "@/components/shortcuts/use-register-search-shortcut";
import { type PortalNavigation, portalNavigation } from "@/lib/navigation";

const navigate = vi.fn(async () => {});
const save = vi.fn(async () => ({ portal: "admin" }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => save }));
vi.mock("@/server/preferences/functions", () => ({ saveLastPortal: {} }));
vi.mock("@/lib/session.functions", () => ({ getSession: vi.fn() }));

const TEACHER = portalNavigation("teacher");
const ADMIN = portalNavigation("admin");

interface Press {
  key: string;
  code: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
}

/** Dispatches a key press on `target` (the focused element) and returns whether it was prevented. */
function press(init: Press, target: EventTarget = document.body): boolean {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, ...init }));
  return event.defaultPrevented;
}

const altDigit = (digit: number, extra: Partial<Press> = {}): Press => ({
  key: String(digit),
  code: `Digit${digit}`,
  altKey: true,
  ...extra,
});

function Portals({ portals }: Readonly<{ portals: readonly PortalNavigation[] }>) {
  usePortalShortcuts(portals, portals.at(0) ?? null);
  return null;
}

function renderWith(platform: HotkeyPlatform, children: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <HotkeysProvider defaultOptions={{ platform }}>{children}</HotkeysProvider>
    </QueryClientProvider>,
  );
}

/** Appends an element outside React's tree for focus and typing targets. */
function append<T extends HTMLElement>(element: T): T {
  document.body.append(element);
  return element;
}

// jsdom lacks `isContentEditable`, which browsers derive from the inherited attribute.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
    configurable: true,
    get(this: HTMLElement) {
      return this.closest("[contenteditable]:not([contenteditable='false'])") !== null;
    },
  });
});

beforeEach(() => {
  navigate.mockClear();
  save.mockClear();
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  window.localStorage.clear();
  HotkeyManager.resetInstance();
});

describe("portal shortcuts (Alt+digit, ⌥digit on macOS)", () => {
  it.each(["mac", "windows"] as const)(
    "open the portal at that position on %s",
    async (platform) => {
      renderWith(platform, <Portals portals={[TEACHER, ADMIN]} />);
      expect(press(altDigit(2))).toBe(true);
      expect(navigate).toHaveBeenCalledWith({ to: "/admin" });
      // The save is a mutation now: it runs after its optimistic write, a tick later.
      await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ data: { portal: "admin" } }));
    },
  );

  it("match the physical key, so ⌥2 on macOS (key ™) still opens the second portal", () => {
    renderWith("mac", <Portals portals={[TEACHER, ADMIN]} />);
    press({ key: "™", code: "Digit2", altKey: true });
    expect(navigate).toHaveBeenCalledWith({ to: "/admin" });
  });

  it("swallow the key but do not navigate for the current portal", () => {
    renderWith("windows", <Portals portals={[TEACHER, ADMIN]} />);
    expect(press(altDigit(1))).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("leave a digit beyond the user's portals, the numpad and other keys to the browser", () => {
    renderWith("windows", <Portals portals={[TEACHER, ADMIN]} />);
    expect(press(altDigit(3))).toBe(false);
    expect(press({ key: "1", code: "Numpad1", altKey: true })).toBe(false);
    expect(press({ key: "a", code: "KeyA", altKey: true })).toBe(false);
    expect(press({ key: "0", code: "Digit0", altKey: true })).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([[{ altKey: false }], [{ ctrlKey: true }], [{ metaKey: true }], [{ shiftKey: true }]])(
    "ignore Alt+2 with %j",
    (overrides) => {
      renderWith("windows", <Portals portals={[TEACHER, ADMIN]} />);
      press(altDigit(2, overrides));
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  it("fire once while the keys are held (key repeat)", () => {
    renderWith("windows", <Portals portals={[TEACHER, ADMIN]} />);
    const down = (repeat: boolean) =>
      act(() => {
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...altDigit(2), repeat }),
        );
      });
    down(false);
    down(true);
    down(true);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("are off with one portal", () => {
    renderWith("windows", <Portals portals={[TEACHER]} />);
    expect(press(altDigit(1))).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(["input", "textarea", "select"])("do nothing while focus is in a %s", (tag) => {
    renderWith("windows", <Portals portals={[TEACHER, ADMIN]} />);
    const field = append(document.createElement(tag));
    field.focus();
    press(altDigit(2), field);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("do nothing in a contenteditable element, but work in a non-editable one", () => {
    renderWith("windows", <Portals portals={[TEACHER, ADMIN]} />);
    const editable = append(document.createElement("div"));
    editable.setAttribute("contenteditable", "true");
    const inner = document.createElement("span");
    editable.append(inner);
    press(altDigit(2), inner);
    expect(navigate).not.toHaveBeenCalled();

    const fixed = append(document.createElement("div"));
    fixed.setAttribute("contenteditable", "false");
    press(altDigit(2), fixed);
    expect(navigate).toHaveBeenCalledWith({ to: "/admin" });
  });
});

function SearchPage() {
  const ref = useRef<HTMLInputElement>(null);
  const props = useRegisterSearchShortcut(ref);
  return <input ref={ref} type="search" aria-label="Search" {...props} />;
}

function CharacterKeysSwitch() {
  const [, setEnabled] = useCharacterKeyShortcuts();
  return (
    <>
      <button type="button" onClick={() => setEnabled(false)}>
        off
      </button>
      <button type="button" onClick={() => setEnabled(true)}>
        on
      </button>
    </>
  );
}

const slash: Press = { key: "/", code: "Slash" };

describe("useRegisterSearchShortcut (/ and Mod+K)", () => {
  function search(): HTMLInputElement {
    const field = document.querySelector<HTMLInputElement>("input[type=search]");
    if (!field) throw new Error("no search field");
    return field;
  }

  it("focuses the search field with /", () => {
    renderWith("windows", <SearchPage />);
    expect(press(slash)).toBe(true);
    expect(document.activeElement).toBe(search());
  });

  it("focuses it with ⌘K on macOS and Ctrl+K elsewhere", () => {
    const mac = renderWith("mac", <SearchPage />);
    press({ key: "k", code: "KeyK", ctrlKey: true });
    expect(document.activeElement).not.toBe(search());
    press({ key: "k", code: "KeyK", metaKey: true });
    expect(document.activeElement).toBe(search());
    mac.unmount();
    HotkeyManager.resetInstance();

    renderWith("windows", <SearchPage />);
    press({ key: "k", code: "KeyK", ctrlKey: true });
    expect(document.activeElement).toBe(search());
  });

  it("announces the shortcuts on the field for the platform", () => {
    renderWith("mac", <SearchPage />);
    expect(search().getAttribute("aria-keyshortcuts")).toBe("/ Meta+K");
  });

  it.each(["input", "textarea", "select"])("never fires while focus is in a %s", (tag) => {
    renderWith("windows", <SearchPage />);
    const field = append(document.createElement(tag));
    field.focus();
    expect(press(slash, field)).toBe(false);
    press({ key: "k", code: "KeyK", ctrlKey: true }, field);
    expect(document.activeElement).toBe(field);
  });

  it("never fires in a contenteditable element", () => {
    renderWith("windows", <SearchPage />);
    const editable = append(document.createElement("div"));
    editable.setAttribute("contenteditable", "true");
    editable.focus();
    expect(press(slash, editable)).toBe(false);
    expect(document.activeElement).not.toBe(search());
  });

  it.each(["dialog", "menu"])("never fires while a %s is open, and keeps the key", (role) => {
    renderWith("windows", <SearchPage />);
    append(document.createElement("div")).setAttribute("role", role);
    expect(press(slash)).toBe(false);
    press({ key: "k", code: "KeyK", ctrlKey: true });
    expect(document.activeElement).not.toBe(search());
  });

  it("leaves / to the browser when single-key shortcuts are off, Mod+K keeps working", () => {
    const { getByRole } = renderWith(
      "windows",
      <>
        <SearchPage />
        <CharacterKeysSwitch />
      </>,
    );
    act(() => getByRole("button", { name: "off" }).click());
    expect(press(slash)).toBe(false);
    expect(document.activeElement).not.toBe(search());
    expect(search().getAttribute("aria-keyshortcuts")).toBe("Control+K");
    press({ key: "k", code: "KeyK", ctrlKey: true });
    expect(document.activeElement).toBe(search());
    act(() => getByRole("button", { name: "on" }).click());
    expect(search().getAttribute("aria-keyshortcuts")).toBe("/ Control+K");
  });
});
