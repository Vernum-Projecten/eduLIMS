// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Refused host CLI commands on the activity log and the security log stream (B4, #86; ASVS
// V16.3.2): a refused `admin grant` or `revoke` and a refused `idp add`, `enable` or `disable`
// write a row with outcome `refused`, actor `system` and the reason code, ids only.
import { describe, expect, it, vi } from "vitest";
import { database, harness, installCliHarness, run, stream, user } from "./cli/test-cli.ts";
import { keyringOf } from "./idp/crypto.ts";
import { insertTestProvider } from "./idp/test-providers.ts";
import { VALID_ENV } from "./test-env.ts";

const forced = vi.hoisted(() => ({ refuseEnable: false }));

vi.mock(import("./cli/host.ts"), async (original) => {
  const { harness: state } = await import("./cli/test-cli.ts");
  return { ...(await original()), openDatabase: () => state.open() };
});

// An enable right after a create cannot be refused on a real database, so one case forces it.
vi.mock(import("./idp/service.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    setProviderEnabled: (...args: Parameters<typeof actual.setProviderEnabled>) =>
      forced.refuseEnable && args[1].enabled
        ? Promise.resolve({ ok: false as const, error: "not_found" as const })
        : actual.setProviderEnabled(...args),
  };
});

installCliHarness();

const METADATA_FILE = new URL("../../tests/fixtures/idp/saml-idp-metadata.xml", import.meta.url)
  .pathname;

function keyring() {
  return keyringOf({ EDULIMS_DATA_KEY: VALID_ENV.EDULIMS_DATA_KEY });
}

/** The arguments of `idp add` for a SAML provider from the fixture metadata. */
function samlAdd(id: string, ...extra: string[]): string[] {
  return [
    "idp",
    "add",
    "--id",
    id,
    "--protocol",
    "saml",
    "--label-en",
    "Campus",
    "--role-map",
    "edulims-teacher:teacher",
    "--metadata-file",
    METADATA_FILE,
    ...extra,
  ];
}

/** One refusal line as the stream carries it. */
function refusal(event: string, reason: string, extra: Record<string, unknown> = {}) {
  return expect.objectContaining({
    level: "warn",
    event,
    outcome: "refused",
    actor_type: "system",
    reason,
    ...extra,
  });
}

describe("refused admin grants and revocations (V16.3.2)", () => {
  it("logs a grant to a student as role_conflict, with the user id", async () => {
    const db = await database();
    await user(db, "s1", "student", "Test Student");
    expect((await run("admin", "grant", "s1@example.test")).code).toBe(1);
    expect(stream()).toEqual([
      refusal("authz_role_change", "role_conflict", { target_type: "user", target_id: "s1" }),
    ]);
  });

  it("logs a grant to an unverified address as email_unverified", async () => {
    const db = await database();
    await user(db, "t1", "teacher", "Test Teacher", false);
    expect((await run("admin", "grant", "t1@example.test")).code).toBe(1);
    expect(stream()).toEqual([
      refusal("authz_role_change", "email_unverified", { target_id: "t1" }),
    ]);
  });

  it("logs a pending grant through an unknown provider as provider_unknown", async () => {
    await database();
    const { code } = await run("admin", "grant", "new@example.test", "--provider", "nope");
    expect(code).toBe(1);
    const [line, ...rest] = stream();
    expect(rest).toEqual([]);
    expect(line).toEqual(
      refusal("admin_grant_created", "provider_unknown", { provider_id: "nope" }),
    );
    expect(line).not.toHaveProperty("target_id");
  });

  it("logs a revocation of the last administrator as last_admin", async () => {
    const db = await database();
    await user(db, "a1", "admin", "Test Admin");
    expect((await run("admin", "revoke", "a1@example.test")).code).toBe(1);
    expect(stream()).toEqual([refusal("authz_role_change", "last_admin", { target_id: "a1" })]);
  });
});

describe("refused identity provider changes (V16.3.2)", () => {
  it("logs an `idp add` for an existing id as exists, with the provider id", async () => {
    const db = await database();
    await insertTestProvider(db, keyring(), { providerId: "campus", protocol: "saml" });
    const { code, lines } = await run(...samlAdd("campus"));
    expect(code).toBe(1);
    expect(lines).toEqual(["refused: exists"]);
    expect(stream()).toEqual([
      refusal("idp_created", "exists", {
        target_type: "identity_provider",
        target_id: "campus",
        provider_id: "campus",
      }),
    ]);
  });

  it("logs an `idp add` with invalid input as input_invalid, without a target", async () => {
    await database();
    const { code } = await run(...samlAdd("Bad Id"));
    expect(code).toBe(1);
    const [line, ...rest] = stream();
    expect(rest).toEqual([]);
    expect(line).toEqual(refusal("idp_created", "input_invalid"));
    expect(line).not.toHaveProperty("target_id");
  });

  it("reports a refused enable after `idp add --enable` and exits 1", async () => {
    await database();
    forced.refuseEnable = true;
    try {
      const { code, lines } = await run(...samlAdd("campus", "--enable"));
      expect(code).toBe(1);
      expect(lines).toEqual([
        "created campus (disabled)",
        "refused: enable: not_found; campus stays disabled",
      ]);
    } finally {
      forced.refuseEnable = false;
    }
    expect(stream()).toEqual([
      expect.objectContaining({ event: "idp_created", outcome: "success" }),
      refusal("idp_enabled", "not_found", { target_id: "campus" }),
    ]);
  });

  it("logs `idp disable` of an unknown provider as not_found", async () => {
    await database();
    const { code, lines } = await run("idp", "disable", "nope");
    expect(code).toBe(1);
    expect(lines).toEqual(["refused: not_found"]);
    expect(stream()).toEqual([refusal("idp_disabled", "not_found", { target_id: "nope" })]);
  });
});

describe("admin lookup", () => {
  it("prints the user id on the one connection the command opened", async () => {
    const db = await database();
    await user(db, "t1", "teacher", "Test Teacher");
    const { code, lines } = await run("admin", "lookup", "t1@example.test");
    expect(code).toBe(0);
    expect(lines).toEqual(["user t1 (email verified)"]);
    expect(harness.opened).toBe(1);
    expect(stream()).toEqual([]);
  });
});
