// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The lab logo service (D10, S10, Q-SEC-2, #292): a teacher of the simulation sets, replaces and
// removes it, every write and every refused file leaves its activity-log row with ids and codes
// only, and only the lab's members and its simulation's teachers read it.
import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { LOGO_MAX_BYTES, LOGO_MAX_SIDE } from "../../lib/lab-logo.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import {
  ascii,
  contains,
  exifWithPosition,
  jpeg,
  jpegMetadataSegments,
  png,
  pngMetadataChunks,
} from "../logo/test-images.ts";
import { done, refused, type SimulationResult } from "./access.ts";
import { deleteLab } from "./labs.ts";
import { type LogoResult, readLabLogo, removeLabLogo, setLabLogo } from "./logo.ts";
import { teacherWriteRefusals } from "./test-access.ts";
import {
  auditRows,
  NOW,
  type Person,
  person,
  securityLines,
  type World,
  world,
} from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<{ database: Kysely<DB>; w: World }> {
  db = await createTestDb();
  return { database: db, w: await world(db) };
}

async function storedLogo(database: Kysely<DB>, labId: string) {
  return database
    .selectFrom("lab_logos")
    .select(["content", "media_type", "byte_size", "width", "height", "sha256", "updated_by"])
    .where("lab_id", "=", labId)
    .executeTakeFirst();
}

/** Maps a logo result onto the shape of the shared refusal cases: a content refusal is a bug. */
function asSimulationResult<T>(result: LogoResult<T>): SimulationResult<T> {
  if (result.ok) return done(result.value);
  if (result.error === "not_found") return refused("not_found");
  throw new Error(`unexpected refusal ${result.error}`);
}

const POSITION = exifWithPosition();

