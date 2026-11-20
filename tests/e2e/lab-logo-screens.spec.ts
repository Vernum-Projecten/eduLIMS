// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The lab logo on the screens (D10, S10, #293): a teacher uploads a logo on the lab page and sees
// the preview, a refused file shows its reason at the field, the logo is replaced and removed
// after a confirmation; the simulation page and the student's overview show it, a lab without a
// logo asks for no image, and the administrator's view carries no logo address. Axe in light,
// dark and Dutch, the keyboard path, and reflow at 320 px. One journey: each step uses the last.
import { randomBytes } from "node:crypto";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { png } from "../../src/server/logo/test-images.ts";
import { copyAccount, type TestAccount } from "./accounts";
import { axe, dutch } from "./admin-users-helpers";
import { devLogin, expectHydrated } from "./fixtures";
import { appUrl } from "./run-env";

test.describe.configure({ mode: "serial" });

const ID = randomBytes(4).toString("hex");
const LAB = `Logo Lab ${ID}`;
const BARE = `Bare Lab ${ID}`;
let teacher: TestAccount;
let student: TestAccount;
let simulationId = "";
let labId = "";

function database(): Kysely<DB> {
  const url = process.env["EDULIMS_E2E_DATABASE_URL"];
  if (!url) throw new Error("EDULIMS_E2E_DATABASE_URL is not set; playwright.config.ts sets it.");
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 1 }) }),
  });
}

test.beforeAll(async () => {
  teacher = await copyAccount("teacher@example.test", "logo-screens-teacher");
  student = await copyAccount("student@example.test", "logo-screens-student");
  const db = database();
  try {
    const simulation = await db
      .insertInto("simulations")
      .values({ name: `Logo screens ${ID}`, created_by: teacher.id })
      .returning("id")
      .executeTakeFirstOrThrow();
    simulationId = simulation.id;
    await db
      .insertInto("simulation_teachers")
      .values({ simulation_id: simulationId, user_id: teacher.id })
      .execute();
    const [lab] = await db
      .insertInto("labs")
      .values([
        { simulation_id: simulationId, name: LAB },
        { simulation_id: simulationId, name: BARE },
      ])
      .returning(["id", "name"])
      .execute()
      .then((rows) => rows.filter((row) => row.name === LAB));
    if (!lab) throw new Error("the lab was not created");
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
  } finally {
    await db.destroy();
  }
});

async function preferences(context: BrowserContext, theme: "light" | "dark", locale: "en" | "nl") {
  await context.addCookies([
    { name: "EDULIMS_THEME", value: theme, url: appUrl() },
    { name: "EDULIMS_LOCALE", value: locale, url: appUrl() },
  ]);
}

const labPath = () => `/teacher/simulations/${simulationId}/labs/${labId}`;

function logoForm(page: Page) {
  return page.getByRole("form", { name: `Upload the logo of lab ${LAB}` });
}

/** Opens the teacher's lab page, hydrated, and returns the logo file control. */
async function openLab(page: Page) {
  await page.goto(labPath());
  const input = logoForm(page).getByLabel("Logo file");
  await expectHydrated(input);
  return input;
}

/** Whether `img` has loaded a real image (a broken image has no natural width). */
function loaded(page: Page, name: string) {
  return page.getByRole("img", { name, exact: true }).evaluate((img: HTMLImageElement) => {
    return img.complete && img.naturalWidth > 0;
  });
}

function file(name: string, mimeType: string, bytes: Uint8Array) {
  return { name, mimeType, buffer: Buffer.from(bytes) };
}

test("a teacher sees the types and limits, and a lab without a logo asks for no image", async ({
  page,
}) => {
  const failed: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/logo")) failed.push(`${response.status()} ${response.url()}`);
  });
  await devLogin(page, teacher.email);
  const input = await openLab(page);
  await expect(input).toHaveAttribute("accept", "image/png,image/jpeg");
  await expect(input).toHaveAccessibleDescription(
    "A PNG or JPEG image of at most 512 KiB and at most 1,024 by 1,024 pixels.",
  );
  await expect(page.getByText("This lab has no logo. Its name shows on its own.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove logo" })).toHaveCount(0);
  await page.goto(`/teacher/simulations/${simulationId}`);
  await expect(page.getByRole("link", { name: BARE })).toBeVisible();
  expect(failed).toEqual([]);
  await axe(page);
});

test("a refused file shows its reason at the field, from the browser and from the server", async ({
  page,
}) => {
  await devLogin(page, teacher.email);
  const input = await openLab(page);
  const submit = logoForm(page).getByRole("button", { name: "Upload logo" });

  await input.setInputFiles(file("logo.svg", "image/svg+xml", new TextEncoder().encode("<svg/>")));
  await submit.click();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAccessibleDescription(
    /This file is not a PNG or JPEG image\. SVG, GIF and WebP are not accepted\./,
  );

  // Declared a PNG and of an accepted size, so only the server's content check refuses it.
  await input.setInputFiles(file("wide.png", "image/png", png(1025, 1)));
  const answer = page.waitForResponse((r) => r.url().includes("_serverFn"));
  await submit.click();
  await answer;
  await expect(input).toHaveAccessibleDescription(
    /This image is larger than 1,024 by 1,024 pixels\. Make it smaller and try again\./,
  );
  await expect(input).toBeFocused();
  await axe(page);
});

