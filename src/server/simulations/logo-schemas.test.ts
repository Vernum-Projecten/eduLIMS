// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The input of the logo upload (E1, #292): a form with a lab id and one file, refused before the
// handler for anything else. The file's name and declared type pass through unread.
import { describe, expect, it } from "vitest";
import { LOGO_MAX_BYTES } from "../../lib/lab-logo.ts";
import { LOGO_FORM_FIELDS, logoFormSchema, uploadLogoInput } from "./logo-schemas.ts";

const LAB = "0190f2a0-0000-7000-8000-000000000001";

function form(entries: [string, string | File][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("uploadLogoInput", () => {
  it("takes the lab id and the file", () => {
    const file = new File([Uint8Array.of(1, 2)], "../../etc/passwd.svg", { type: "image/svg+xml" });
    const parsed = uploadLogoInput.parse(
      form([
        [LOGO_FORM_FIELDS.labId, LAB],
        [LOGO_FORM_FIELDS.file, file],
      ]),
    );
    expect(parsed.labId).toBe(LAB);
    expect(parsed.file.size).toBe(2);
  });

  it.each<[string, unknown]>([
    ["a JSON object in place of a form", { labId: LAB }],
    ["a form without a file", form([[LOGO_FORM_FIELDS.labId, LAB]])],
    [
      "a form with text in place of the file",
      form([
        [LOGO_FORM_FIELDS.labId, LAB],
        [LOGO_FORM_FIELDS.file, "x"],
      ]),
    ],
    [
      "a form with a malformed lab id",
      form([
        [LOGO_FORM_FIELDS.labId, "lab-1"],
        [LOGO_FORM_FIELDS.file, new File([], "a.png")],
      ]),
    ],
    ["a form without a lab id", form([[LOGO_FORM_FIELDS.file, new File([], "a.png")]])],
  ])("refuses %s", (_name, input) => {
    expect(uploadLogoInput.safeParse(input).success).toBe(false);
  });
});

describe("logoFormSchema (#293: the browser's check before the upload)", () => {
  function issues(file: File | null): string[] {
    const parsed = logoFormSchema.safeParse({ file });
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
  }

  it.each(["image/png", "image/jpeg"])("passes a %s file", (type) => {
    expect(issues(new File([Uint8Array.of(1)], "logo", { type }))).toEqual([]);
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
