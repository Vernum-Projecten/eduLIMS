// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The email list of a lab (D10: "adds the members of a lab by pasting their email addresses").
// A pasted list is classified per line before anything is stored; only `new` lines are stored,
// as addresses that wait until the student signs in (S10). No line says whether an account
// exists: an address outside the simulation is `new` whether or not someone uses it.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { z } from "zod";
import { normalizeEmail } from "../../lib/simulations.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import { done, refused, type SimulationActor, type SimulationResult, withLab } from "./access.ts";
import { clearRemovalsOfAddresses } from "./removals.ts";

/** How one line of a pasted list fares; only `new` lines are stored. */
export const EMAIL_LINE_STATUSES = [
  "new",
  "invalid",
  "repeated",
  "in_this_lab",
  "in_other_lab",
] as const;
export type EmailLineStatus = (typeof EMAIL_LINE_STATUSES)[number];

/** One line of the preview, in the order of the list. */
export interface EmailLine {
  /** The line as the server compares it: trimmed and lower case. */
  email: string;
  status: EmailLineStatus;
  /** The lab of this simulation the address is in or waits for, on an `in_other_lab` line. */
  otherLab?: { id: string; name: string };
}

/** The outcome of adding a list: how many addresses now wait, and every line with its status. */
export interface EmailListOutcome {
  added: number;
  lines: EmailLine[];
}

const address = z.email();

/**
 * Classifies the lines of a list against the simulation of `labId`, read inside the caller's
 * transaction: invalid, repeated, already in this lab (a member or waiting), in another lab of
 * the simulation (a member or waiting there), or new.
 */
export async function classifyEmails(
  trx: Kysely<DB>,
  simulationId: string,
  labId: string,
  lines: readonly string[],
): Promise<EmailLine[]> {
  const normalized = lines.map(normalizeEmail);
  const valid = [...new Set(normalized.filter((email) => address.safeParse(email).success))];
  const [members, waiting] = valid.length
    ? await Promise.all([
        trx
          .selectFrom("lab_members")
          .innerJoin("user", "user.id", "lab_members.user_id")
          .innerJoin("labs", "labs.id", "lab_members.lab_id")
          .select((eb) => [
            eb.fn<string>("lower", ["user.email"]).as("email"),
            "labs.id as lab_id",
            "labs.name as lab_name",
          ])
          .where("lab_members.simulation_id", "=", simulationId)
          .where((eb) => eb(eb.fn("lower", ["user.email"]), "in", valid))
          .execute(),
        trx
          .selectFrom("lab_member_emails")
          .innerJoin("labs", "labs.id", "lab_member_emails.lab_id")
          .select(["lab_member_emails.email", "labs.id as lab_id", "labs.name as lab_name"])
          .where("lab_member_emails.simulation_id", "=", simulationId)
          .where("lab_member_emails.email", "in", valid)
          .execute(),
      ])
    : [[], []];
  const placeOf = new Map<string, { id: string; name: string }>();
  for (const row of [...members, ...waiting]) {
    placeOf.set(row.email, { id: row.lab_id, name: row.lab_name });
  }
  const seen = new Set<string>();
  return normalized.map((email): EmailLine => {
    if (!address.safeParse(email).success) return { email, status: "invalid" };
    if (seen.has(email)) return { email, status: "repeated" };
    seen.add(email);
    const place = placeOf.get(email);
    if (!place) return { email, status: "new" };
    if (place.id === labId) return { email, status: "in_this_lab" };
    return { email, status: "in_other_lab", otherLab: place };
  });
}

/** Returns the preview of a pasted list for a lab the actor teaches: nothing is stored. */
export function previewEmails(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { labId: string; emails: readonly string[] },
): Promise<SimulationResult<EmailLine[]>> {
  // NOTE: #300 review; nothing is stored, so the preview shares the simulation row.
  return withLab(
    db,
    actor,
    input.labId,
    async (trx, lab) => done(await classifyEmails(trx, lab.simulationId, lab.labId, input.emails)),
    "share",
  );
}

/**
 * Stores every `new` line of a list as an address waiting in a lab the actor teaches, in one
 * transaction with one `lab_emails_added` row that carries the count, never an address. A new
 * address clears the removal record of its account, so the teacher lets a removed student back.
 */
export function addEmails(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { labId: string; emails: readonly string[] },
  now: Date,
): Promise<SimulationResult<EmailListOutcome>> {
  return withLab(db, actor, input.labId, async (trx, lab) => {
    const lines = await classifyEmails(trx, lab.simulationId, lab.labId, input.emails);
    const fresh = lines.filter((line) => line.status === "new").map((line) => line.email);
    if (fresh.length > 0) {
      await trx
        .insertInto("lab_member_emails")
        .values(
          fresh.map((email) => ({
            simulation_id: lab.simulationId,
            lab_id: lab.labId,
            email,
            added_by: actor.id,
            added_at: now,
          })),
        )
        .execute();
      await clearRemovalsOfAddresses(trx, lab.simulationId, fresh);
    }
    await recordAudit(trx, {
      action: "lab_emails_added",
      actor: { type: "user", id: actor.id },
      outcome: "success",
      target: { type: "lab", id: lab.labId },
      metadata: { simulation_id: lab.simulationId, count: fresh.length },
    });
    return done({ added: fresh.length, lines });
  });
}

/** Removes an address that waits in a lab the actor teaches; the log row names no address. */
export function removeEmail(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { labId: string; email: string },
): Promise<SimulationResult> {
  return withLab(db, actor, input.labId, async (trx, lab) => {
    const removed = await trx
      .deleteFrom("lab_member_emails")
      .where("simulation_id", "=", lab.simulationId)
      .where("lab_id", "=", lab.labId)
      .where("email", "=", normalizeEmail(input.email))
      .returning("email")
      .executeTakeFirst();
    if (!removed) return refused("email_not_found");
    await recordAudit(trx, {
      action: "lab_email_removed",
      actor: { type: "user", id: actor.id },
      outcome: "success",
      target: { type: "lab", id: lab.labId },
      metadata: { simulation_id: lab.simulationId },
    });
    return done(null);
  });
}
