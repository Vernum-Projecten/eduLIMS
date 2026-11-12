// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { SeedSummary } from "./seed-demo.ts";
import { formatSeedReport } from "./seed-report.ts";

const SUMMARY: SeedSummary = {
  usersByRole: { student: 61, teacher: 9, admin: 3 },
  accountsByProvider: { credential: 20, keycloak: 4 },
  activeSessions: 12,
  expiredSessions: 3,
  blockedUsers: 2,
  auditEvents: 140,
  classes: 7,
  archivedClasses: 1,
  classMembers: 48,
  pendingInvitations: 5,
  labGroups: 6,
};

function lines(text: string): string[] {
  return text.split("\n");
}

describe("the seed summary (#192)", () => {
  it("prints one line per count, in a fixed order", () => {
    const text = formatSeedReport({ demoCreated: true, devClassesCreated: true, summary: SUMMARY });
    expect(lines(text).slice(0, 8)).toEqual([
      "created demo data",
      "created dev-account classes (LS-3A, LS-3B, LS-3A archived)",
      "  users by role:       student 61, teacher 9, admin 3",
      "  accounts:            credential 20, keycloak 4",
      "  sessions:            12 active, 3 expired",
      "  blocked users:       2",
      "  activity-log events: 140",
      "  classes:             7 (1 archived), 48 members, 6 lab groups, 5 pending invitations",
    ]);
  });

  it("says 'exists' for the parts an earlier run created", () => {
    const text = formatSeedReport({
      demoCreated: false,
      devClassesCreated: false,
      summary: SUMMARY,
    });
    expect(lines(text).slice(0, 2)).toEqual([
      "exists  demo data",
      "exists  dev-account classes (LS-3A, LS-3B, LS-3A archived)",
    ]);
  });

  it("tells each part apart when only one was created", () => {
    const text = formatSeedReport({
      demoCreated: false,
      devClassesCreated: true,
      summary: SUMMARY,
    });
    expect(lines(text).slice(0, 2)).toEqual([
      "exists  demo data",
      "created dev-account classes (LS-3A, LS-3B, LS-3A archived)",
    ]);
  });

  it("ends with the note on how the demo people sign in, and a newline", () => {
    const text = formatSeedReport({ demoCreated: true, devClassesCreated: true, summary: SUMMARY });
    expect(text.endsWith("Use the dev-login and Keycloak demo accounts above.\n")).toBe(true);
    expect(lines(text)).toHaveLength(10);
  });

  it("prints an empty count record as an empty list, never a made-up zero", () => {
    const text = formatSeedReport({
      demoCreated: true,
      devClassesCreated: true,
      summary: { ...SUMMARY, usersByRole: {}, accountsByProvider: {} },
    });
    expect(lines(text)[2]).toBe("  users by role:       ");
    expect(lines(text)[3]).toBe("  accounts:            ");
  });
});
