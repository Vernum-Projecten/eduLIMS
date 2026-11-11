// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The host CLI on the security log stream (B4, #86; ASVS V16.2.1, V16.2.4): every command that
// changes access writes its activity-log row with actor `system`, whose JSON line carries ids
// and codes only, and a failing migrate or prune writes an error line with its cause chain.
// The commands run through `runCli` on the test database, which their `destroy()` rolls back.
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.ts";
import type { DB } from "./db/schema.gen.ts";
import { createTestDb } from "./db/test-db.ts";
import { keyringOf } from "./idp/crypto.ts";
import { invalidateProviderCache } from "./idp/registry.ts";
import { fixtureMetadata, insertTestProvider } from "./idp/test-providers.ts";
import { SECURITY_LOG_FIELDS, setSecurityLogWriter } from "./security-log.ts";
import { VALID_ENV } from "./test-env.ts";

let current: Kysely<DB> | undefined;

vi.mock(import("./cli/host.ts"), async (original) => ({
  ...(await original()),
  openDatabase: () => {
    if (!current) throw new Error("no test database");
    return current;
  },
}));

const OLD_KEY = Buffer.alloc(32, 1).toString("base64");
const NEW_KEY = Buffer.alloc(32, 2).toString("base64");
const ENVELOPE = ["time", "level", "app", "log", "event"];
/** Personal data the fixtures hold: none of it may reach a log line. */
const PERSONAL = /example\.test|Test (Teacher|Admin|Student)|@/;

let logged: string[] = [];
let restoreLog: (() => void) | undefined;

beforeEach(() => {
  for (const key of ["DATABASE_URL", "BETTER_AUTH_URL", "EDULIMS_DATA_KEY"] as const) {
    vi.stubEnv(key, VALID_ENV[key]);
  }
  vi.stubEnv("EDULIMS_IDP_PRIVATE_ORIGINS", "");
  vi.stubEnv("EDULIMS_DATA_KEY_PREVIOUS", "");
  logged = [];
  restoreLog = setSecurityLogWriter((line) => logged.push(line));
});

afterEach(async () => {
  restoreLog?.();
  restoreLog = undefined;
  vi.unstubAllEnvs();
  invalidateProviderCache();
  await current?.destroy();
  current = undefined;
});

async function database(): Promise<Kysely<DB>> {
  current = await createTestDb();
  return current;
}

async function user(db: Kysely<DB>, id: string, role: string | null, name: string) {
  await db
    .insertInto("user")
    .values({ id, name, email: `${id}@example.test`, emailVerified: true, role })
    .execute();
}

async function run(...args: string[]) {
  const lines: string[] = [];
  const code = await runCli(args, (line) => lines.push(line));
  return { code, lines };
}

/** The parsed stream lines, after checking each against the allowlist and for personal data. */
function stream(): Record<string, unknown>[] {
  const allowed: readonly string[] = [...ENVELOPE, ...SECURITY_LOG_FIELDS];
  return logged.map((text) => {
    expect(text).not.toMatch(PERSONAL);
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) throw new Error("not a JSON object");
    const line = Object.fromEntries(Object.entries(parsed));
    expect(Object.keys(line).filter((key) => !allowed.includes(key))).toEqual([]);
    return line;
  });
}

describe("admin grant and revoke on the stream (#86)", () => {
  it("logs `admin grant <email>` as a role change by system, with the user id only", async () => {
    const db = await database();
    await user(db, "t1", "teacher", "Test Teacher");
    expect((await run("admin", "grant", "t1@example.test")).code).toBe(0);
    expect(stream()).toEqual([
      expect.objectContaining({
        level: "info",
        event: "authz_role_change",
        outcome: "success",
        actor_type: "system",
        target_type: "user",
        target_id: "t1",
        reason: "admin_grant",
        roles: "teacher,admin",
        previous_roles: "teacher",
      }),
    ]);
  });

  it("logs `admin grant --user-id <id>` with the override reason", async () => {
    const db = await database();
    await user(db, "teacher-2", "teacher", "Test Teacher");
    expect((await run("admin", "grant", "--user-id", "teacher-2")).code).toBe(0);
    expect(stream()).toEqual([
      expect.objectContaining({
        event: "authz_role_change",
        actor_type: "system",
        target_id: "teacher-2",
        reason: "admin_grant_override",
      }),
    ]);
  });

  it("logs a pending grant through a provider with the grant id and the provider id", async () => {
    const db = await database();
    const keyring = keyringOf({ EDULIMS_DATA_KEY: VALID_ENV.EDULIMS_DATA_KEY });
    await insertTestProvider(db, keyring, { providerId: "entra", emailAuthoritative: true });
    const { code } = await run("admin", "grant", "new@example.test", "--provider", "entra");
    expect(code).toBe(0);
    expect(stream()).toEqual([
      expect.objectContaining({
        event: "admin_grant_created",
        actor_type: "system",
        target_type: "admin_grant",
        target_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        provider_id: "entra",
      }),
    ]);
  });

  it("logs `admin revoke <email>` as a role change by system", async () => {
    const db = await database();
    await user(db, "a1", "admin", "Test Admin");
    await user(db, "a2", "teacher,admin", "Test Admin");
    expect((await run("admin", "revoke", "a2@example.test")).code).toBe(0);
    expect(stream()).toEqual([
      expect.objectContaining({
        event: "authz_role_change",
        actor_type: "system",
        target_id: "a2",
        reason: "admin_revoke",
        roles: "teacher",
        previous_roles: "teacher,admin",
      }),
    ]);
  });
});