test("a teacher uploads with the keyboard, sees the preview, then replaces the logo", async ({
  page,
}) => {
  await devLogin(page, teacher.email);
  const input = await openLab(page);
  await input.focus();
  await input.setInputFiles(file("logo.png", "image/png", png(12, 8)));
  const preview = `Preview of the new logo of lab ${LAB}`;
  await expect(page.getByRole("img", { name: preview, exact: true })).toBeVisible();
  await expect.poll(() => loaded(page, preview)).toBe(true);

  await page.keyboard.press("Tab");
  const upload = logoForm(page).getByRole("button", { name: "Upload logo" });
  await expect(upload).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText(`The logo of lab ${LAB} is saved.`)).toBeVisible();
  const current = `Logo of lab ${LAB}`;
  await expect.poll(() => loaded(page, current)).toBe(true);
  await expect(page.getByRole("img", { name: preview, exact: true })).toHaveCount(0);
  const first = await page.getByRole("img", { name: current, exact: true }).getAttribute("src");
  expect(first).toMatch(new RegExp(`^/api/labs/${labId}/logo\\?v=[0-9a-f]{16}$`));

  await input.setInputFiles(file("next.png", "image/png", png(16, 16)));
  await logoForm(page).getByRole("button", { name: "Replace logo" }).click();
  await expect(page.getByText(`The logo of lab ${LAB} is saved.`).last()).toBeVisible();
  await expect(page.getByRole("img", { name: current, exact: true })).not.toHaveAttribute(
    "src",
    first ?? "",
  );
  await expect(page.getByRole("img", { name: preview, exact: true })).toHaveCount(0);
  await expect.poll(() => loaded(page, current)).toBe(true);
  await axe(page);
});

test("the simulation page shows the logo beside the lab's name", async ({ page }) => {
  await devLogin(page, teacher.email);
  await page.goto(`/teacher/simulations/${simulationId}`);
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: LAB }) });
  // Decorative beside the name: an empty alternative, so the name is read once.
  const img = row.locator("img");
  await expect(img).toHaveAttribute("alt", "");
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(16);
  await axe(page);
});

for (const [theme, locale] of [
  ["dark", "en"],
  ["light", "nl"],
  ["dark", "nl"],
] as const) {
  test(`the lab page and the student's overview are axe-clean in ${theme} and ${locale}`, async ({
    page,
    context,
  }) => {
    const text = (key: string, english: string) => (locale === "nl" ? dutch(key) : english);
    // The dev login form is English; the preferences apply from the next page on.
    await devLogin(page, teacher.email);
    await preferences(context, theme, locale);
    await page.goto(labPath());
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
    await expect(
      page.getByRole("heading", { name: text("labs_logo_heading", "Logo"), exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel(text("labs_logo_field", "Logo file"))).toBeVisible();
    await axe(page);

    await context.clearCookies();
    await devLogin(page, student.email);
    await preferences(context, theme, locale);
    await page.goto("/student");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("listitem").filter({ hasText: LAB }).locator("img")).toBeVisible();
    await axe(page);
  });
}

test("the student sees the logo of their lab on the overview", async ({ page }) => {
  await devLogin(page, student.email);
  await expect(page).toHaveURL(/\/student$/);
  const img = page.getByRole("listitem").filter({ hasText: LAB }).locator("img");
  await expect(img).toHaveAttribute("alt", "");
  await expect(img).toHaveAttribute("src", new RegExp(`^/api/labs/${labId}/logo\\?v=`));
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(16);
});

test("the administrator's view of the simulation carries no logo address (B5)", async ({
  page,
}) => {
  await devLogin(page, "admin@example.test");
  const response = await page.goto(`/admin/simulations/${simulationId}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByText(LAB, { exact: true }).first()).toBeVisible();
  expect(await page.content()).not.toContain("/logo");
  await expect(page.locator(`img[src*="/api/labs/"]`)).toHaveCount(0);
});

test("the lab page reflows at 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await devLogin(page, teacher.email);
  await openLab(page);
  await expect(page.getByRole("img", { name: `Logo of lab ${LAB}` })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a teacher removes the logo after a confirmation, with the keyboard", async ({ page }) => {
  await devLogin(page, teacher.email);
  await openLab(page);
  const remove = page.getByRole("button", { name: "Remove logo" });
  await remove.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog", { name: `Remove the logo of lab ${LAB}?` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await axe(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Remove logo" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText(`The logo of lab ${LAB} is removed.`)).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Logo", exact: true })).toBeFocused();
  await expect(page.getByRole("img", { name: `Logo of lab ${LAB}` })).toHaveCount(0);
  await expect(page.getByText("This lab has no logo. Its name shows on its own.")).toBeVisible();
  await expect(logoForm(page).getByRole("button", { name: "Upload logo" })).toBeVisible();
});
