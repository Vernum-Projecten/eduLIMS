// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A sign-in whose address only looks ASCII after lower-casing is refused (#324). ASVS 5.0 V6.8.1:
// "the user's identity cannot be spoofed via another supported identity provider"; V1.1.1:
// input is decoded into a canonical form "before processing the input further" (vendored CSV).
// Real SSO sign-ins run through better-auth and the sso plugin: an OIDC callback with a signed
// ID token and a SAML ACS post with a signed assertion, from stubbed providers.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_NOT_LINKED_ERROR,
  EMAIL_FOLD_ERROR,
  normalizeSignInError,
} from "../lib/identity-providers.ts";
import type { Auth } from "./auth.ts";
import type { DB } from "./db/schema.gen.ts";
import { createTestDb } from "./db/test-db.ts";
import { parseEnv } from "./env.ts";
import { keyringOf } from "./idp/crypto.ts";
import { type StubIdp, stubIdp } from "./idp/test-oidc.ts";
import { insertTestProvider } from "./idp/test-providers.ts";
import { type StubSamlIdp, stubSamlIdp } from "./idp/test-saml-idp.ts";
import { oidcSignIn, type SsoOutcome, samlSignIn } from "./idp/test-sso-flow.ts";
import { setSecurityLogWriter } from "./security-log.ts";
import { addEmails } from "./simulations/emails.ts";
import { NOW, person, world } from "./simulations/test-helpers.ts";
import { createTestAuth } from "./test-auth.ts";
import { VALID_ENV } from "./test-env.ts";

const BASE = VALID_ENV.BETTER_AUTH_URL;
const ISSUER = "https://entra.example.test/tenant/v2.0";
const ADDRESS = "kim@example.test";
/** `ADDRESS` with U+212A KELVIN SIGN for its `k`: lower-casing folds it onto `ADDRESS`. */
const KELVIN = "Kim@example.test";

let db: Kysely<DB> | undefined;
let restoreLog: (() => void) | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  restoreLog?.();
  restoreLog = undefined;
  await db?.destroy();
  db = undefined;
});

type Protocol = "oidc" | "saml";

interface Stage {
  auth: Auth;
  database: Kysely<DB>;
  oidc: StubIdp;
  saml: StubSamlIdp;
  labId: string;
  lines: string[];
}

/** Two authoritative providers, `entra` (OIDC) and `campus-saml`, and a lab of a simulation. */
async function stage(): Promise<Stage> {
  const database = await createTestDb();
  db = database;
  const env = parseEnv(VALID_ENV);
  const saml = stubSamlIdp();
  await insertTestProvider(database, keyringOf(env), {
    providerId: "entra",
    issuer: ISSUER,
    emailAuthoritative: true,
  });
  await insertTestProvider(database, keyringOf(env), {
    providerId: "campus-saml",
    protocol: "saml",
    roleClaim: "Role",
    emailAuthoritative: true,
    samlMetadata: saml.metadata,
  });
  const auth = await createTestAuth(env, { db: database, type: "postgres" });
  const oidc = stubIdp(ISSUER, "entra-client");
  vi.stubGlobal("fetch", oidc.fetch);
  const w = await world(database);
  const lines: string[] = [];
  restoreLog = setSecurityLogWriter((line) => lines.push(line));
  return { auth, database, oidc, saml, labId: w.labId, lines };
}

const PROVIDER: Readonly<Record<Protocol, string>> = { oidc: "entra", saml: "campus-saml" };

/** Signs in through the provider of `protocol` with `email` and the given roles, as `subject`. */
function signIn(
  s: Stage,
  protocol: Protocol,
  email: string,
  options: { subject?: string; roles?: readonly string[] } = {},
): Promise<SsoOutcome> {
  const subject = options.subject ?? "subject-kim";
  const roles = [...(options.roles ?? [])];
  if (protocol === "oidc") {
    return oidcSignIn(s.auth, BASE, "entra", s.oidc, { sub: subject, email, name: "Kim", roles });
  }
  return samlSignIn(s.auth, BASE, "campus-saml", s.saml, {
    nameId: subject,
    attributes: { email: [email], givenName: ["Kim"], ...(roles.length ? { Role: roles } : {}) },
  });
}

/** A waiting place in the lab and a pending admin grant through the provider, for `ADDRESS`. */
async function waitFor(s: Stage, protocol: Protocol): Promise<void> {
  const teacher = await s.database
    .selectFrom("user")
    .select("id")
    .where("email", "=", "teacher@example.test")
    .executeTakeFirstOrThrow();
  const added = await addEmails(
    s.database,
    { id: teacher.id, roles: ["teacher"] },
    { labId: s.labId, emails: [ADDRESS] },
    NOW,
  );
  expect(added.ok).toBe(true);
  await s.database
    .insertInto("pending_admin_grant")
    .values({
      email: ADDRESS,
      provider_id: PROVIDER[protocol],
      expires_at: new Date(Date.now() + 3_600_000),
    })
    .execute();
}

async function state(database: Kysely<DB>) {
  const users = await database
    .selectFrom("user")
    .select(["id", "role"])
    .where("email", "=", ADDRESS)
    .execute();
  const grants = await database.selectFrom("pending_admin_grant").select("email").execute();
  const waiting = await database.selectFrom("lab_member_emails").select("email").execute();
  const accounts = await database
    .selectFrom("account")
    .select("userId")
    .where("providerId", "in", ["entra", "campus-saml"])
    .execute();
  const sessions = await database.selectFrom("session").select("id").execute();
  return { users, grants, waiting, accounts, sessions };
}

