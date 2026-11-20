// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  LOGO_MAX_BYTES,
  LOGO_MAX_SIDE,
  labLogoPath,
  labLogoSrc,
  precheckLogoFile,
} from "./lab-logo.ts";

describe("the lab logo (#292)", () => {
  it("holds the limits the maintainer set on #280", () => {
    expect(LOGO_MAX_BYTES).toBe(524_288);
    expect(LOGO_MAX_SIDE).toBe(1024);
  });

  it("builds the path the server route answers, encoding the id", () => {
    expect(labLogoPath("0190f2a0-0000-7000-8000-000000000001")).toBe(
      "/api/labs/0190f2a0-0000-7000-8000-000000000001/logo",
    );
    expect(labLogoPath("../x")).toBe("/api/labs/..%2Fx/logo");
  });
});

describe("labLogoSrc (#293)", () => {
  it("adds the logo's version, so a replaced logo is a new address", () => {
    const id = "0190f2a0-0000-7000-8000-000000000001";
    expect(labLogoSrc(id, "0a1b2c3d4e5f6a7b")).toBe(`/api/labs/${id}/logo?v=0a1b2c3d4e5f6a7b`);
    expect(labLogoSrc(id, "a&b")).toBe(`/api/labs/${id}/logo?v=a%26b`);
  });
});

describe("precheckLogoFile (#293: the browser's check before the upload)", () => {
  it.each(["image/png", "image/jpeg"])("passes a %s at the size limit", (type) => {
    expect(precheckLogoFile({ type, size: LOGO_MAX_BYTES })).toBeNull();
  });

  it.each(["image/svg+xml", "image/gif", "image/webp", "text/plain", ""])(
    "refuses the declared type %s",
    (type) => {
      expect(precheckLogoFile({ type, size: 10 })).toBe("logo_unsupported_type");
    },
  );

  it("refuses one byte over the size limit", () => {
    expect(precheckLogoFile({ type: "image/png", size: LOGO_MAX_BYTES + 1 })).toBe(
      "logo_too_large",
    );
  });
});
