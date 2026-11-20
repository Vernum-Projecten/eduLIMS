// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The tests a request form asks for that the lab does not offer (S12, #398). The team writes them
// down as the form names them; eduLIMS stores them per request in the order typed and compares
// them with nothing: no catalogue, no reference list, no right or wrong (Q-SIM-1, W7).
import "@tanstack/react-start/server-only";
import type { Kysely, Transaction } from "kysely";
import type { NotOfferedTest } from "../../lib/lab-records.ts";
import type { DB } from "../db/schema.gen.ts";

/** Writes `entries` as the tests not offered of a request, replacing any it held. */
export async function replaceNotOffered(
  trx: Transaction<DB>,
  labId: string,
  requestId: string,
  entries: readonly NotOfferedTest[],
): Promise<void> {
  await trx.deleteFrom("request_tests_not_offered").where("request_id", "=", requestId).execute();
  if (entries.length === 0) return;
  await trx
    .insertInto("request_tests_not_offered")
    .values(
      entries.map((entry, position) => ({
        lab_id: labId,
        request_id: requestId,
        position,
        name: entry.name,
        remark: entry.remark,
      })),
    )
    .execute();
}

/**
 * Returns the tests not offered of each request of `requestIds`, in the order typed. The caller
 * has already checked that the reader may see those requests.
 */
export async function notOfferedOf(
  db: Kysely<DB> | Transaction<DB>,
  requestIds: readonly string[],
): Promise<Map<string, NotOfferedTest[]>> {
  const byRequest = new Map<string, NotOfferedTest[]>();
  if (requestIds.length === 0) return byRequest;
  const rows = await db
    .selectFrom("request_tests_not_offered")
    .select(["request_id", "name", "remark"])
    .where("request_id", "in", [...requestIds])
    .orderBy("request_id")
    .orderBy("position")
    .execute();
  for (const row of rows) {
    const list = byRequest.get(row.request_id) ?? [];
    list.push({ name: row.name, remark: row.remark });
    byRequest.set(row.request_id, list);
  }
  return byRequest;
}

/** Returns whether two lists of tests not offered hold the same entries in the same order. */
export function sameNotOffered(
  a: readonly NotOfferedTest[],
  b: readonly NotOfferedTest[],
): boolean {
  return (
    a.length === b.length &&
    a.every((entry, index) => entry.name === b[index]?.name && entry.remark === b[index]?.remark)
  );
}
