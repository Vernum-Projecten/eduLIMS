// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { clientIpOf } from "./client-ip.ts";

const headers = (forwarded: string) => new Headers({ "x-forwarded-for": forwarded });

describe("clientIpOf (#45, #49)", () => {
  it("trusts no forwarded header when no proxy is listed", () => {
    expect(clientIpOf(headers("192.0.2.10"), [])).toBeNull();
    expect(clientIpOf(headers("198.51.100.7, 10.0.0.5"), [])).toBeNull();
  });

  it("walks the chain right to left past the listed proxies", () => {
    expect(clientIpOf(headers("203.0.113.9, 198.51.100.7, 10.0.0.5"), ["10.0.0.0/8"])).toBe(
      "198.51.100.7",
    );
  });

  it("ignores an address the client put in front of the chain", () => {
    expect(clientIpOf(headers("1.2.3.4, 198.51.100.7, 10.0.0.5"), ["10.0.0.5"])).toBe(
      "198.51.100.7",
    );
  });

  it("is null without a forwarded header, also in development and tests", () => {
    expect(clientIpOf(new Headers(), ["10.0.0.0/8"])).toBeNull();
  });

  it("is null when the chain holds only trusted proxies or a malformed hop", () => {
    expect(clientIpOf(headers("10.0.0.6, 10.0.0.5"), ["10.0.0.0/8"])).toBeNull();
    expect(clientIpOf(headers("not-an-ip, 10.0.0.5"), ["10.0.0.0/8"])).toBeNull();
  });
});
