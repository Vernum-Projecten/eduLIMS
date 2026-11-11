// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The analyser register and the integration status of the Admin portal (B3, #35): create, edit
// and retire, a refusal at its field, the keyboard-only path, the status screen with Check now,
// the error state with its retry, and axe in light, dark and Dutch.
import { randomBytes } from "node:crypto";
import { type BrowserContext, expect, type Page, type Route, test } from "@playwright/test";
import { axe, dutch, signInAsAdmin } from "./admin-users-helpers";
import { devLogin, expectHydrated } from "./fixtures";
import { appUrl } from "./run-env";

/** A serial number no other journey uses, so parallel journeys never meet. */
function serial(): string {
  return `E2E-${randomBytes(4).toString("hex").toUpperCase()}`;
}

async function openRegister(page: Page, q?: string): Promise<void> {
  await page.goto(q ? `/admin/integrations?q=${encodeURIComponent(q)}` : "/admin/integrations");
  await expectHydrated(page.getByRole("button", { name: "Add analyser" }));
}

function register(page: Page) {
  return page.getByRole("table");
}

function rowOf(page: Page, serialNumber: string) {
  return register(page).getByRole("row").filter({ hasText: serialNumber });
}

async function fillForm(
  page: Page,
  values: { model: string; serialNumber: string; location: string },
): Promise<void> {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Model").fill(values.model);
  await dialog.getByLabel("Serial number").fill(values.serialNumber);
  await dialog.getByLabel("Location").fill(values.location);
}

async function chooseRoute(page: Page, route: string): Promise<void> {
  await page.getByRole("dialog").getByRole("combobox", { name: "Route to FerroEHR" }).click();
  await page.getByRole("option", { name: route }).click();
}

test("an administrator adds, edits and retires an analyser (B3)", async ({ page }) => {
  const sn = serial();
  await signInAsAdmin(page);
  await openRegister(page);
  await expect(page.getByRole("heading", { level: 2, name: "Analyser register" })).toBeVisible();
  await expect(rowOf(page, "AF2-DEMO-0001")).toBeVisible();

  await page.getByRole("button", { name: "Add analyser" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an analyser" });
  await expect(dialog).toBeVisible();
  // An empty submit names every missing field and moves focus to the first one.
  await dialog.getByRole("button", { name: "Add analyser" }).click();
  await expect(dialog.getByText("Enter the model of the analyser.")).toBeVisible();
  await expect(dialog.getByText("Choose how the results reach FerroEHR.")).toBeVisible();
  await expect(dialog.getByLabel("Model")).toBeFocused();
  await axe(page);

  await fillForm(page, { model: "BioTek Epoch 2", serialNumber: sn, location: "Lab E2E" });
  await chooseRoute(page, "Excel upload");
  await dialog.getByRole("button", { name: "Add analyser" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("BioTek Epoch 2 added to the register.")).toBeVisible();

  await openRegister(page, sn);
  const row = rowOf(page, sn);
  await expect(row).toContainText("Lab E2E");
  await expect(row).toContainText("Excel upload");
  await expect(row).toContainText("In use");

  await row.getByRole("button", { name: `Actions for BioTek Epoch 2 ${sn}` }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: `Edit BioTek Epoch 2 (${sn})` });
  await expect(edit.getByLabel("Serial number")).toHaveValue(sn);
  await edit.getByLabel("Location").fill("Lab E2E, bench 9");
  await edit.getByRole("radio", { name: "In maintenance" }).check();
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toHaveCount(0);
  await expect(row).toContainText("Lab E2E, bench 9");
  await expect(row).toContainText("In maintenance");
  // Focus returns to the row's menu button (WCAG 2.4.3).
  await expect(row.getByRole("button", { name: `Actions for BioTek Epoch 2 ${sn}` })).toBeFocused();

  await row.getByRole("button", { name: `Actions for BioTek Epoch 2 ${sn}` }).click();
  await page.getByRole("menuitem", { name: "Retire" }).click();
  const confirm = page.getByRole("alertdialog", { name: `Retire BioTek Epoch 2 ${sn}?` });
  await expect(confirm).toContainText("This cannot be undone.");
  await axe(page);
  await confirm.getByRole("button", { name: "Retire analyser" }).click();
  await expect(row).toContainText("Retired");
  await expect(row.getByRole("button", { name: /^Actions for/ })).toHaveCount(0);
});

test("a serial number the model already has is refused at its field (B3)", async ({ page }) => {
  await signInAsAdmin(page);
  await openRegister(page);
  await page.getByRole("button", { name: "Add analyser" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an analyser" });
  await fillForm(page, {
    model: "Abbott Afinion 2",
    serialNumber: "AF2-DEMO-0001",
    location: "Lab A",
  });
  await chooseRoute(page, "HL7 through FerroBRIDGE");
  await dialog.getByRole("button", { name: "Add analyser" }).click();
  const serialField = dialog.getByLabel("Serial number");
  await expect(serialField).toHaveAttribute("aria-invalid", "true");
  await expect(
    dialog.getByText(
      "An analyser of this model with this serial number is already in the register.",
    ),
  ).toBeVisible();
  await expect(dialog).toBeVisible();
});

test("the register works with the keyboard alone (B3, WCAG 2.1.1)", async ({ page }) => {
  const sn = serial();
  await signInAsAdmin(page);
  await openRegister(page);
  const add = page.getByRole("button", { name: "Add analyser" });
  await add.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Add an analyser" });
  await expect(dialog.getByLabel("Model")).toBeFocused();
  // Escape closes the dialog without saving, and focus returns to "Add analyser".
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(dialog.getByLabel("Model")).toBeFocused();
  await page.keyboard.type("BioTek Epoch 2");
  await page.keyboard.press("Tab");
  await page.keyboard.type(sn);
  await page.keyboard.press("Tab");
  await page.keyboard.type("Lab keyboard");
  await page.keyboard.press("Tab");
  const route = dialog.getByRole("combobox", { name: "Route to FerroEHR" });
  await expect(route).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option", { name: "HL7 through FerroBRIDGE" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Excel upload" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(route).toContainText("Excel upload");
  await expect(route).toBeFocused();
  // Tab on through the status radios and the notes to the submit button.
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("radio", { name: "In use" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("Notes (optional)")).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Add analyser" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);

  await openRegister(page, sn);
  const menu = rowOf(page, sn).getByRole("button", { name: `Actions for BioTek Epoch 2 ${sn}` });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Edit" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Retire" })).toBeFocused();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("alertdialog", { name: `Retire BioTek Epoch 2 ${sn}?` });
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(rowOf(page, sn)).toContainText("Retired");
});

test("the status screen shows each integration with an icon and text, and Check now (B3)", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await openRegister(page);
  await expect(page.getByRole("heading", { level: 2, name: "Integration status" })).toBeVisible();
  const checkNow = page.getByRole("button", { name: "Check now" });
  await expectHydrated(checkNow);
  await checkNow.click();
  await expect(page.getByText("Integrations checked.")).toBeVisible();
  // The e2e stack configures FerroEHR and FerroBRIDGE on ports nothing listens on.
  for (const name of ["FerroEHR", "FerroBRIDGE"]) {
    const card = page.locator('[data-slot="card"]', {
      has: page.getByRole("heading", { level: 3, name }),
    });
    await expect(card).toContainText("Unavailable");
    await expect(card).toContainText("No connection to the service.");
    await expect(card).toContainText("Last check");
    await expect(card).toContainText("Never");
  }
  await expect(page.getByRole("status").filter({ hasText: "FerroEHR: Unavailable." })).toHaveCount(
    1,
  );
  await axe(page);
});

/** Makes every server function read whose payload names the register fail with a 500. */
async function failRegisterReads(page: Page): Promise<() => Promise<void>> {
  const pattern = "**/_serverFn/**";
  const handler = (route: Route) =>
    route.request().method() === "GET" &&
    decodeURIComponent(route.request().url()).includes("no-such-analyser")
      ? route.fulfill({ status: 500, body: "forced failure" })
      : route.fallback();
  await page.route(pattern, handler);
  return () => page.unroute(pattern, handler);
}

test("a failing register read shows the error state and its retry recovers (B3)", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await openRegister(page);
  const restore = await failRegisterReads(page);
  const search = page.getByRole("searchbox", { name: "Search model, serial number or location" });
  await expectHydrated(search);
  await search.fill("no-such-analyser");
  await search.press("Enter");
  const heading = page.getByRole("heading", { level: 1, name: "Something went wrong" });
  await expect(heading).toBeVisible();
  await restore();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(heading).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No analysers match" })).toBeVisible();
});

