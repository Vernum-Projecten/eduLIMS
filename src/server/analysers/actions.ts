// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The changes to the analyser register (B3, #35): create, edit and retire. Each runs in one
// transaction with its activity-log row (B4), so a change that cannot be logged does not
// happen. Only administrators change the register (#35 acceptance criterion).
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { type AnalyserRoute, parseAnalyserRoute } from "../../lib/analysers.ts";
import { recordAudit } from "../audit/record.ts";
import type { SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertAdmin } from "../users/actions.ts";
import type { CreateAnalyserInput, UpdateAnalyserInput } from "./schemas.ts";

/** Why a change was refused or failed; the screen maps each code to a translated message. */
export const ANALYSER_ACTION_ERRORS = ["not_found", "serial_taken", "retired", "failed"] as const;
export type AnalyserActionError = (typeof ANALYSER_ACTION_ERRORS)[number];

/** The outcome of a change: done with the analyser's id, or refused with a code. */
export type AnalyserActionResult =
  | { ok: true; analyserId: string }
  | { ok: false; error: AnalyserActionError };

/** What every change runs with: the database and the administrator. */
export interface AnalyserActionContext {
  db: Kysely<DB>;
  actor: Pick<SessionUser, "id" | "roles">;
  now: Date;
}

const SERIAL_CONSTRAINT = "analysers_model_serial_number_key";

/** A refusal raised inside a transaction, so the transaction rolls back before it is returned. */
class Refusal extends Error {
  readonly code: AnalyserActionError;
  constructor(code: AnalyserActionError) {
    super(code);
    this.code = code;
  }
}

/** Returns whether `error` is PostgreSQL's unique violation of the model and serial number. */
export function isSerialTaken(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return (
    Reflect.get(error, "code") === "23505" && Reflect.get(error, "constraint") === SERIAL_CONSTRAINT
  );
}

/** Maps what a transaction threw to a result; anything unknown is rethrown (fail loud). */
function refusalOf(error: unknown): AnalyserActionResult {
  if (error instanceof Refusal) return { ok: false, error: error.code };
  if (isSerialTaken(error)) return { ok: false, error: "serial_taken" };
  throw error;
}

function routeOf(value: string): AnalyserRoute {
  const route = parseAnalyserRoute(value);
  // The shared schema refuses an empty route before this point; this keeps the type honest.
  if (!route) throw new Refusal("failed");
  return route;
}

function fields(input: CreateAnalyserInput, now: Date) {
  const notes = input.notes.trim();
  return {
    model: input.model,
    serial_number: input.serialNumber,
    location: input.location,
    route: routeOf(input.route),
    status: input.status,
    notes: notes === "" ? null : notes,
    updated_at: now,
  };
}

/** Adds an analyser to the register and logs `analyser_created`. */
export async function createAnalyser(
  ctx: AnalyserActionContext,
  input: CreateAnalyserInput,
): Promise<AnalyserActionResult> {
  assertAdmin(ctx.actor);
  try {
    return await ctx.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto("analysers")
        .values({ ...fields(input, ctx.now), created_at: ctx.now })
        .returning("id")
        .executeTakeFirstOrThrow();
      await recordAudit(trx, {
        action: "analyser_created",
        actor: { type: "user", id: ctx.actor.id },
        outcome: "success",
        target: { type: "analyser", id: row.id },
        metadata: { analyser_status: input.status },
      });
      return { ok: true, analyserId: row.id };
    });
  } catch (error) {
    return refusalOf(error);
  }
}

/** Changes an analyser that is not retired and logs `analyser_updated`. */
export async function updateAnalyser(
  ctx: AnalyserActionContext,
  input: UpdateAnalyserInput,
): Promise<AnalyserActionResult> {
  assertAdmin(ctx.actor);
  try {
    return await ctx.db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom("analysers")
        .select("status")
        .where("id", "=", input.analyserId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw new Refusal("not_found");
      if (current.status === "retired") throw new Refusal("retired");
      await trx
        .updateTable("analysers")
        .set(fields(input, ctx.now))
        .where("id", "=", input.analyserId)
        .execute();
      await recordAudit(trx, {
        action: "analyser_updated",
        actor: { type: "user", id: ctx.actor.id },
        outcome: "success",
        target: { type: "analyser", id: input.analyserId },
        metadata: { analyser_status: input.status },
      });
      return { ok: true, analyserId: input.analyserId };
    });
  } catch (error) {
    return refusalOf(error);
  }
}

/**
 * Retires an analyser and logs `analyser_retired`. The row stays, so a measurement that names
 * its serial number keeps its device (Q-TRACE-1); a retired analyser cannot be edited.
 */
export async function retireAnalyser(
  ctx: AnalyserActionContext,
  input: { analyserId: string },
): Promise<AnalyserActionResult> {
  assertAdmin(ctx.actor);
  try {
    return await ctx.db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom("analysers")
        .select("status")
        .where("id", "=", input.analyserId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw new Refusal("not_found");
      if (current.status === "retired") throw new Refusal("retired");
      await trx
        .updateTable("analysers")
        .set({ status: "retired", retired_at: ctx.now, updated_at: ctx.now })
        .where("id", "=", input.analyserId)
        .execute();
      await recordAudit(trx, {
        action: "analyser_retired",
        actor: { type: "user", id: ctx.actor.id },
        outcome: "success",
        target: { type: "analyser", id: input.analyserId },
        metadata: { analyser_status: "retired" },
      });
      return { ok: true, analyserId: input.analyserId };
    });
  } catch (error) {
    return refusalOf(error);
  }
}
