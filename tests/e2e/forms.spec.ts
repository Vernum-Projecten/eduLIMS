// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The form foundation (#61) on the development page /dev/forms with fictional data, and the two
// admin forms built on it: the block dialog and the roles editor. Every state is checked with
// axe in light, dark and Dutch.
import { type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { axe, dutch, openUser, signInAsAdmin } from "./admin-users-helpers";
import { expectHydrated } from "./fixtures";
import { appUrl } from "./run-env";

const SHOTS = process.env["FORM_SCREENSHOTS"];
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
type Locale = "en" | "nl";

async function usePreferences(context: BrowserContext, theme: Theme, locale: Locale) {
  await context.addCookies([
    { name: "EDULIMS_THEME", value: theme, url: appUrl() },
    { name: "EDULIMS_LOCALE", value: locale, url: appUrl() },
  ]);
}

/** Returns the English text, or the Dutch message `key` in the nl locale. */
function say(locale: Locale, key: string, english: string): string {
  return locale === "nl" ? dutch(key) : english;
}

function rubric(page: Page): Locator {
  // The first form on the page, in any locale.
  return page.getByRole("form").first();
}

function session(page: Page): Locator {
  return page.getByRole("form").last();
}

async function openForms(page: Page): Promise<void> {
  await page.goto("/dev/forms");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectHydrated(page.getByRole("form").first());
  await expectHydrated(page.getByRole("form").last());
}

/** The legend-named group of the criterion at `position` (1-based). */
function criterion(page: Page, position: number): Locator {
  return rubric(page).getByRole("group", { name: `Criterion ${position}`, exact: true });
}

test("the forms page has its title, one h1 and two named forms (#61)", async ({ page }) => {
  const response = await page.goto("/dev/forms");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Form foundation | eduLIMS");
  await expect(page.getByRole("heading", { level: 1, name: "Form foundation" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Rubric editor",
    "Every field",
  ]);
  await expect(page.getByRole("form", { name: "Rubric editor" })).toBeVisible();
  await expect(page.getByRole("form", { name: "Every field" })).toBeVisible();
});

for (const locale of ["en", "nl"] as const) {
  for (const theme of THEMES) {
    test(`the forms page is axe-clean with errors shown, in ${locale}, ${theme} (#61)`, async ({
      page,
      context,
    }) => {
      await usePreferences(context, theme, locale);
      await openForms(page);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await axe(page);

      // The empty session form: every required field shows its error.
      await session(page)
        .getByRole("button", { name: say(locale, "dev_forms_session_submit", "Check session") })
        .click();
      await expect(
        session(page).getByText(
          say(locale, "dev_forms_session_name_required", "Enter a name for the session."),
        ),
      ).toBeVisible();
      await axe(page);

      // The async check of the rubric title, with its error at the field.
      const title = rubric(page).getByLabel(say(locale, "dev_forms_title_label", "Rubric title"));
      await title.fill("Titration basics");
      await expect(title).toHaveAttribute("aria-invalid", "true");
      await axe(page);
      if (SHOTS && locale === "en") {
        await rubric(page).screenshot({ path: `${SHOTS}/async-error-${theme}.png` });
        await title.fill("Pipetting technique");
        await expect(title).toHaveAttribute("aria-invalid", "false");
        await rubric(page).screenshot({ path: `${SHOTS}/rubric-editor-${theme}.png` });
      }
    });
  }
}

test("sync validation shows each error at its field by label (#61)", async ({ page }) => {
  await openForms(page);
  const form = session(page);
  await form.getByRole("button", { name: "Check session" }).click();

  const name = form.getByLabel("Session name");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription("Enter a name for the session.");
  await expect(form.getByText("Choose an analyser.")).toBeVisible();
  await expect(form.getByText("Choose a part of the day.")).toBeVisible();
  await expect(form.getByText("Choose at least one measurement.")).toBeVisible();
  await expect(form.getByText("Choose the day of the session.")).toBeVisible();

  await name.fill("Group A");
  await expect(name).toHaveAttribute("aria-invalid", "false");
  await expect(form.getByText("Enter a name for the session.")).toHaveCount(0);
});

test("the title check runs after typing stops and shows the refusal at the field (#61)", async ({
  page,
}) => {
  await openForms(page);
  let checks = 0;
  page.on("request", (request) => {
    if (request.url().includes("_serverFn") && request.method() === "GET") checks += 1;
  });
  const title = rubric(page).getByLabel("Rubric title");
  await title.fill("");
  await title.pressSequentially("Titration basics", { delay: 20 });

  await expect(rubric(page).getByRole("status").filter({ hasText: "Checking…" })).toBeVisible();
  await expect(
    rubric(page).getByText(
      "A rubric called “Titration basics” already exists. Choose another title.",
    ),
  ).toBeVisible();
  await expect(title).toHaveAttribute("aria-invalid", "true");
  // One check for the whole word, not one per keystroke.
  expect(checks).toBe(1);

  await title.fill("Titration in practice");
  await expect(title).toHaveAttribute("aria-invalid", "false");
});

test("criteria are reordered, added and removed with the keyboard alone, and announced (#61, D1)", async ({
  page,
}) => {
  await openForms(page);
  const announcer = rubric(page)
    .getByRole("status")
    .filter({ hasText: /moved|added|removed/ });
  await expect(criterion(page, 1).getByLabel("Name of the criterion")).toHaveValue("Accuracy");

  const down = rubric(page).getByRole("button", { name: "Move Accuracy down" });
  await down.focus();
  await page.keyboard.press("Enter");
  await expect(announcer).toHaveText("Accuracy moved to position 2 of 3.");
  await expect(criterion(page, 1).getByLabel("Name of the criterion")).toHaveValue("Lab journal");
  await expect(criterion(page, 2).getByLabel("Name of the criterion")).toHaveValue("Accuracy");
  await expect(down).toBeFocused();

  await page.keyboard.press("Space");
  await expect(announcer).toHaveText("Accuracy moved to position 3 of 3.");
  await expect(criterion(page, 3).getByLabel("Name of the criterion")).toHaveValue("Accuracy");
  // At the bottom "down" is disabled, so focus moves to "up" on the same row.
  await expect(down).toBeDisabled();
  await expect(rubric(page).getByRole("button", { name: "Move Accuracy up" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(announcer).toHaveText("Accuracy moved to position 2 of 3.");

  // Add a criterion: focus lands in its name; Shift+Tab and Tab reach its controls.
  await rubric(page).getByRole("button", { name: "Add criterion" }).focus();
  await page.keyboard.press("Enter");
  await expect(announcer).toHaveText("criterion 4 added.");
  const newName = criterion(page, 4).getByLabel("Name of the criterion");
  await expect(newName).toBeFocused();
  await page.keyboard.type("Waste disposal");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(
    rubric(page).getByRole("button", { name: "Move Waste disposal down" }),
  ).toBeDisabled();
  await expect(rubric(page).getByRole("button", { name: "Remove Waste disposal" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(announcer).toHaveText("Waste disposal removed.");
  await expect(criterion(page, 4)).toHaveCount(0);

  // A nested level moves inside its criterion.
  const accuracy = criterion(page, 2);
  await accuracy.getByRole("button", { name: "Move Good up" }).focus();
  await page.keyboard.press("Enter");
  await expect(announcer).toHaveText("Good moved to position 2 of 3.");
  await expect(accuracy.getByLabel("Name of level 2")).toHaveValue("Good");
  await expect(accuracy.getByLabel("Points for level 2")).toHaveValue("4");
  await expect(accuracy.getByRole("button", { name: "Move Good up" })).toBeFocused();
  await axe(page);
});

test("a nested level's error shows at its field, and the rubric is accepted once fixed (#61, D4)", async ({
  page,
}) => {
  await openForms(page);
  const journal = criterion(page, 2);
  await journal.getByRole("button", { name: "Add a level to Lab journal" }).click();
  const label = journal.getByLabel("Name of level 3");
  await expect(label).toBeFocused();
  await rubric(page).getByRole("button", { name: "Check rubric" }).click();
  await expect(label).toHaveAttribute("aria-invalid", "true");
  await expect(journal.getByText("Enter a name for the level.")).toBeVisible();
  await expect(
    journal.getByText("Enter the points as a whole number from 0 to 100."),
  ).toBeVisible();

  await label.fill("Exemplary");
  await journal.getByLabel("Points for level 3").fill("3");
  await rubric(page).getByRole("button", { name: "Check rubric" }).click();
  await expect(
    rubric(page).getByText("The server accepted the rubric. Nothing was saved."),
  ).toBeVisible();
});

test("every field kind takes keyboard input and a refusal of the whole form takes focus (#61)", async ({
  page,
}) => {
  await openForms(page);
  const form = session(page);
  await form.getByLabel("Session name").fill("Group A");
  await form.getByLabel("Group size").fill("12");

  await form.getByLabel("Analyser").focus();
  await page.keyboard.press("Enter");
  await page.getByRole("option", { name: "BioTek Epoch 2" }).press("Enter");
  await expect(form.getByLabel("Analyser")).toHaveText("BioTek Epoch 2");
  // The trigger shows the choice while the modal listbox is still closing; go on once it is gone.
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(form.getByLabel("Analyser")).toBeFocused();

  await form.getByRole("radio", { name: "Afternoon" }).focus();
  await page.keyboard.press("Space");
  await expect(form.getByRole("radio", { name: "Afternoon" })).toBeChecked();

  await form.getByRole("checkbox", { name: "Absorbance" }).focus();
  await page.keyboard.press("Space");
  await expect(form.getByRole("checkbox", { name: "Absorbance" })).toBeChecked();

  await form.getByLabel("Day of the session").press("Enter");
  const calendar = page.getByRole("grid");
  await expect(calendar).toBeVisible();
  await page.getByRole("button", { name: "Go to the Next Month" }).click();
  await calendar.getByRole("button", { name: /15/ }).first().click();
  await expect(form.getByLabel("Day of the session")).not.toHaveText("No date");

  const observers = form.getByLabel("Observers");
  await observers.fill("Test Observer <observer@example.test>, not-an-address");
  await observers.press("Enter");
  const entries = form.getByRole("list", { name: "Addresses (2)" });
  await expect(entries.getByRole("listitem")).toHaveText([
    "observer@example.test",
    "not-an-address",
  ]);

  await form.getByRole("switch", { name: "Simulate a refusal from the server" }).press("Space");
  await form.getByRole("button", { name: "Check session" }).click();
  await expect(
    form.getByText("not-an-address is not a valid email address. Correct or remove it."),
  ).toBeVisible();
  await form.getByRole("button", { name: "Remove not-an-address" }).press("Enter");
  await expect(observers).toBeFocused();
  await expect(form.getByRole("list", { name: "Addresses (1)" })).toBeVisible();

  await form.getByRole("button", { name: "Check session" }).click();
  const refusal = form.getByRole("alert").filter({ hasText: "The form was not saved" });
  await expect(refusal).toContainText("The server refused the session, as you asked.");
  await expect(refusal).toBeFocused();
  await axe(page);

  await form.getByRole("switch", { name: "Simulate a refusal from the server" }).press("Space");
  await expect(refusal).toHaveCount(0);
  await form.getByRole("button", { name: "Check session" }).click();
  await expect(form.getByText("The server accepted the session. Nothing was saved.")).toBeVisible();
});

for (const locale of ["en", "nl"] as const) {
  for (const theme of THEMES) {
    test(`the block dialog and the roles editor show their errors axe-clean in ${locale}, ${theme} (#61)`, async ({
      page,
      context,
    }) => {
      await signInAsAdmin(page);
      await usePreferences(context, theme, locale);
      const sheet = await openUser(page, "Language Test Student");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);

      // The roles editor refuses an empty set at the field, before any confirmation.
      const roles = sheet.getByRole("group", {
        name: say(locale, "admin_users_roles_edit", "Change roles"),
      });
      await roles.getByLabel(say(locale, "role_student", "Student")).uncheck();
      await sheet
        .getByRole("button", { name: say(locale, "admin_users_roles_save", "Save roles") })
        .click();
      await expect(roles.getByRole("alert")).toBeVisible();
      await expect(roles.getByLabel(say(locale, "role_student", "Student"))).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await axe(page);

      await sheet
        .getByRole("button", { name: say(locale, "admin_users_block", "Block user") })
        .click();
      const dialog = page.getByRole("alertdialog");
      await dialog
        .getByRole("button", {
          name: say(locale, "admin_users_block_confirm", "Block"),
          exact: true,
        })
        .click();
      const reason = dialog.getByLabel(say(locale, "admin_users_block_reason", "Reason"));
      await expect(reason).toHaveAttribute("aria-invalid", "true");
      await axe(page);
      await dialog
        .getByRole("button", { name: say(locale, "admin_users_cancel", "Cancel") })
        .click();
      await expect(dialog).toBeHidden();
    });
  }
}

test.describe("at 320 CSS px wide", () => {
  test.use({ viewport: { width: 320, height: 800 } });

  test("the forms page reflows without horizontal scrolling (#61, WCAG 1.4.10)", async ({
    page,
  }) => {
    await openForms(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