async function usePreferences(
  context: BrowserContext,
  theme: "light" | "dark",
  locale: "en" | "nl",
): Promise<void> {
  await context.addCookies([
    { name: "EDULIMS_THEME", value: theme, url: appUrl() },
    { name: "EDULIMS_LOCALE", value: locale, url: appUrl() },
  ]);
}

for (const [theme, locale] of [
  ["light", "en"],
  ["dark", "en"],
  ["light", "nl"],
  ["dark", "nl"],
] as const) {
  test(`the screen and the form are axe-clean in ${theme}, ${locale} (B3, Q-ACC-1)`, async ({
    page,
    context,
  }) => {
    await devLogin(page, "admin@example.test");
    await expect(page).toHaveURL(/\/admin$/);
    await usePreferences(context, theme, locale);
    const t = (key: string, english: string) => (locale === "nl" ? dutch(key) : english);
    await page.goto("/admin/integrations");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: t("admin_analysers_heading", "Analyser register"),
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: t("admin_integrations_heading", "Integration status"),
      }),
    ).toBeVisible();
    await axe(page);
    const add = page.getByRole("button", { name: t("admin_analysers_add", "Add analyser") });
    await expectHydrated(add);
    await add.click();
    const dialog = page.getByRole("dialog", {
      name: t("admin_analysers_create_title", "Add an analyser"),
    });
    await dialog.getByRole("button", { name: t("admin_analysers_create", "Add analyser") }).click();
    await expect(
      dialog.getByText(t("admin_analysers_model_required", "Enter the model of the analyser.")),
    ).toBeVisible();
    await axe(page);
  });
}

test("a student and a teacher cannot open the register (B3, A01)", async ({ browser }) => {
  for (const email of ["student@example.test", "teacher@example.test"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await devLogin(page, email);
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto("/admin/integrations");
    await expect(page.getByRole("heading", { name: "Analyser register" })).toHaveCount(0);
    await context.close();
  }
});
