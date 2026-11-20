// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The lab logo on the production build (D10, S10, #292): the server route serves the stored logo
// with its headers to a student of the lab and a teacher of the simulation, the same empty 404 to
// an administrator, a student of no lab and a signed-out caller, and a form too large for a
// server function is refused before it is read. The screens that upload come with #293.
import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { FORM_BODY_MAX } from "../../src/server/form-body-limit.ts";
import { png } from "../../src/server/logo/test-images.ts";
import { copyAccount, type TestAccount } from "./accounts";
import { devLogin } from "./fixtures";
import { appUrl } from "./run-env";

const LOGO = png(12, 8);
const ETAG = /^"[0-9a-f]{64}"$/;

let labId = "";
let teacher: TestAccount;
let student: TestAccount;
let stranger: TestAccount;

function database(): Kysely<DB> {
  const url = process.env["EDULIMS_E2E_DATABASE_URL"];
  if (!url) throw new Error("EDULIMS_E2E_DATABASE_URL is not set; playwright.config.ts sets it.");
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 1 }) }),
  });
}

test.beforeAll(async () => {
  teacher = await copyAccount("teacher@example.test", "logo-teacher");
  student = await copyAccount("student@example.test", "logo-student");
  stranger = await copyAccount("student@example.test", "logo-stranger");
  const db = database();
  try {
    const { id: simulationId } = await db
      .insertInto("simulations")
      .values({ name: `Logo ${randomBytes(4).toString("hex")}`, created_by: teacher.id })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("simulation_teachers")
      .values({ simulation_id: simulationId, user_id: teacher.id })
      .execute();
    const lab = await db
      .insertInto("labs")
      .values({ simulation_id: simulationId, name: "Logo Lab" })
      .returning("id")
      .executeTakeFirstOrThrow();
    labId = lab.id;
    await db
      .insertInto("lab_members")
      .values({
        simulation_id: simulationId,
        lab_id: labId,
        user_id: student.id,
        joined_via: "code",
      })
      .execute();
    await db
      .insertInto("lab_logos")
      .values({
        lab_id: labId,
        content: Buffer.from(LOGO),
        media_type: "image/png",
        byte_size: LOGO.length,
        width: 12,
        height: 8,
        sha256: createHash("sha256").update(LOGO).digest(),
        updated_by: teacher.id,
      })
      .execute();
  } finally {
    await db.destroy();
  }
});

const path = () => `/api/labs/${labId}/logo`;

for (const who of ["student", "teacher"] as const) {
  test(`serves the logo to a ${who} of the lab with its headers (#292)`, async ({ page }) => {
    await devLogin(page, (who === "student" ? student : teacher).email);
    const response = await page.request.get(path());
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers["content-type"]).toBe("image/png");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["content-disposition"]).toBe('inline; filename="lab-logo.png"');
    expect(headers["cache-control"]).toBe("private, no-cache");
    expect(headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect(headers["etag"]).toMatch(ETAG);
    expect(new Uint8Array(await response.body())).toEqual(LOGO);
    const again = await page.request.get(path(), {
      headers: { "If-None-Match": headers["etag"] ?? "" },
    });
    expect(again.status()).toBe(304);
  });
}

test("answers an empty 404 to an administrator (#280)", async ({ page }) => {
  await devLogin(page, "admin@example.test");
  const response = await page.request.get(path());
  expect(response.status()).toBe(404);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.body()).toHaveLength(0);
});

test("answers an empty 404 to a student of no lab", async ({ page }) => {
  await devLogin(page, stranger.email);
  const response = await page.request.get(path());
  expect(response.status()).toBe(404);
  expect(await response.body()).toHaveLength(0);
});

test("answers an empty 404 to a signed-out caller", async ({ request }) => {
  const response = await request.get(path());
  expect(response.status()).toBe(404);
  expect(await response.body()).toHaveLength(0);
});

test("refuses a form too large for a server function before reading it (V5.2.1)", async ({
  request,
}) => {
  const response = await request.post("/_serverFn/any", {
    headers: { Origin: appUrl(), "Content-Type": "multipart/form-data; boundary=x" },
    data: Buffer.alloc(FORM_BODY_MAX + 1),
  });
  expect(response.status()).toBe(413);
});
