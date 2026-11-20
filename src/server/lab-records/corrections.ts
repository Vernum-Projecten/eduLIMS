// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The correction log of a team's records (S11, S12; maintainer, 2026-11-19 on #268): every change
// of a patient or a request after it was entered leaves a row with the fields it changed, their
// value before and after, who changed them and when (the database clock). The teachers of the
// simulation read it; the activity log gets ids only.
import "@tanstack/react-start/server-only";
import type { Transaction } from "kysely";
import { z } from "zod";
import type { DB } from "../db/schema.gen.ts";

/** A field of a patient or a request whose value is one text, a flag or nothing. */
export const PLAIN_FIELDS = [
  "name",
  "date_of_birth",
  "sex",
  "identifier",
  "requester",
  "phone_through",
  "remarks",
] as const;
export type PlainField = (typeof PLAIN_FIELDS)[number];

const plainValue = z.union([z.string(), z.boolean(), z.null()]);

/** One change of a correction. */
export const correctionChangeSchema = z.discriminatedUnion("field", [
  z.strictObject({ field: z.enum(PLAIN_FIELDS), before: plainValue, after: plainValue }),
  z.strictObject({
    field: z.literal("tests"),
    before: z.array(z.string()),
    after: z.array(z.string()),
  }),
  z.strictObject({
    field: z.enum(["sample_number", "material"]),
    sample_id: z.string(),
    before: z.string(),
    after: z.string(),
  }),
  z.strictObject({
    field: z.literal("sample_added"),
    sample_id: z.string(),
    sample_number: z.string(),
    material: z.string(),
    lab_number: z.string(),
  }),
]);
export type CorrectionChange = z.infer<typeof correctionChangeSchema>;

/** The changes of one correction, as the log stores them. */
export const correctionChangesSchema = z.array(correctionChangeSchema).min(1);

/**
 * Returns the plain fields whose value differs between `before` and `after`, in the order of
 * `fields`. A field that `after` leaves out is unchanged.
 */
export function plainChanges<K extends PlainField>(
  fields: readonly K[],
  before: Readonly<Record<K, string | boolean | null>>,
  after: Readonly<Partial<Record<K, string | boolean | null>>>,
): CorrectionChange[] {
  const changes: CorrectionChange[] = [];
  for (const field of fields) {
    const next = after[field];
    if (next === undefined || next === before[field]) continue;
    changes.push({ field, before: before[field], after: next });
  }
  return changes;
}

/** What a correction row is about: a patient or a request of one lab. */
export type CorrectionTarget =
  | { kind: "patient"; patientId: string }
  | { kind: "request"; requestId: string };

/** Writes one correction row in the transaction of the correction itself. */
export async function recordCorrection(
  trx: Transaction<DB>,
  lab: { simulationId: string; labId: string },
  target: CorrectionTarget,
  actorId: string,
  changes: readonly CorrectionChange[],
): Promise<void> {
  await trx
    .insertInto("record_corrections")
    .values({
      simulation_id: lab.simulationId,
      lab_id: lab.labId,
      patient_id: target.kind === "patient" ? target.patientId : null,
      request_id: target.kind === "request" ? target.requestId : null,
      corrected_by: actorId,
      changes: JSON.stringify(correctionChangesSchema.parse(changes)),
    })
    .execute();
}
