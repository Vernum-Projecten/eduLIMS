// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { summariseUserAgent } from "./user-agent.ts";

describe("summariseUserAgent", () => {
  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/139.0", "Firefox", "Windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Safari/605.1.15", "Safari", "macOS"],
    ["Mozilla/5.0 (X11; Linux x86_64) Chrome/138.0 Safari/537.36", "Chrome", "Linux"],
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/138.0 Safari/537.36 Edg/138.0", "Edge", "Windows"],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/138.0 Safari/604.1",
      "Chrome",
      "iOS",
    ],
    ["Mozilla/5.0 (Linux; Android 15) Chrome/138.0 Mobile Safari/537.36", "Chrome", "Android"],
  ])("%s is %s on %s", (agent, browser, os) => {
    expect(summariseUserAgent(agent)).toEqual({ browser, os });
  });

  it("returns nulls for a missing or unknown agent", () => {
    expect(summariseUserAgent(null)).toEqual({ browser: null, os: null });
    expect(summariseUserAgent("curl/8.0")).toEqual({ browser: null, os: null });
  });
});
