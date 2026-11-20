// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Accounts of one test: a journey that changes what an account remembers (the saved portal), or
// that reads an account's own activity, takes an account of its own, so a parallel test, a retry
// or `--repeat-each` never meets it (#321). Each is a copy of a seeded dev account in this run's
// database, with its roles and its dev password, under a new invented address.
import { randomBytes } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { recordAudit } from "../../src/server/audit/record.ts";
import { newId } from "../../src/server/db/ids.ts";
import type { DB } from "../../src/server/db/schema.gen.ts";

/** An account {@link copyAccount} made: its user id, its address and its display name. */
export interface TestAccount {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

/** Runs `work` on this run's database, then closes the connection. */
async function onRunDatabase<T>(work: (db: Kysely<DB>) => Promise<T>): Promise<T> {
  const url = process.env["EDULIMS_E2E_DATABASE_URL"];
  if (!url) throw new Error("EDULIMS_E2E_DATABASE_URL is not set; playwright.config.ts sets it.");
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 1 }) }),
  });
  try {
    return await work(db);
  } finally {
    await db.destroy();
  }
}

/**
 * Copies the seeded dev account `template` (its roles, its role source and its password) to a
 * new account with an address of `<prefix>-<random>@example.test`, and returns it. The copy has
 * no saved portal, no sessions and no activity.
 */
export async function copyAccount(template: string, prefix: string): Promise<TestAccount> {
  const tag = randomBytes(4).toString("hex");
  const account = {
    id: newId(),
    email: `${prefix}-${tag}@example.test`,
    name: `${prefix} ${tag}`,
  };
  await onRunDatabase((db) =>
    db.transaction().execute(async (trx) => {
      const source = await trx
        .selectFrom("user")
        .innerJoin("account", "account.userId", "user.id")
        .select(["user.role", "user.role_source", "user.role_channel", "account.password"])
        .where("user.email", "=", template)
        .where("account.providerId", "=", "credential")
        .executeTakeFirst();
      if (!source) throw new Error(`The seed has no dev account ${template} with a password.`);
      await trx
        .insertInto("user")
        .values({
          id: account.id,
          email: account.email,
          name: account.name,
          emailVerified: true,
          role: source.role,
          role_source: source.role_source,
          role_channel: source.role_channel,
        })
        .execute();
      await trx
        .insertInto("account")
        .values({
          id: newId(),
          accountId: account.id,
          providerId: "credential",
          userId: account.id,
          password: source.password,
          updatedAt: new Date(),
        })
        .execute();
    }),
  );
  return account;
}

/**
 * Writes `count` successful sign-ins of `account` to the activity log, one second apart and
 * ending a minute ago, so a journey can filter the log to events no other journey writes.
 */
export async function recordSignIns(account: TestAccount, count: number): Promise<void> {
  const last = Date.now() - 60_000;
  await onRunDatabase((db) =>
    db.transaction().execute(async (trx) => {
      for (let index = 0; index < count; index += 1) {
        await recordAudit(
          trx,
          {
            action: "authn_login_success",
            actor: { type: "user", id: account.id },
            outcome: "success",
            target: { type: "user", id: account.id },
            occurredAt: new Date(last - (count - 1 - index) * 1000),
          },
          { stdout: false },
        );
      }
    }),
  );
}