function refusals(lines: readonly string[]): unknown[] {
  return lines
    .map((line): unknown => JSON.parse(line))
    .filter(
      (line) =>
        typeof line === "object" &&
        line !== null &&
        Reflect.get(line, "event") === "authn_login_fail",
    );
}

describe.each<Protocol>(["oidc", "saml"])("a fold collision through %s (#324)", (protocol) => {
  it("refuses the KELVIN SIGN form of an address with a waiting place and a pending grant", async () => {
    const s = await stage();
    await waitFor(s, protocol);
    const before = await state(s.database);

    const outcome = await signIn(s, protocol, KELVIN);

    expect(outcome.path).toBe("/login");
    expect(normalizeSignInError(outcome.error ?? "")).toBe(EMAIL_FOLD_ERROR);
    expect(outcome.signedIn).toBe(false);
    // No user created, no account linked, no grant consumed, no place taken, no session.
    expect(await state(s.database)).toEqual(before);
    expect(before.users).toEqual([]);
    expect(before.grants).toEqual([{ email: ADDRESS }]);
    expect(before.waiting).toEqual([{ email: ADDRESS }]);
    const lab = await s.database
      .selectFrom("lab_members")
      .select("user_id")
      .where("lab_id", "=", s.labId)
      .execute();
    expect(lab).toHaveLength(6);
    // The gate's refusal, then the failed callback: each with the provider id, no address (A09).
    expect(refusals(s.lines)).toEqual([
      expect.objectContaining({ outcome: "refused", reason: EMAIL_FOLD_ERROR }),
      expect.objectContaining({ outcome: "failure", reason: EMAIL_FOLD_ERROR }),
    ]);
    for (const line of refusals(s.lines)) {
      expect(line).toMatchObject({ provider: PROVIDER[protocol] });
    }
    expect(s.lines.join("")).not.toContain("im@example");
  });

  it("signs the ASCII address in to its waiting place, so the refusal is not a broken stub", async () => {
    const s = await stage();
    await waitFor(s, protocol);

    const outcome = await signIn(s, protocol, ADDRESS);

    expect(outcome.error).toBeNull();
    expect(outcome.signedIn).toBe(true);
    const { users } = await state(s.database);
    expect(users).toEqual([{ id: expect.any(String), role: "student" }]);
  });

  it("never signs the KELVIN SIGN form in as an existing teacher, nor links it", async () => {
    const s = await stage();
    const teacher = await person(s.database, "kim", ["teacher"]);

    const outcome = await signIn(s, protocol, KELVIN, {
      subject: "subject-attacker",
      roles: ["edulims-teacher"],
    });

    // better-auth refuses the link before the gate runs: account linking is off (#39).
    expect(normalizeSignInError(outcome.error ?? "")).toBe(ACCOUNT_NOT_LINKED_ERROR);
    expect(outcome.signedIn).toBe(false);
    const { users, accounts, sessions } = await state(s.database);
    expect(users).toEqual([{ id: teacher.id, role: "teacher" }]);
    expect(accounts).toEqual([]);
    expect(sessions).toEqual([]);
  });

  it("refuses the KELVIN SIGN form from the subject of an existing account, keeping its address", async () => {
    const s = await stage();
    const first = await signIn(s, protocol, ADDRESS, { roles: ["edulims-teacher"] });
    expect(first.signedIn).toBe(true);
    await s.database.deleteFrom("session").execute();

    const outcome = await signIn(s, protocol, KELVIN, { roles: ["edulims-teacher"] });

    expect(normalizeSignInError(outcome.error ?? "")).toBe(EMAIL_FOLD_ERROR);
    expect(outcome.signedIn).toBe(false);
    const { users, sessions } = await state(s.database);
    expect(users).toEqual([{ id: expect.any(String), role: "teacher" }]);
    expect(sessions).toEqual([]);
  });

  it("still signs in josé@school.example from an authoritative provider, verified", async () => {
    const s = await stage();

    const outcome = await signIn(s, protocol, "josé@school.example", {
      roles: ["edulims-teacher"],
    });

    expect(outcome.error).toBeNull();
    expect(outcome.signedIn).toBe(true);
    const user = await s.database
      .selectFrom("user")
      .select(["role", "emailVerified"])
      .where("email", "=", "josé@school.example")
      .executeTakeFirstOrThrow();
    expect(user).toEqual({ role: "teacher", emailVerified: true });
  });
});

describe("a SAML response without an email attribute (#324)", () => {
  // The sso plugin then takes the NameID for the address (`attr(…) || extract.nameID`).
  it("refuses a NameID that folds onto an ASCII address", async () => {
    const s = await stage();
    const outcome = await samlSignIn(s.auth, BASE, "campus-saml", s.saml, {
      nameId: KELVIN,
      attributes: { Role: ["edulims-teacher"] },
    });
    expect(normalizeSignInError(outcome.error ?? "")).toBe(EMAIL_FOLD_ERROR);
    expect((await state(s.database)).users).toEqual([]);
  });

  it("reads an escaped NameID as the plugin does, and signs it in", async () => {
    const s = await stage();
    const outcome = await samlSignIn(s.auth, BASE, "campus-saml", s.saml, {
      nameId: "Kim&Co<1>@example.test",
      attributes: { Role: ["edulims-teacher"] },
    });
    expect(outcome.error).toBeNull();
    const users = await s.database
      .selectFrom("user")
      .select("role")
      .where("email", "=", "kim&co<1>@example.test")
      .execute();
    expect(users).toEqual([{ role: "teacher" }]);
  });
});
