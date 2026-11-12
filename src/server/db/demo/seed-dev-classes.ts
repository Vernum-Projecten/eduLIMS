// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Writes the dev-account classes of `pnpm db:seed` in one transaction, once: when the first class
// exists, the database already holds them. Relative imports: the seed loads this in plain Node.
import type { Kysely } from "kysely";
import type { DB } from "../schema.gen.ts";
import {
  DEV_CLASS_ACCOUNTS,
  type DevClassRoster,
  devClassRoster,
  planDevAccountClasses,
} from "./dev-classes.ts";
import { demoRandom } from "./random.ts";
import { DEMO_SEED, insertClasses, planDemoData } from "./seed-demo.ts";

/** Thrown when a dev account or a demo student the classes need is not in the database. */
export class DevClassUsersMissing extends Error {
  override readonly name = "DevClassUsersMissing";

  /** How many of the needed users the database lacks. */
  readonly missing: number;

  constructor(missing: number) {
    super(
      `${missing} of the users the dev-account classes need are missing; ` +
        "seed the dev users and the demo set first.",
    );
    this.missing = missing;
  }
}

/**
 * Writes the dev-account classes planned for `now`, unless they are already there. Runs after
 * the dev users and the demo set exist.
 *
 * @returns whether this call wrote them.
 * @throws {@link DevClassUsersMissing} when a dev account or a demo student is not in the database.
 */
export async function seedDevAccountClasses(db: Kysely<DB>, now: Date): Promise<boolean> {
  const roster = devClassRoster(planDemoData(now).people);
  const emails = [
    ...Object.values(DEV_CLASS_ACCOUNTS),
    ...roster.current,
    ...roster.shared,
    ...roster.archived,
  ];
  return db.transaction().execute(async (trx) => {
    const rows = await trx
      .selectFrom("user")
      .select(["id", "email"])
      .where("email", "in", emails)
      .execute();
    const ids = new Map(rows.map((row) => [row.email, row.id]));
    const missing = emails.filter((email) => !ids.has(email)).length;
    const idOf = (email: string) => {
      const id = ids.get(email);
      if (id === undefined) throw new DevClassUsersMissing(missing);
      return id;
    };
    const idsOf = (list: readonly string[]) => list.map(idOf);
    const users = {
      accounts: {
        student: idOf(DEV_CLASS_ACCOUNTS.student),
        teacher: idOf(DEV_CLASS_ACCOUNTS.teacher),
        coordinator: idOf(DEV_CLASS_ACCOUNTS.coordinator),
      },
      roster: {
        current: idsOf(roster.current),
        shared: idsOf(roster.shared),
        archived: idsOf(roster.archived),
      } satisfies DevClassRoster<string>,
    };
    // A source of its own, so these ids never shift those of the demo set.
    const plan = planDevAccountClasses(demoRandom(DEMO_SEED + 2), now, users);
    const first = plan.classes[0];
    if (!first) return false;
    const exists = await trx
      .selectFrom("organization")
      .select("id")
      .where("id", "=", first.id)
      .executeTakeFirst();
    if (exists) return false;
    await insertClasses(trx, plan);
    return true;
  });
}
