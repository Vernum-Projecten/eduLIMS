// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The logo upload on the production build (#292, ASVS 5.0 V5.2.1; the security review of #346):
// a teacher posts the logo through the real `uploadLabLogoFn` FormData path, a file of exactly
// 512 KiB is stored and one byte more is `logo_too_large` with its activity-log row, and on a raw
// socket a form whose body runs past its declared length stores nothing, while a form declaring
// 100 MiB is refused with 413 and `Connection: close` before the client has sent it all.
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { LOGO_MAX_BYTES } from "../../src/lib/lab-logo.ts";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { png, pngChunk } from "../../src/server/logo/test-images.ts";
import { copyAccount, type TestAccount } from "./accounts";
import { devLogin } from "./fixtures";
import { appUrl } from "./run-env";

let teacher: TestAccount;
const labs: Record<"exact" | "over" | "overrun" | "declared", string> = {
  exact: "",
  over: "",
  overrun: "",
  declared: "",
};

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

/** The id the build gave `uploadLabLogoFn`, read from the server bundle `pnpm start` serves. */
function uploadFnPath(): string {
  const dir = join(".output", "server", "_ssr");
  const pattern = /id: "([0-9a-f]{64})",\s+name: "uploadLabLogoFn"/;
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".mjs"))) {
    const match = pattern.exec(readFileSync(join(dir, file), "utf8"));
    if (match?.[1]) return `/_serverFn/${match[1]}`;
  }
  throw new Error("The build has no uploadLabLogoFn; run pnpm build first.");
}

/** A valid PNG of exactly `size` bytes, padded with a private chunk the filter drops. */
function pngOfSize(size: number): Buffer {
  const base = png(16, 16);
  const padded = png(16, 16, {
    before: [pngChunk("prVt", new Uint8Array(size - base.length - 12))],
  });
  expect(padded.length).toBe(size);
  return Buffer.from(padded);
}

function upload(page: Page, labId: string, file: Buffer) {
  return page.request.post(uploadFnPath(), {
    headers: { Origin: appUrl() },
    multipart: {
      labId,
      file: { name: "renamed.svg", mimeType: "image/svg+xml", buffer: file },
    },
  });
}

async function storedSize(labId: string): Promise<number | undefined> {
  const row = await onDb((db) =>
    db.selectFrom("lab_logos").select("byte_size").where("lab_id", "=", labId).executeTakeFirst(),
  );
  return row?.byte_size;
}

test.beforeAll(async () => {
  teacher = await copyAccount("teacher@example.test", "logo-upload-teacher");
  await onDb(async (db) => {
    const { id: simulationId } = await db
      .insertInto("simulations")
      .values({ name: `Logo upload ${randomBytes(4).toString("hex")}`, created_by: teacher.id })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("simulation_teachers")
      .values({ simulation_id: simulationId, user_id: teacher.id })
      .execute();
    for (const key of Object.keys(labs) as (keyof typeof labs)[]) {
      const lab = await db
        .insertInto("labs")
        .values({ simulation_id: simulationId, name: `Upload ${key}` })
        .returning("id")
        .executeTakeFirstOrThrow();
      labs[key] = lab.id;
    }
  });
});

test("stores a PNG of exactly 512 KiB posted through the form path (V5.2.1)", async ({ page }) => {
  await devLogin(page, teacher.email);
  const response = await upload(page, labs.exact, pngOfSize(LOGO_MAX_BYTES));
  expect(response.status()).toBe(200);
  expect(await response.text()).not.toContain("logo_");
  // The private padding chunk is dropped, so the stored logo is smaller than the upload.
  expect(await storedSize(labs.exact)).toBe(png(16, 16).length);
});

test("refuses a PNG one byte over 512 KiB with logo_too_large and logs it (V5.2.1, E4)", async ({
  page,
}) => {
  await devLogin(page, teacher.email);
  const response = await upload(page, labs.over, pngOfSize(LOGO_MAX_BYTES + 1));
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain("logo_too_large");
  expect(await storedSize(labs.over)).toBeUndefined();
  const rows = await onDb((db) =>
    db
      .selectFrom("audit_event")
      .select(["actor_id", "outcome", "reason_code"])
      .where("action", "=", "lab_logo_changed")
      .where("target_id", "=", labs.over)
      .execute(),
  );
  expect(rows).toEqual([
    { actor_id: teacher.id, outcome: "refused", reason_code: "logo_too_large" },
  ]);
});

/** The cookie header of the signed-in page, for a raw socket. */
async function cookieHeader(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

/** The head of a multipart POST to the upload function, declaring `length` bytes. */
function head(path: string, cookie: string, length: number): string {
  const url = new URL(appUrl());
  return [
    `POST ${path} HTTP/1.1`,
    `Host: ${url.host}`,
    `Origin: ${url.origin}`,
    `Cookie: ${cookie}`,
    "Content-Type: multipart/form-data; boundary=x",
    `Content-Length: ${length}`,
    "",
    "",
  ].join("\r\n");
}

interface RawResult {
  /** The first status line the server sent, if any. */
  status: string;
  /** The raw answer, headers and bodies. */
  answer: string;
  /** How many body bytes the client wrote before the socket closed. */
  written: number;
}

/**
 * Sends `head`, then up to `total` body bytes in 64 KiB writes on a raw socket, stopping when the
 * server closes it, and resolves with what came back.
 */
function rawPost(headText: string, total: number): Promise<RawResult> {
  const url = new URL(appUrl());
  return new Promise((resolve) => {
    const socket = connect({ host: url.hostname, port: Number(url.port) });
    let answer = "";
    let written = 0;
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      resolve({ status: answer.split("\r\n")[0] ?? "", answer, written });
    };
    socket.on("data", (chunk) => {
      answer += chunk.toString("latin1");
    });
    socket.on("close", finish);
    socket.on("error", finish);
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    const pump = () => {
      while (!closed && written < total) {
        const size = Math.min(chunk.length, total - written);
        written += size;
        if (!socket.write(chunk.subarray(0, size))) {
          socket.once("drain", pump);
          return;
        }
      }
      if (!closed && written >= total) setTimeout(() => socket.end(), 2_000);
    };
    socket.write(headText, pump);
  });
}

test("stores nothing from a form whose body runs past its declared length (V5.2.1)", async ({
  page,
}) => {
  await devLogin(page, teacher.email);
  const cookie = await cookieHeader(page);
  const result = await rawPost(head(uploadFnPath(), cookie, 1000), 600 * 1024);
  expect(result.status).toMatch(/^HTTP\/1\.1 /);
  expect(result.status).not.toMatch(/^HTTP\/1\.1 2/);
  expect(await storedSize(labs.overrun)).toBeUndefined();
});

test("refuses a form declaring 100 MiB with 413 and closes before it is sent (V5.2.1)", async ({
  page,
}) => {
  await devLogin(page, teacher.email);
  const cookie = await cookieHeader(page);
  const total = 100 * 1024 * 1024;
  const result = await rawPost(head(uploadFnPath(), cookie, total), total);
  expect(result.status).toMatch(/^HTTP\/1\.1 413\b/);
  expect(result.answer.toLowerCase()).toContain("connection: close");
  expect(result.written).toBeLessThan(total);
  expect(await storedSize(labs.declared)).toBeUndefined();
});
