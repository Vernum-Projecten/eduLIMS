// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The application's toast (#328): an error stays until it is closed and has a close button
// (WCAG 2.2.1, 3.3.1); every other kind keeps Sonner's timing; nothing takes Sonner's own.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const sonner = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock("sonner", () => sonner);

const { toast } = await import("./toast");

describe("toast", () => {
  it("keeps an error until it is closed, with a close button", () => {
    toast.error("Refused");
    expect(sonner.toast.error).toHaveBeenCalledWith("Refused", {
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
    });
  });

  it("lets a caller still set its own options on an error", () => {
    toast.error("Refused", { id: "one" });
    expect(sonner.toast.error).toHaveBeenLastCalledWith("Refused", {
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
      id: "one",
    });
  });

  it("leaves a success toast at Sonner's own timing", () => {
    toast.success("Saved");
    expect(sonner.toast.success).toHaveBeenCalledWith("Saved");
  });

  it("passes a plain toast through", () => {
    toast("Note");
    expect(sonner.toast).toHaveBeenCalledWith("Note");
  });
});

describe("the toast import", () => {
  const SRC = join(import.meta.dirname, "..");
  // The generated message modules are skipped: they never import a library.
  const files = readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter(
    (path) => /\.(ts|tsx)$/.test(path) && !path.startsWith("i18n") && !path.endsWith(".gen.ts"),
  );
  const allowed = new Set([join("lib", "toast.ts"), join("components", "ui", "sonner.tsx")]);

  it("takes `toast` from src/lib/toast.ts, never from Sonner directly", () => {
    const direct = files.filter(
      (path) =>
        !allowed.has(path) &&
        !path.endsWith(".test.ts") &&
        /\btoast\b[^;]*from\s+["']sonner["']/.test(readFileSync(join(SRC, path), "utf8")),
    );
    expect(direct).toEqual([]);
  });
});
