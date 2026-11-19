// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The two better-auth plugins of simulations and labs: the link of waiting addresses at sign-in
// (S10), and the guard that keeps the last teacher of a simulation from being deleted (D10).
// Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import type { Kysely } from "kysely";
import { storedRoleSetsWith } from "../../lib/roles.ts";
import { auditRecorderOf, requestIdOf } from "../audit/better-auth-hooks.ts";
import type { DB } from "../db/schema.gen.ts";
import { linkWaitingAddresses } from "./linking.ts";

/**
 * Returns the plugin that links a student's waiting addresses to their labs whenever better-auth
 * creates a session, which happens only on a sign-in (S10).
 */
export function labSignInLink(db: Kysely<DB>) {
  return {
    id: "edulims-lab-sign-in-link",
    init: () => ({
      options: {
        databaseHooks: {
          session: {
            create: {
              after: async (session) => {
                try {
                  await linkWaitingAddresses(db, session.userId, new Date());
                } catch (error) {
                  // NOTE: S10 (#280); a failed link never refuses the sign-in. The addresses
                  // keep waiting, and the next sign-in or overview read tries again.
                  const kind = error instanceof Error ? error.name : "unknown";
                  console.error(`lab_link_failed user=${session.userId} ${kind}`);
                }
              },
            },
          },
        },
      },
    }),
  } satisfies BetterAuthPlugin;
}

/** The refusal code of deleting the only teacher of a simulation; the Users screen translates it. */
export const ONLY_SIMULATION_TEACHER = "only_simulation_teacher";
const ONLY_SIMULATION_TEACHER_REFUSED = {
  code: "ONLY_SIMULATION_TEACHER",
  message: ONLY_SIMULATION_TEACHER,
};

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

const TEACHER_ROLE_VALUES = storedRoleSetsWith("teacher");

/**
 * Returns whether `userId` teaches a simulation in which no other teacher row belongs to a user
 * who holds the app role teacher, so deleting the account would leave it without a teacher
 * (D10). It applies the rule of `removeTeacher`; the other teachers' user rows are read
 * `FOR SHARE`.
 */
export async function isOnlyTeacherOfASimulation(db: Kysely<DB>, userId: string): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const mine = await trx
      .selectFrom("simulation_teachers")
      .select("simulation_id")
      .where("user_id", "=", userId)
      .orderBy("simulation_id")
      .execute();
    if (mine.length === 0) return false;
    const covered = await trx
      .selectFrom("simulation_teachers")
      .innerJoin("user", "user.id", "simulation_teachers.user_id")
      .select("simulation_teachers.simulation_id")
      .where(
        "simulation_teachers.simulation_id",
        "in",
        mine.map((row) => row.simulation_id),
      )
      .where("simulation_teachers.user_id", "<>", userId)
      .where("user.role", "in", TEACHER_ROLE_VALUES)
      .forShare("user")
      .execute();
    const taught = new Set(covered.map((row) => row.simulation_id));
    return mine.some((row) => !taught.has(row.simulation_id));
  });
}

/**
 * Returns the guard on better-auth's `admin/remove-user`: an account that is the only teacher of
 * a simulation is not deleted, and the refusal is logged (D10, #280).
 */
export function simulationTeacherGuard(db: Kysely<DB>) {
  return {
    id: "edulims-simulation-teacher-guard",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/admin/remove-user",
          handler: createAuthMiddleware(async (ctx) => {
            const userId = field(ctx.body, "userId");
            if (typeof userId !== "string" || userId === "") return;
            if (!(await isOnlyTeacherOfASimulation(db, userId))) return;
            const session = await getSessionFromCtx(ctx);
            const requestId = requestIdOf(ctx);
            await auditRecorderOf(ctx.context)?.record({
              action: "user_deleted",
              actor: session ? { type: "user", id: session.user.id } : { type: "anonymous" },
              outcome: "refused",
              reason: ONLY_SIMULATION_TEACHER,
              target: { type: "user", id: userId },
              ...(requestId ? { requestId } : {}),
            });
            throw APIError.from("FORBIDDEN", ONLY_SIMULATION_TEACHER_REFUSED);
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
