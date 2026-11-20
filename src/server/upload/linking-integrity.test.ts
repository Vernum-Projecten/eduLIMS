// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The wiring of the plate check's defects (security review of #372; V2.2.3, V16.3.3, V16.4.1,
// V16.5.1): a sample of another lab or a lab number twice in the caller's own query is a generic
// error with no detail, one security-log line with the user and lab ids, and nothing stored. The
// samples query cannot return either, so the check is made to throw here.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { securityLines } from "../simulations/test-helpers.ts";
import { UploadIntegrityError } from "./linking.ts";
import { DuplicateLabNumberError, ForeignSampleError } from "./plate-links.ts";
import { link, linkOf, uploaded, uploadWorld } from "./test-helpers.ts";

const thrown = vi.hoisted(() => ({ error: new Error("unset") }));

vi.mock("./plate-links.ts", async (original) => {
  const actual = await original<typeof import("./plate-links.ts")>();
  return {
    ...actual,
    checkPlateLinks: (input: Parameters<typeof actual.checkPlateLinks>[0]) => {
      if (input.links.length > 0) throw thrown.error;
      return actual.checkPlateLinks(input);
    },
  };
});

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

describe("a defect of the plate check (security review of #372)", () => {
  it.each([
    ["a sample of another lab", new ForeignSampleError("x"), "foreign_sample"],
    ["a lab number twice", new DuplicateLabNumberError("x"), "duplicate_lab_number"],
  ])("turns %s into a generic error and one security line", async (_, error, reason) => {
    const database = await createTestDb();
    db = database;
    const w = await uploadWorld(database);
    const uploadId = await uploaded(database, w.student, w.labId);
    thrown.error = error;
    let caught: unknown;
    const lines = await securityLines(async () => {
      caught = await link(database, w, linkOf(w, uploadId)).catch((failure: unknown) => failure);
    });
    expect(caught).toBeInstanceOf(UploadIntegrityError);
    expect(caught).toMatchObject({ message: "the upload could not be linked" });
    expect(Object.hasOwn(caught instanceof Error ? caught : {}, "cause")).toBe(false);
    expect(lines).toEqual([
      {
        time: expect.any(String),
        level: "error",
        app: expect.any(String),
        log: expect.any(String),
        event: "upload_integrity_fail",
        outcome: "failure",
        actor_type: "user",
        actor_id: w.student.id,
        target_type: "lab",
        target_id: w.labId,
        reason,
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain("A1");
    const stored = await database
      .selectFrom("measurements")
      .select("id")
      .where("source", "=", "epoch_upload")
      .execute();
    expect(stored).toEqual([]);
  });
});
