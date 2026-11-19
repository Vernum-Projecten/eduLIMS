// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Writes the dev-account simulations of `pnpm db:seed` in one transaction, once: when the first
// simulation exists, the database already holds them. Relative imports: plain Node.
import type { Kysely } from "kysely";
import type { DB } from "../schema.gen.ts";
import {
  DEV_SIMULATION_ACCOUNTS,
  type DevRoster,
  devRoster,
  planDevAccountSimulations,
} from "./dev-simulations.ts";
import { demoRandom } from "./random.ts";
import { DEMO_SEED, planDemoData } from "./seed-demo.ts";
import { insertSimulations } from "./simulations.ts";

/** Thrown when a dev account or a demo student the simulations need is not in the database. */
export class DevSimulationUsersMissing extends Error {
  override readonly name = "DevSimulationUsersMissing";

  /** How many of the needed users the database lacks. */
  readonly missing: number;

  constructor(missing: number) {
    super(
      `${missing} of the users the dev-account simulations need are missing; ` +
        "seed the dev users and the demo set first.",
    );
    this.missing = missing;
  }
}

/**
 * Writes the dev-account simulations planned for `now`, unless they are already there. Runs after
 * the dev users and the demo set exist.
 *
 * @returns whether this call wrote them.
 * @throws {@link DevSimulationUsersMissing} when a dev account or a demo student is missing.
 */
export async function seedDevAccountSimulations(db: Kysely<DB>, now: Date): Promise<boolean> {
  const roster = devRoster(planDemoData(now).people);
  const emails = [
    ...Object.values(DEV_SIMULATION_ACCOUNTS),
    ...roster.aurora,
    ...roster.borealis,
    ...roster.zenith,
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
      if (id === undefined) throw new DevSimulationUsersMissing(missing);
      return id;
    };
    const idsOf = (list: readonly string[]) => list.map(idOf);
    const users = {
      accounts: {
        student: idOf(DEV_SIMULATION_ACCOUNTS.student),
        teacher: idOf(DEV_SIMULATION_ACCOUNTS.teacher),
        coordinator: idOf(DEV_SIMULATION_ACCOUNTS.coordinator),
      },
      roster: {
        aurora: idsOf(roster.aurora),
        borealis: idsOf(roster.borealis),
        zenith: idsOf(roster.zenith),
      } satisfies DevRoster<string>,
    };
    // A source of its own, so these ids never shift those of the demo set.
    const plan = planDevAccountSimulations(demoRandom(DEMO_SEED + 2), now, users);
    const first = plan.simulations[0];
    if (!first) return false;
    const exists = await trx
      .selectFrom("simulations")
      .select("id")
      .where("id", "=", first.id)
      .executeTakeFirst();
    if (exists) return false;
    await insertSimulations(trx, plan);
    return true;
  });
}
