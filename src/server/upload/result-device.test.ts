// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A released result from an Epoch 2 upload names the reader by its serial number in the analyser
// register, never the text of the file (#152, #148 `resolveDevice`; maintainer on #400, S2), so it is written to the patient's record and does not stay
// pending with `build:no_device_identifier`. FerroEHR is stubbed; values are invented (Q-PRIV-4).
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { writeReleasedResult } from "../results/ehr-write.ts";
import { releaseResult } from "../results/release.ts";
import { ferroEhr, SETTINGS, writeRow } from "../results/test-ehr-write.ts";
import { toleranceFor } from "../results/test-helpers.ts";
import { link, linkOf, uploaded, uploadWorld } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

describe("the device of an Epoch 2 result (#152, #148)", () => {
  it("is the upload's reader, by its serial number in the register (maintainer on #400, S2)", async () => {
    const database = await createTestDb();
    db = database;
    const w = await uploadWorld(database);
    const uploadId = await uploaded(database, w.student, w.labId);
    const linked = await link(database, w, linkOf(w, uploadId));
    const measurementId = linked.ok ? linked.value.measurements[0]?.measurementId : undefined;
    if (measurementId === undefined) throw new Error("no measurement");
    const toleranceId = await toleranceFor(database, w.student, w.labId, w.teamTest, "1", "9");
    const release = await releaseResult(database, w.student, {
      labId: w.labId,
      requestId: w.epochRequestId,
      testId: w.teamTest,
      measurementId,
      toleranceId,
    });
    expect(release.ok).toBe(true);
    // The register is the source: an administrator's correction of the serial reaches the write.
    await database
      .updateTable("analysers")
      .set({ serial_number: "REG0001" })
      .where("id", "=", w.readerId)
      .execute();
    const { client } = ferroEhr();
    expect(
      await writeReleasedResult({ db: database, client, settings: SETTINGS }, measurementId),
    ).toBe("written");
    expect(await writeRow(database, measurementId)).toMatchObject({ state: "written" });
    const [, body] = client.createContribution.mock.calls[0] ?? [];
    expect(JSON.stringify(body)).toContain("REG0001");
    expect(JSON.stringify(body)).not.toContain("2204112B");
  });
});
