// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The Gen5 upload on the production build (#156; ASVS 5.0 V5.2.1; security review of #400, S1):
// a student posts through the real `uploadGen5Fn` FormData path, a file of exactly 5 MiB is
// stored and one byte more is `file_too_large`, and on a raw socket an anonymous form declaring
// the upload's limit is refused 413 with `Connection: close` before the client has sent it. The
// world and the files are invented (Q-PRIV-4).
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { GEN5_FORM_BODY_MAX } from "../../src/server/form-body-limit.ts";
import { MAX_UPLOAD_BYTES } from "../../src/server/upload/limits.ts";
import { buildZip, gen5Cells, workbookParts, type ZipPart } from "../fixtures/gen5/xlsx-builder.ts";
import { copyAccount, type TestAccount } from "./accounts";
import { devLogin } from "./fixtures";
import { rawPost } from "./raw-http";
import { appUrl } from "./run-env";

/** The serial number in the header of the invented export (`defaultSpec`). */
const READER_SERIAL = "EX000001";

let student: TestAccount;
let labId = "";

function database(): Kysely<DB> {
  const url = process.env["EDULIMS_E2E_DATABASE_URL"];
  if (!url) throw new Error("EDULIMS_E2E_DATABASE_URL is not set; playwright.config.ts sets it.");
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 1 }) }),
  });
}

async function onDb<T>(work: (db: Kysely<DB>) => Promise<T>): Promise<T> {
  const db = database();
  try {
    return await work(db);
  } finally {
    await db.destroy();
  }
}

/** The `.mjs` files of the server build, in every folder the bundler may put a chunk in. */
function serverModules(dir = join(".output", "server")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return serverModules(path);
    return entry.name.endsWith(".mjs") ? [path] : [];
  });
}

/**
 * The path the build gave `uploadGen5Fn`, read from the server bundle `pnpm start` serves. The
 * function has no screen yet, so the bundler may place it in any chunk, and Start adds `_<n>` to an
 * id it has already handed out; both are accepted.
 */
function uploadFnPath(): string {
  const pattern = /id:\s*"([0-9a-f]{64}(?:_\d+)?)",\s*name:\s*"uploadGen5Fn"/;
  const named: string[] = [];
  for (const file of serverModules()) {
    const source = readFileSync(file, "utf8");
    const match = pattern.exec(source);
    if (match?.[1]) return `/_serverFn/${match[1]}`;
    if (source.includes("uploadGen5Fn")) named.push(file);
  }
  throw new Error(
    `The build has no uploadGen5Fn id; files naming it: ${named.join(", ") || "none"}. Run pnpm build first.`,
  );
}

/** A good invented export padded with a stored entry to exactly `total` bytes. */
function exportOfSize(total: number): Buffer {
  const parts = (pad: number): ZipPart[] => [
    ...workbookParts({ sheets: [gen5Cells()] }),
    { name: "docProps/pad.bin", data: new Uint8Array(pad), method: 0 },
  ];
  const overhead = buildZip(parts(0)).length;
  const bytes = buildZip(parts(total - overhead));
  expect(bytes.length).toBe(total);
  return Buffer.from(bytes);
}

function upload(page: Page, file: Buffer) {
  return page.request.post(uploadFnPath(), {
    headers: { Origin: appUrl() },
    multipart: {
      labId,
      file: { name: "plate.xlsx", mimeType: "application/octet-stream", buffer: file },
    },
  });
}

async function uploads(): Promise<number> {
  const rows = await onDb((db) =>
    db.selectFrom("uploads").select("id").where("lab_id", "=", labId).execute(),
  );
  return rows.length;
}

test.beforeAll(async () => {
  student = await copyAccount("student@example.test", "gen5-upload-student");
  await onDb(async (db) => {
    const teacher = await db
      .selectFrom("user")
      .select("id")
      .where("email", "=", "teacher@example.test")
      .executeTakeFirstOrThrow();
    const { id: simulationId } = await db
      .insertInto("simulations")
      .values({
        name: `Gen5 upload ${randomBytes(4).toString("hex")}`,
        created_by: teacher.id,
        state: "running",
        started_at: sql<Date>`now()`,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const lab = await db
      .insertInto("labs")
      .values({ simulation_id: simulationId, name: "Upload lab" })
      .returning("id")
      .executeTakeFirstOrThrow();
    labId = lab.id;
    await db
      .insertInto("lab_members")
      .values({
        simulation_id: simulationId,
        lab_id: lab.id,
        user_id: student.id,
        joined_via: "email",
      })
      .execute();
    await db
      .insertInto("analysers")
      .values({
        model: "Epoch 2",
        serial_number: READER_SERIAL,
        location: "Practice lab (invented)",
        route: "excel_upload",
      })
      .onConflict((conflict) => conflict.columns(["model", "serial_number"]).doNothing())
      .execute();
  });
});

test("stores an export of exactly 5 MiB posted through the form path (V5.2.1)", async ({
  page,
}) => {
  await devLogin(page, student.email);
  const before = await uploads();
  const response = await upload(page, exportOfSize(MAX_UPLOAD_BYTES));
  expect(response.status()).toBe(200);
  expect(await response.text()).not.toContain("file_refused");
  expect(await uploads()).toBe(before + 1);
});

test("refuses an export one byte over 5 MiB with file_too_large, storing nothing (V5.2.1)", async ({
  page,
}) => {
  await devLogin(page, student.email);
  const before = await uploads();
  const response = await upload(page, exportOfSize(MAX_UPLOAD_BYTES + 1));
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain("file_too_large");
  expect(await uploads()).toBe(before);
});

test("refuses an anonymous form at the upload's limit with 413, unread (review of #400, S1)", async () => {
  const result = await rawPost(
    uploadFnPath(),
    { "Content-Type": "multipart/form-data; boundary=x" },
    GEN5_FORM_BODY_MAX,
  );
  expect(result.status).toMatch(/^HTTP\/1\.1 413\b/);
  expect(result.answer).toMatch(/\r\nconnection: close\r\n/i);
  expect(result.closedEarly).toBe(true);
  expect(result.written).toBeLessThan(GEN5_FORM_BODY_MAX);
});

test("refuses a signed-in form one byte over the upload's limit with 413, unread (S1)", async ({
  page,
}) => {
  await devLogin(page, student.email);
  const cookies = await page.context().cookies();
  const result = await rawPost(
    uploadFnPath(),
    {
      Cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
      "Content-Type": "multipart/form-data; boundary=x",
    },
    GEN5_FORM_BODY_MAX + 1,
  );
  expect(result.status).toMatch(/^HTTP\/1\.1 413\b/);
  expect(result.closedEarly).toBe(true);
});
