// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The browser's check of a chosen logo before it is sent (#293): a file is required, an SVG is
// refused by its declared type, a file over 512 KiB by its size, and a file the browser gives no
// type is left to the server, which reads the content.
import { describe, expect, it } from "vitest";
import { LOGO_MAX_BYTES } from "@/lib/lab-logo";
import { logoFormSchema } from "./logo-form-schema";

function issues(file: File | null): string[] {
  const parsed = logoFormSchema.safeParse({ file });
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

describe("logoFormSchema (#293)", () => {
  it.each(["image/png", "image/jpeg"])("passes a %s file", (type) => {
    expect(issues(new File([Uint8Array.of(1)], "logo", { type }))).toEqual([]);
  });

  it("passes a file the browser gives no type, for the server to judge", () => {
    expect(issues(new File([Uint8Array.of(0x89, 0x50)], "logo"))).toEqual([]);
  });

  it("asks for a file when none is chosen", () => {
    expect(issues(null)).toEqual(["Choose a PNG or JPEG image."]);
  });

  it("refuses an SVG by its declared type, with the refusal message of the server", () => {
    expect(issues(new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }))).toEqual([
      "This file is not a PNG or JPEG image. SVG, GIF and WebP are not accepted.",
    ]);
  });

  it("refuses a file one byte over 512 KiB", () => {
    const file = new File([new Uint8Array(LOGO_MAX_BYTES + 1)], "logo.png", { type: "image/png" });
    expect(issues(file)).toEqual(["This file is larger than 512 KiB. Choose a smaller file."]);
  });

  it("passes a file of exactly 512 KiB", () => {
    const file = new File([new Uint8Array(LOGO_MAX_BYTES)], "logo.png", { type: "image/png" });
    expect(issues(file)).toEqual([]);
  });
});
