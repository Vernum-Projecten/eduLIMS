// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The server's lab numbers (S12, R-11): drawn from a cryptographic source, never with a leading
// zero, unique under the database constraint, drawn again on a collision, and failing loud when
// the source keeps colliding.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { isLabNumber, withCheckDigit } from "../../lib/lab-number.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import {
  type DigitSource,
  drawLabNumber,
  insertSample,
  LAB_NUMBER_ATTEMPTS,
  LabNumberExhaustedError,
} from "./lab-number.ts";
import { patientIn, recordsWorld, requestFor } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

/** A digit source that returns the values of `draws` in turn. */
function fixed(...draws: number[]): DigitSource {
  let index = 0;
  return () => {
    const value = draws[index % draws.length] ?? 0;
    index += 1;
    return value;
  };
}

describe("drawLabNumber (S12)", () => {
  it("puts a first digit of 1 to 9 before eight digits and the check digit", () => {
    expect(drawLabNumber(fixed(0, 0))).toBe(withCheckDigit("100000000"));
    expect(drawLabNumber(fixed(8, 99_999_999))).toBe(withCheckDigit("999999999"));
    expect(drawLabNumber(fixed(4, 1234))).toBe(withCheckDigit("500001234"));
  });

  it("draws valid lab numbers from the default source", () => {
    for (let n = 0; n < 50; n += 1) expect(isLabNumber(drawLabNumber())).toBe(true);
  });
});

describe("insertSample (S12, R-11)", () => {
  async function open() {
    db = await createTestDb();
    const w = await recordsWorld(db);
    const patientId = await patientIn(db, w.student, w.labId);
    const recorded = await requestFor(db, w.student, w.labId, patientId, [w.hba1c]);
    const taken = recorded.samples[0]?.labNumber ?? "";
    return { database: db, w, recorded, taken };
  }

  it("draws again when the drawn number is taken", async () => {
    const { database, w, recorded, taken } = await open();
    const first = Number(taken.slice(0, 1)) - 1;
    const rest = Number(taken.slice(1, 9));
    const source = fixed(first, rest, 0, 7);
    const stored = await database.transaction().execute((trx) =>
      insertSample(
        trx,
        {
          simulationId: w.simulationId,
          labId: w.labId,
          requestId: recorded.requestId,
          sampleNumber: "S-002",
          material: "plasma",
          actorId: w.student.id,
        },
        source,
      ),
    );
    expect(stored.labNumber).toBe(withCheckDigit("100000007"));
  });

  it("fails loud after every draw collided", async () => {
    const { database, w, recorded, taken } = await open();
    const source = fixed(Number(taken.slice(0, 1)) - 1, Number(taken.slice(1, 9)));
    let draws = 0;
    const counted = (max: number) => {
      draws += 1;
      return source(max);
    };
    await expect(
      database.transaction().execute((trx) =>
        insertSample(
          trx,
          {
            simulationId: w.simulationId,
            labId: w.labId,
            requestId: recorded.requestId,
            sampleNumber: "S-002",
            material: "plasma",
            actorId: w.student.id,
          },
          counted,
        ),
      ),
    ).rejects.toThrow(LabNumberExhaustedError);
    expect(draws).toBe(LAB_NUMBER_ATTEMPTS * 2);
  });
});