describe("idp add, enable, disable and rekey on the stream (#86)", () => {
  const metadataFile = new URL("../../tests/fixtures/idp/saml-idp-metadata.xml", import.meta.url)
    .pathname;

  it("logs `idp add … --enable` as idp_created and idp_enabled by system", async () => {
    await database();
    expect(fixtureMetadata()).toContain("EntityDescriptor");
    const { code } = await run(
      "idp",
      "add",
      "--id",
      "campus",
      "--protocol",
      "saml",
      "--label-en",
      "Campus",
      "--role-map",
      "edulims-teacher:teacher",
      "--metadata-file",
      metadataFile,
      "--enable",
    );
    expect(code).toBe(0);
    expect(stream()).toEqual([
      expect.objectContaining({
        event: "idp_created",
        actor_type: "system",
        target_type: "identity_provider",
        target_id: "campus",
        provider_id: "campus",
        protocol: "saml",
      }),
      expect.objectContaining({ event: "idp_enabled", actor_type: "system", target_id: "campus" }),
    ]);
  });

  it("logs `idp disable` with the number of sessions it ended", async () => {
    const db = await database();
    const keyring = keyringOf({ EDULIMS_DATA_KEY: VALID_ENV.EDULIMS_DATA_KEY });
    await insertTestProvider(db, keyring, { providerId: "entra" });
    expect((await run("idp", "disable", "entra")).code).toBe(0);
    expect(stream()).toEqual([
      expect.objectContaining({
        event: "idp_disabled",
        actor_type: "system",
        target_id: "entra",
        provider_id: "entra",
        sessions_ended: 0,
      }),
    ]);
  });

  it("logs `idp enable` as idp_enabled by system", async () => {
    const db = await database();
    const keyring = keyringOf({ EDULIMS_DATA_KEY: VALID_ENV.EDULIMS_DATA_KEY });
    await insertTestProvider(db, keyring, { providerId: "entra", enabled: false });
    expect((await run("idp", "enable", "entra")).code).toBe(0);
    expect(stream()).toEqual([
      expect.objectContaining({ event: "idp_enabled", actor_type: "system", target_id: "entra" }),
    ]);
  });

  it("logs `idp rekey` as sys_data_key_rotated with counts only", async () => {
    const db = await database();
    const old = keyringOf({ EDULIMS_DATA_KEY: OLD_KEY });
    await insertTestProvider(db, old, { providerId: "entra", clientSecret: "secret-1" });
    vi.stubEnv("EDULIMS_DATA_KEY", NEW_KEY);
    vi.stubEnv("EDULIMS_DATA_KEY_PREVIOUS", OLD_KEY);
    expect((await run("idp", "rekey")).code).toBe(0);
    const [line, ...rest] = stream();
    expect(rest).toEqual([]);
    expect(line).toEqual({
      time: expect.any(String),
      level: "info",
      app: "edulims",
      log: "security",
      event: "sys_data_key_rotated",
      outcome: "success",
      actor_type: "system",
      resealed_providers: 1,
      resealed_id_tokens: 0,
    });
    expect(logged.join("")).not.toContain("secret-1");
  });
});

describe("migrate and prune failures on the stream (#86)", () => {
  /** A port nothing listens on, so the connection is refused at once. */
  const UNREACHABLE = "postgres://edulims:edulims@127.0.0.1:1/edulims";

  it("logs a failed migrate as migration_failed with its cause, never a message", async () => {
    vi.stubEnv("DATABASE_URL", UNREACHABLE);
    const { code, lines } = await run("migrate");
    expect(code).toBe(1);
    expect(lines).toContain("Migration failed; the migration_failed log line names its cause.");
    expect(stream()).toEqual([
      expect.objectContaining({
        level: "error",
        event: "migration_failed",
        actor_type: "system",
        direction: "up",
        cause: expect.arrayContaining([expect.stringMatching(/:ECONNREFUSED$/)]),
      }),
    ]);
  });

  it("logs a migrate refused for a database without verified TLS in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { code } = await run("migrate", "up");
    expect(code).toBe(1);
    expect(stream()).toEqual([
      expect.objectContaining({
        level: "error",
        event: "migration_failed",
        reason: "database_tls_required",
        variables: ["DATABASE_URL"],
      }),
    ]);
  });

  it("logs a failed prune as retention_prune_failed with its cause", async () => {
    vi.stubEnv("DATABASE_URL", UNREACHABLE);
    expect((await run("prune")).code).toBe(1);
    const lines = stream();
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: "error",
        event: "retention_prune_failed",
        actor_type: "system",
        cause: expect.arrayContaining([expect.stringMatching(/:ECONNREFUSED$/)]),
      }),
    );
    // The failure row cannot reach a database that is down, and says so on the stream too.
    expect(lines).toContainEqual(
      expect.objectContaining({ event: "audit_write_failed", reason: "sys_retention_prune" }),
    );
  });
});
