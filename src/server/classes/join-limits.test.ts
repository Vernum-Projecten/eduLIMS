// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { JOIN_LIMITS, JoinFailureLimiter, type JoinLimits, type LimitKey } from "./join-limits.ts";

const LIMITS: JoinLimits = {
  user: { maxFailures: 3, windowMs: 1_000 },
  ip: { maxFailures: 5, windowMs: 2_000 },
  maxKeys: 10,
};

const user = (id: string): LimitKey => ({ kind: "user", id });
const ip = (address: string): LimitKey => ({ kind: "ip", address });

describe("JoinFailureLimiter (#49, ASVS V2.4.1)", () => {
  it("blocks a user after their limit of wrong codes and reports the moment once", () => {
    const limiter = new JoinFailureLimiter(LIMITS);
    expect(limiter.fail([user("a")], 0)).toBe(false);
    expect(limiter.fail([user("a")], 1)).toBe(false);
    expect(limiter.blocked([user("a")], 2)).toBe(false);
    expect(limiter.fail([user("a")], 2)).toBe(true);
    expect(limiter.blocked([user("a")], 3)).toBe(true);
    expect(limiter.fail([user("a")], 3)).toBe(false);
  });

  it("forgets a window once it has passed", () => {
    const limiter = new JoinFailureLimiter(LIMITS);
    for (const at of [0, 1, 2]) limiter.fail([user("a")], at);
    expect(limiter.blocked([user("a")], 999)).toBe(true);
    expect(limiter.blocked([user("a")], 1_000)).toBe(false);
    expect(limiter.fail([user("a")], 1_000)).toBe(false);
    expect(limiter.blocked([user("a")], 1_001)).toBe(false);
  });

  it("blocks an address across users, and leaves another user and address alone", () => {
    const limiter = new JoinFailureLimiter(LIMITS);
    for (const [at, id] of ["a", "b", "c", "a", "b"].entries()) {
      limiter.fail([user(id), ip("192.0.2.1")], at);
    }
    expect(limiter.blocked([user("d"), ip("192.0.2.1")], 10)).toBe(true);
    expect(limiter.blocked([user("d"), ip("192.0.2.2")], 10)).toBe(false);
    expect(limiter.blocked([user("c")], 10)).toBe(false);
  });

  it("keeps the user and the address apart even when the strings match", () => {
    const limiter = new JoinFailureLimiter(LIMITS);
    for (const at of [0, 1, 2]) limiter.fail([user("x")], at);
    expect(limiter.blocked([ip("x")], 3)).toBe(false);
  });

  it("fails closed when it tracks as many live keys as it may", () => {
    const limiter = new JoinFailureLimiter({ ...LIMITS, maxKeys: 4 });
    for (const id of ["a", "b", "c", "d"]) limiter.fail([user(id)], 0);
    expect(limiter.blocked([user("e")], 10)).toBe(true);
    expect(limiter.fail([user("e")], 10)).toBe(false);
    // Once the windows have passed they are pruned and a new key gets in.
    expect(limiter.blocked([user("e")], 5_000)).toBe(false);
  });

  it("reaches the limit on the first failure when the limit is one", () => {
    const limiter = new JoinFailureLimiter({ ...LIMITS, user: { maxFailures: 1, windowMs: 10 } });
    expect(limiter.fail([user("a")], 0)).toBe(true);
  });

  it("allows a lab of students behind one address more wrong codes than one student", () => {
    expect(JOIN_LIMITS.ip.maxFailures).toBeGreaterThan(JOIN_LIMITS.user.maxFailures);
  });
});
