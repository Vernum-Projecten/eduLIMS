// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { LOGO_MAX_BYTES, LOGO_MAX_SIDE, labLogoPath } from "./lab-logo.ts";

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
