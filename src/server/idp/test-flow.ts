// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// "Test" on Admin → System → Identity providers (#46): an administrator starts a real sign-in
// through one provider in a new tab. The sign-in gate recognises the flow by its OAuth state or
// SAML RelayState, records the claim names it received and the role outcome (never a claim
// value), and refuses the sign-in, so the test creates no user and no session.
// Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import { randomBytes } from "node:crypto";
import type { Kysely } from "kysely";
import { recordCommittedAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";

/** The rejection code that ends a test sign-in; the result page reads the outcome instead. */
export const TEST_COMPLETE_ERROR = "idp_test_complete";

/** How long an administrator has to finish a test sign-in. */
const TEST_TTL_MS = 10 * 60 * 1000;

const TEST_PREFIX = "edulims-idp-test:";
const STATE_PREFIX = "edulims-idp-test-state:";
const TEST_PATH = /^\/admin\/system\/identity-providers\/([a-z][a-z0-9-]{1,39})\/test-result$/;

/** The outcome of a test sign-in as the result page shows it. */
export interface TestOutcome {
  /** `roles`, `local`, `default`, or the refusal code (`no_edulims_role`, `role_conflict`). */
  outcome: string;
  roles: string[];
  /** The names of the claims or attributes received, sorted; never their values. */
  claimNames: string[];
}

interface TestRecord {
  adminId: string;
  providerId: string;
  result?: TestOutcome;
}

function parseRecord(text: string): TestRecord | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return null;
    const adminId: unknown = Reflect.get(value, "adminId");
    const providerId: unknown = Reflect.get(value, "providerId");
    if (typeof adminId !== "string" || typeof providerId !== "string") return null;
    const result: unknown = Reflect.get(value, "result");
    const record: TestRecord = { adminId, providerId };
    if (typeof result === "object" && result !== null) {
      const outcome: unknown = Reflect.get(result, "outcome");
      const roles: unknown = Reflect.get(result, "roles");
      const claimNames: unknown = Reflect.get(result, "claimNames");
      if (typeof outcome === "string" && Array.isArray(roles) && Array.isArray(claimNames)) {
        record.result = {
          outcome,
          roles: roles.filter((role): role is string => typeof role === "string"),
          claimNames: claimNames.filter((name): name is string => typeof name === "string"),
        };
      }
    }
    return record;
  } catch {
    return null;
  }
}

async function readValue(db: Kysely<DB>, identifier: string, now: Date): Promise<string | null> {
  const row = await db
    .selectFrom("verification")
    .select("value")
    .where("identifier", "=", identifier)
    .where("expiresAt", ">", now)
    .executeTakeFirst();
  return row?.value ?? null;
}

/** Records a new test for `adminId` and returns its id, which goes into the callback URL. */
export async function startTest(
  db: Kysely<DB>,
  input: { adminId: string; providerId: string; now: Date },
): Promise<string> {
  const test = randomBytes(24).toString("base64url");
  await db
    .insertInto("verification")
    .values({
      id: randomBytes(16).toString("hex"),
      identifier: `${TEST_PREFIX}${test}`,
      value: JSON.stringify({ adminId: input.adminId, providerId: input.providerId }),
      expiresAt: new Date(input.now.getTime() + TEST_TTL_MS),
    })
    .execute();
  return test;
}

/** Returns the test id of a sign-in's callback URL, when it is a test-result page. */
export function testIdOfCallback(
  callbackURL: unknown,
): { providerId: string; test: string } | null {
  if (typeof callbackURL !== "string") return null;
  try {
    const url = new URL(callbackURL, "http://callback.invalid");
    const match = TEST_PATH.exec(url.pathname);
    const test = url.searchParams.get("test");
    if (!match?.[1] || !test || !/^[A-Za-z0-9_-]{32}$/.test(test)) return null;
    return { providerId: match[1], test };
  } catch {
    return null;
  }
}

/** Returns the OAuth `state` or SAML `RelayState` of a sign-in redirect URL. */
export function stateOfRedirect(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("state") ?? parsed.searchParams.get("RelayState");
  } catch {
    return null;
  }
}

/**
 * Binds the state of a just-started sign-in to a test, when the test exists, belongs to
 * `adminId` and names the same provider.
 */
export async function bindTestState(
  db: Kysely<DB>,
  input: { adminId: string; providerId: string; test: string; state: string; now: Date },
): Promise<void> {
  const value = await readValue(db, `${TEST_PREFIX}${input.test}`, input.now);
  const record = value ? parseRecord(value) : null;
  if (!record || record.adminId !== input.adminId || record.providerId !== input.providerId) return;
  await db
    .insertInto("verification")
    .values({
      id: randomBytes(16).toString("hex"),
      identifier: `${STATE_PREFIX}${input.state}`,
      value: input.test,
      expiresAt: new Date(input.now.getTime() + TEST_TTL_MS),
    })
    .execute();
}

/** Returns the test a callback with `state` belongs to, for `providerId`, or `null`. */
export async function testOfState(
  db: Kysely<DB>,
  input: { state: string; providerId: string; now: Date },
): Promise<string | null> {
  const test = await readValue(db, `${STATE_PREFIX}${input.state}`, input.now);
  if (!test) return null;
  const value = await readValue(db, `${TEST_PREFIX}${test}`, input.now);
  const record = value ? parseRecord(value) : null;
  return record && record.providerId === input.providerId ? test : null;
}

/** Stores the outcome of a test sign-in. */
export async function recordTestOutcome(
  db: Kysely<DB>,
  input: { test: string; outcome: TestOutcome; now: Date },
): Promise<void> {
  const identifier = `${TEST_PREFIX}${input.test}`;
  const value = await readValue(db, identifier, input.now);
  const record = value ? parseRecord(value) : null;
  if (!record) return;
  await db
    .updateTable("verification")
    .set({ value: JSON.stringify({ ...record, result: input.outcome }), updatedAt: input.now })
    .where("identifier", "=", identifier)
    .execute();
  await recordCommittedAudit(db, {
    action: "idp_tested",
    actor: { type: "user", id: record.adminId },
    outcome: "success",
    target: { type: "identity_provider", id: record.providerId },
    metadata: { provider_id: record.providerId, test_outcome: input.outcome.outcome },
  });
}

/** Returns the outcome of a test for the administrator who started it, else `null`. */
export async function readTestOutcome(
  db: Kysely<DB>,
  input: { test: string; adminId: string; providerId: string; now: Date },
): Promise<{ done: false } | { done: true; outcome: TestOutcome } | null> {
  const value = await readValue(db, `${TEST_PREFIX}${input.test}`, input.now);
  const record = value ? parseRecord(value) : null;
  if (!record || record.adminId !== input.adminId || record.providerId !== input.providerId) {
    return null;
  }
  return record.result ? { done: true, outcome: record.result } : { done: false };
}