describe("setLabLogo (D10, #292)", () => {
  it("stores a PNG with its type, size, dimensions and hash, and no file name", async () => {
    const { database, w } = await open();
    const bytes = png(40, 20);
    const result = await setLabLogo(database, w.coTeacher, { labId: w.labId, bytes }, NOW);
    expect(result).toEqual({
      ok: true,
      value: { mediaType: "image/png", width: 40, height: 20, byteSize: bytes.length },
    });
    const row = await storedLogo(database, w.labId);
    expect(row).toEqual({
      content: Buffer.from(bytes),
      media_type: "image/png",
      byte_size: bytes.length,
      width: 40,
      height: 20,
      sha256: createHash("sha256").update(bytes).digest(),
      updated_by: w.coTeacher.id,
    });
    const columns = await database.introspection.getTables();
    const table = columns.find((t) => t.name === "lab_logos");
    expect(table?.columns.map((c) => c.name).sort()).toEqual([
      "byte_size",
      "content",
      "height",
      "lab_id",
      "media_type",
      "sha256",
      "updated_at",
      "updated_by",
      "width",
    ]);
  });

  it("logs a new logo as added, with ids and codes only (E4)", async () => {
    const { database, w } = await open();
    await setLabLogo(database, w.teacher, { labId: w.labId, bytes: png() }, NOW);
    expect(await auditRows(database, "lab_logo_changed")).toEqual([
      {
        actor_id: w.teacher.id,
        outcome: "success",
        target_type: "lab",
        target_id: w.labId,
        reason_code: null,
        metadata: { simulation_id: w.simulationId, logo_change: "added" },
      },
    ]);
  });

  it("replaces the logo a lab has, logged as replaced", async () => {
    const { database, w } = await open();
    await setLabLogo(database, w.teacher, { labId: w.labId, bytes: png() }, NOW);
    const second = jpeg(16, 8);
    const result = await setLabLogo(database, w.coTeacher, { labId: w.labId, bytes: second }, NOW);
    expect(result.ok).toBe(true);
    expect(await storedLogo(database, w.labId)).toMatchObject({
      content: Buffer.from(second),
      media_type: "image/jpeg",
      width: 16,
      height: 8,
      updated_by: w.coTeacher.id,
    });
    const rows = await auditRows(database, "lab_logo_changed");
    expect(rows.map((row) => row.metadata)).toEqual([
      { simulation_id: w.simulationId, logo_change: "added" },
      { simulation_id: w.simulationId, logo_change: "replaced" },
    ]);
  });

  it("stores the image of a photo without its location: the stored bytes carry no metadata", async () => {
    const { database, w } = await open();
    for (const bytes of [
      jpeg(32, 32, { before: jpegMetadataSegments() }),
      png(8, 8, { before: pngMetadataChunks() }),
    ]) {
      expect(contains(bytes, POSITION)).toBe(true);
      const result = await setLabLogo(database, w.teacher, { labId: w.labId, bytes }, NOW);
      expect(result.ok).toBe(true);
      const row = await storedLogo(database, w.labId);
      if (!row) throw new Error("no logo stored");
      expect(contains(row.content, POSITION)).toBe(false);
      expect(contains(row.content, ascii("invented"))).toBe(false);
      expect(row.byte_size).toBeLessThan(bytes.length);
      expect(row.sha256).toEqual(createHash("sha256").update(row.content).digest());
    }
  });

  const refusals: [string, () => Uint8Array, string][] = [
    [
      "a renamed file (a GIF the screen called logo.png)",
      () => ascii("GIF89a\x01\x00\x01\x00;"),
      "logo_unsupported_type",
    ],
    [
      "an SVG",
      () => ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      "logo_unsupported_type",
    ],
    [
      "a polyglot (an HTML page with a PNG inside)",
      () => new Uint8Array([...ascii("<html><body><!--"), ...png(), ...ascii("--></body></html>")]),
      "logo_unsupported_type",
    ],
    ["a file over 512 KiB", () => new Uint8Array(LOGO_MAX_BYTES + 1).fill(0x89), "logo_too_large"],
    ["an image over 1024 pixels wide", () => png(LOGO_MAX_SIDE + 1, 1), "logo_too_many_pixels"],
    ["a PNG with a broken CRC", () => png().fill(0, 30, 31), "logo_malformed"],
  ];

  it.each(refusals)(
    "refuses %s with a typed error and stores nothing",
    async (_name, bytes, code) => {
      const { database, w } = await open();
      const result = await setLabLogo(database, w.teacher, { labId: w.labId, bytes: bytes() }, NOW);
      expect(result).toEqual({ ok: false, error: code });
      expect(await storedLogo(database, w.labId)).toBeUndefined();
    },
  );

  it.each(refusals)("logs %s without its content (E4, A09)", async (_name, bytes, code) => {
    const { database, w } = await open();
    const file = bytes();
    const lines = await securityLines(() =>
      setLabLogo(database, w.teacher, { labId: w.labId, bytes: file }, NOW),
    );
    expect(await auditRows(database, "lab_logo_changed")).toEqual([
      {
        actor_id: w.teacher.id,
        outcome: "refused",
        target_type: "lab",
        target_id: w.labId,
        reason_code: code,
        metadata: { simulation_id: w.simulationId },
      },
    ]);
    expect(lines).toEqual([
      expect.objectContaining({
        event: "lab_logo_changed",
        level: "warn",
        outcome: "refused",
        reason: code,
        actor_id: w.teacher.id,
        target_id: w.labId,
      }),
    ]);
    const logged = JSON.stringify(lines);
    expect(logged).not.toContain("svg");
    expect(logged).not.toContain("html");
    expect(logged).not.toContain(w.teacher.email);
  });

  it("stores a polyglot that starts as a PNG as the PNG alone (an HTML page after IEND)", async () => {
    const { database, w } = await open();
    const bytes = png(2, 2, { trailing: ascii("<html><script>alert(1)</script></html>") });
    expect((await setLabLogo(database, w.teacher, { labId: w.labId, bytes }, NOW)).ok).toBe(true);
    const row = await storedLogo(database, w.labId);
    expect(row?.content).toEqual(Buffer.from(png(2, 2)));
  });

  it("keeps the old logo when a replacement is refused", async () => {
    const { database, w } = await open();
    const first = png(3, 3);
    await setLabLogo(database, w.teacher, { labId: w.labId, bytes: first }, NOW);
    await setLabLogo(database, w.teacher, { labId: w.labId, bytes: ascii("<svg/>") }, NOW);
    expect((await storedLogo(database, w.labId))?.content).toEqual(Buffer.from(first));
  });

  it("refuses a lab that is gone with not_found, logged", async () => {
    const { database, w } = await open();
    const emptyLab = w.otherLabId;
    await database.deleteFrom("lab_members").where("lab_id", "=", emptyLab).execute();
    expect((await deleteLab(database, w.teacher, { labId: emptyLab })).ok).toBe(true);
    const result = await setLabLogo(database, w.teacher, { labId: emptyLab, bytes: png() }, NOW);
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  describe("access (E1, R-01)", () => {
    teacherWriteRefusals({
      call: async (database, _w, actor, target) =>
        asSimulationResult(await setLabLogo(database, actor, { labId: target, bytes: png() }, NOW)),
      target: (w) => ({ type: "lab", id: w.labId }),
    });
  });
});

describe("removeLabLogo (D10, #292)", () => {
  it("removes the logo, logged as removed", async () => {
    const { database, w } = await open();
    await setLabLogo(database, w.teacher, { labId: w.labId, bytes: png() }, NOW);
    expect(await removeLabLogo(database, w.coTeacher, { labId: w.labId })).toEqual(done(null));
    expect(await storedLogo(database, w.labId)).toBeUndefined();
    const rows = await auditRows(database, "lab_logo_changed");
    expect(rows.at(-1)).toEqual({
      actor_id: w.coTeacher.id,
      outcome: "success",
      target_type: "lab",
      target_id: w.labId,
      reason_code: null,
      metadata: { simulation_id: w.simulationId, logo_change: "removed" },
    });
  });

  it("leaves a lab without a logo as it is, with no activity-log row", async () => {
    const { database, w } = await open();
    expect(await removeLabLogo(database, w.teacher, { labId: w.labId })).toEqual(done(null));
    expect(await auditRows(database, "lab_logo_changed")).toEqual([]);
  });

  it("goes with its lab when the lab is deleted", async () => {
    const { database, w } = await open();
    await setLabLogo(database, w.teacher, { labId: w.otherLabId, bytes: png() }, NOW);
    await database.deleteFrom("lab_members").where("lab_id", "=", w.otherLabId).execute();
    expect((await deleteLab(database, w.teacher, { labId: w.otherLabId })).ok).toBe(true);
    expect(await storedLogo(database, w.otherLabId)).toBeUndefined();
  });

  describe("access (E1, R-01)", () => {
    teacherWriteRefusals({
      call: (database, _w, actor, target) => removeLabLogo(database, actor, { labId: target }),
      target: (w) => ({ type: "lab", id: w.labId }),
      prepare: async (database, w) => {
        const result = await setLabLogo(database, w.teacher, { labId: w.labId, bytes: png() }, NOW);
        if (!result.ok) throw new Error(result.error);
      },
    });
  });
});

describe("readLabLogo (S10, D10, D11, #280)", () => {
  async function withLogo() {
    const opened = await open();
    const result = await setLabLogo(
      opened.database,
      opened.w.teacher,
      { labId: opened.w.labId, bytes: png(5, 5) },
      NOW,
    );
    if (!result.ok) throw new Error(result.error);
    return opened;
  }

  const readers: [string, (w: World) => Person][] = [
    ["a student of the lab", (w) => w.student],
    ["the last student of the lab", (w) => w.labStudents.at(-1) ?? w.student],
    ["the teacher who created the simulation", (w) => w.teacher],
    ["a co-teacher of the simulation", (w) => w.coTeacher],
  ];
  it.each(readers)("gives the logo to %s", async (_name, readerOf) => {
    const { database, w } = await withLogo();
    const read = await readLabLogo(database, readerOf(w), w.labId);
    expect(read).toEqual({
      access: true,
      logo: {
        content: Buffer.from(png(5, 5)),
        mediaType: "image/png",
        byteSize: png(5, 5).length,
      },
    });
  });

  const outsiders: [string, (w: World, database: Kysely<DB>) => Promise<Person>][] = [
    ["a student of another lab of the simulation", async (w) => w.otherLabStudent],
    ["a student outside the simulation", async (w) => w.outsideStudent],
    ["a student in no lab", async (w) => w.stranger],
    ["a teacher of another simulation", async (w) => w.outsiderTeacher],
    ["an administrator", async (w) => w.admin],
    [
      "an administrator who also teaches another simulation",
      async (_w, database) => person(database, "admin-teacher", ["teacher", "admin"]),
    ],
    [
      "a former teacher whose row stayed but whose role is now student",
      async (w, database) => {
        const former = await person(database, "former", ["student"]);
        await database
          .insertInto("simulation_teachers")
          .values({ simulation_id: w.simulationId, user_id: former.id })
          .execute();
        return former;
      },
    ],
    [
      "a teacher listed as a member of the lab",
      async (w, database) => {
        const odd = await person(database, "member-teacher", ["teacher"]);
        await database
          .insertInto("lab_members")
          .values({
            simulation_id: w.outsideSimulationId,
            lab_id: w.outsideLabId,
            user_id: odd.id,
            joined_via: "email",
          })
          .execute();
        return odd;
      },
    ],
  ];
  it.each(outsiders)("gives no access to %s", async (_name, readerOf) => {
    const { database, w } = await withLogo();
    const reader = await readerOf(w, database);
    expect(await readLabLogo(database, reader, w.labId)).toEqual({ access: false });
  });

  it("gives an administrator who teaches the simulation the logo, as a teacher", async () => {
    const { database, w } = await withLogo();
    const both = await person(database, "teacher-admin", ["teacher", "admin"]);
    await database
      .insertInto("simulation_teachers")
      .values({ simulation_id: w.simulationId, user_id: both.id })
      .execute();
    expect((await readLabLogo(database, both, w.labId)).access).toBe(true);
  });

  it("tells a reader with access that the lab has no logo", async () => {
    const { database, w } = await open();
    expect(await readLabLogo(database, w.student, w.labId)).toEqual({ access: true, logo: null });
    expect(await readLabLogo(database, w.teacher, w.labId)).toEqual({ access: true, logo: null });
  });

  it.each(["not-a-uuid", "00000000-0000-7000-8000-000000000000"])(
    "gives no access for the lab id %s",
    async (labId) => {
      const { database, w } = await withLogo();
      expect(await readLabLogo(database, w.teacher, labId)).toEqual({ access: false });
    },
  );
});
