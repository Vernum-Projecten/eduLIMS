// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { devLogin, expectHydrated, expectNoA11yViolations, pressUntilFocused } from "./fixtures";
import { appUrl } from "./run-env";

const nl: Readonly<Record<string, string>> = JSON.parse(
  readFileSync(new URL("../../messages/nl.json", import.meta.url), "utf8"),
);

const PORTALS = {
  student: {
    heading: "Student portal",
    sections: ["Practicals", "Samples", "Results", "Submissions", "Grades"],
  },
  teacher: {
    heading: "Teacher portal",
    sections: ["Practicals", "Classes", "Results", "Grading", "KPI dashboard"],
  },
  admin: {
    heading: "Admin portal",
    sections: ["Users and roles", "Classes", "Analysers and integrations", "Activity log"],
  },
} as const;
type PortalRole = keyof typeof PORTALS;
const ROLES = Object.keys(PORTALS) as PortalRole[];

const SIDEBAR_TOGGLE = "Show or hide the sidebar";

/** Returns the Dutch message `key`, failing loud when the catalogue lacks it. */
function dutch(key: string): string {
  const message = nl[key];
  if (message === undefined) throw new Error(`messages/nl.json has no "${key}"`);
  return message;
}

/** The sidebar toggle in the top bar (the sidebar's rail carries the same name). */
function sidebarToggle(page: Page, name: string = SIDEBAR_TOGGLE) {
  return page.getByRole("banner").getByRole("button", { name });
}

async function signInAs(page: Page, role: PortalRole): Promise<void> {
  await devLogin(page, `${role}@example.test`);
  await expect(page).toHaveURL(new RegExp(`/${role}$`));
}

/** Sets the theme cookie before any page loads, as a returning visitor would have it. */
async function setThemeCookie(context: BrowserContext, theme: "light" | "dark"): Promise<void> {
  await context.addCookies([{ name: "EDULIMS_THEME", value: theme, url: appUrl() }]);
}

/** Collects hydration errors from the console, so a test can assert there were none. */
function watchHydration(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) errors.push(message.text());
  });
  return errors;
}

for (const role of ROLES) {
  test(`a ${role} lands on their overview and sees only their own portal's navigation`, async ({
    page,
  }) => {
    await signInAs(page, role);
    const portal = PORTALS[role];
    await expect(page.getByRole("heading", { level: 1, name: portal.heading })).toBeVisible();
    await expect(page).toHaveTitle(`${portal.heading} | eduLIMS`);

    const nav = page.getByRole("navigation", { name: "Main menu" });
    await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const section of portal.sections) {
      await expect(nav.getByRole("link", { name: section, exact: true })).toBeVisible();
      // The overview links every section from a card, except the admin overview, which fits
      // one screen and leaves the sections to the sidebar (#129).
      if (role !== "admin") {
        await expect(
          page.getByRole("main").getByRole("link", { name: section, exact: true }),
        ).toBeVisible();
      }
    }
    for (const other of ROLES.filter((candidate) => candidate !== role)) {
      await expect(nav).not.toContainText(PORTALS[other].heading);
    }
    await expect(nav.locator("[aria-current=page]")).toHaveCount(1);
    await expectNoA11yViolations(page);
  });
}

test("a signed-in visitor of the home page goes to their portal", async ({ page }) => {
  await signInAs(page, "teacher");
  await page.goto("/");
  await expect(page).toHaveURL(/\/teacher$/);
});

test("a section shows its coming-soon state, and the breadcrumb and title follow", async ({
  page,
}) => {
  await signInAs(page, "student");
  const nav = page.getByRole("navigation", { name: "Main menu" });
  await nav.getByRole("link", { name: "Samples" }).click();

  await expect(page).toHaveURL(/\/student\/samples$/);
  await expect(page).toHaveTitle("Samples | Student portal | eduLIMS");
  await expect(page.getByRole("heading", { level: 1, name: "Samples" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Coming soon" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Samples" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Overview" })).not.toHaveAttribute(
    "aria-current",
    "page",
  );

  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb.getByRole("link", { name: "Student portal" })).toBeVisible();
  await expect(breadcrumb).toContainText("Samples");
  await expectNoA11yViolations(page);

  await breadcrumb.getByRole("link", { name: "Student portal" }).click();
  await expect(page).toHaveURL(/\/student$/);
  await expect(breadcrumb).toContainText("Overview");
});

test("the sidebar collapses and expands with the keyboard and stays collapsed after a reload", async ({
  page,
}) => {
  await signInAs(page, "teacher");
  const toggle = sidebarToggle(page);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  await expectHydrated(toggle);
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  // Lets the collapse transition finish, so axe measures the final colours.
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await expectNoA11yViolations(page);

  // The server renders the collapsed state from the cookie, so there is no flash.
  const html = await (await page.request.get("/teacher")).text();
  expect(html).toContain('data-state="collapsed"');
  await page.reload();
  await expect(sidebarToggle(page)).toHaveAttribute("aria-expanded", "false");

  // The server HTML shows the collapsed state at once, but Ctrl+B only works once the reloaded
  // page has hydrated; on a slow runner the key press came first and was lost.
  await expectHydrated(sidebarToggle(page));
  await page.keyboard.press("ControlOrMeta+b");
  await expect(sidebarToggle(page)).toHaveAttribute("aria-expanded", "true");
});

test("the user menu shows the account and its role, and signs out with the keyboard", async ({
  page,
}) => {
  await signInAs(page, "admin");
  const menuButton = page.getByRole("button", { name: /admin@example\.test/ });
  await menuButton.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toContainText("Test Administrator");
  await expect(menu).toContainText("Administrator");
  await expect(menu.getByRole("menuitem", { name: "Theme" })).toBeVisible();
  await menu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await expectNoA11yViolations(page);

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(menuButton).toBeFocused();

  await menuButton.click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("a missing page inside a portal keeps the app shell", async ({ page }) => {
  await signInAs(page, "student");
  await page.goto("/student/does-not-exist");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main menu" })).toBeVisible();
  await expectNoA11yViolations(page);
});

test.describe("on a phone (390 CSS px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the sidebar opens as a sheet and closes after navigating or with Escape", async ({
    page,
  }) => {
    await signInAs(page, "student");
    await expect(page.getByRole("navigation", { name: "Main menu" })).toBeHidden();

    const toggle = sidebarToggle(page);
    await toggle.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    await expectNoA11yViolations(page);

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();

    await toggle.click();
    await page
      .getByRole("dialog")
      .getByRole("navigation", { name: "Main menu" })
      .getByRole("link", { name: "Grades" })
      .click();
    await expect(page).toHaveURL(/\/student\/grades$/);
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Grades" })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
  });
});

test.describe("at 320 CSS px wide (WCAG 1.4.10)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const path of ["/", "/login", "/teacher", "/teacher/kpi-dashboard"]) {
    test(`${path} reflows without horizontal scrolling`, async ({ page }) => {
      if (path.startsWith("/teacher")) await signInAs(page, "teacher");
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(320);
    });
  }
});

test("the theme menu switches <html class> and the choice renders on the server", async ({
  page,
}) => {
  const hydrationErrors = watchHydration(page);
  await page.goto("/login");
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/\b(dark|light)\b/);

  const themeButton = page.getByRole("button", { name: "Theme: System" });
  await expectHydrated(themeButton);
  await themeButton.click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(html).toHaveClass(/\bdark\b/);
  await expect(page.getByRole("button", { name: "Theme: Dark" })).toBeVisible();

  // No flash: the server already sends the class.
  const source = await (await page.request.get("/login")).text();
  expect(source).toMatch(/<html[^>]*class="dark"/);
  await page.reload();
  await expect(html).toHaveClass(/\bdark\b/);

  await page.getByRole("button", { name: "Theme: Dark" }).click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  await expect(html).toHaveClass(/\blight\b/);
  await expect(html).not.toHaveClass(/\bdark\b/);
  expect(hydrationErrors).toEqual([]);
});

test("the theme submenu in the user menu works with the keyboard", async ({ page }) => {
  await signInAs(page, "student");
  const userMenu = page.getByRole("button", { name: /student@example\.test/ });
  await expectHydrated(userMenu);
  await userMenu.click();
  const theme = page.getByRole("menuitem", { name: "Theme" });
  await theme.focus();
  await page.keyboard.press("ArrowRight");
  const dark = page.getByRole("menuitemradio", { name: "Dark" });
  await expect(dark).toBeVisible();
  // ArrowRight opens the submenu on its first item (WAI-ARIA APG menu pattern).
  await expect(page.getByRole("menuitemradio", { name: "Light" })).toBeFocused();
  await pressUntilFocused(page, "ArrowDown", dark);
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
});

test("the system theme follows prefers-color-scheme without a class", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/\b(dark|light)\b/);
  expect(await html.evaluate((el) => getComputedStyle(el).colorScheme)).toBe("dark");
});

test.describe("demo accounts (development login on)", () => {
  test("the login page lists them, and Use fills the form without signing in", async ({ page }) => {
    await page.goto("/login");
    const toggle = page.getByRole("button", { name: "Demo accounts" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expectHydrated(toggle);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const devTable = page.getByRole("table", { name: "Development login" });
    await expect(devTable).toContainText("student@example.test");
    await expect(devTable.getByRole("rowheader", { name: "Teacher", exact: true })).toBeVisible();
    await expect(
      devTable.getByRole("rowheader", { name: "Teacher · Administrator" }),
    ).toBeVisible();
    await expect(page.getByText("Password for every account: eduLIMS-dev-only")).toBeVisible();
    const keycloakTable = page.getByRole("table", { name: "Keycloak (realm edulims)" });
    await expect(keycloakTable.getByRole("row", { name: /Administrator admin/ })).toBeVisible();
    await expect(
      keycloakTable.getByRole("row", { name: /coordinator Group membership/ }),
    ).toBeVisible();
    await expect(
      keycloakTable.getByRole("row", { name: /Refused: conflicting roles conflict/ }),
    ).toBeVisible();
    await expect(page.getByText("The password is the username.")).toBeVisible();
    await expect(page.getByText("These are public development credentials.")).toBeVisible();
    await expectNoA11yViolations(page);

    await page.getByRole("button", { name: "Use the Teacher test account" }).click();
    await expect(page.getByLabel("Email address")).toHaveValue("teacher@example.test");
    await expect(page.getByLabel("Password")).toHaveValue("eduLIMS-dev-only");
    await expect(page.getByRole("status").filter({ hasText: "Teacher" })).toBeAttached();
    const submit = page.getByRole("button", { name: "Sign in with a test account" });
    await expect(submit).toBeFocused();
    await expect(page).toHaveURL(/\/login$/);

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/teacher$/);
  });
});

test.describe("axe in both themes", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`public pages are clean in the ${theme} theme`, async ({ page, context }) => {
      await setThemeCookie(context, theme);
      for (const path of ["/", "/login"]) {
        await page.goto(path);
        await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
        await expectNoA11yViolations(page);
      }
    });

    for (const role of ROLES) {
      test(`the ${role} overview is clean in the ${theme} theme`, async ({ page, context }) => {
        await setThemeCookie(context, theme);
        await signInAs(page, role);
        await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
        await expectNoA11yViolations(page);
      });
    }

    test(`an empty section page is clean in the ${theme} theme`, async ({ page, context }) => {
      await setThemeCookie(context, theme);
      await signInAs(page, "teacher");
      await page.goto("/teacher/kpi-dashboard");
      await expect(page.getByRole("heading", { level: 2, name: "Coming soon" })).toBeVisible();
      await expectNoA11yViolations(page);
    });
  }
});

/**
 * Measures the sidebar from its main menu: the background its panel paints, and how far down
 * the document the lowest box around the menu with that background reaches. A full-page capture
 * shows the page as laid out, so a box one viewport tall leaves the rest of the column bare.
 */
async function sidebarPaint(page: Page) {
  return page.getByRole("navigation", { name: "Main menu" }).evaluate((nav) => {
    const transparent = "rgba(0, 0, 0, 0)";
    const ancestors: Element[] = [];
    for (let node = nav.parentElement; node; node = node.parentElement) ancestors.push(node);
    const colour = ancestors
      .map((node) => getComputedStyle(node).backgroundColor)
      .find((background) => background !== transparent);
    const bottom = Math.max(
      ...ancestors
        .filter((node) => getComputedStyle(node).backgroundColor === colour)
        .map((node) => node.getBoundingClientRect().bottom + window.scrollY),
    );
    return {
      colour,
      bottom,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    };
  });
}

test.describe("the sidebar on a page taller than the viewport (#112)", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`its background reaches the bottom of the document in the ${theme} theme`, async ({
      page,
      context,
    }) => {
      await setThemeCookie(context, theme);
      await page.setViewportSize({ width: 1280, height: 400 });
      await signInAs(page, "admin");
      // The overview fits one screen (#129); the system page is still taller than the window.
      await page.goto("/admin/system");
      await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
      await expectHydrated(sidebarToggle(page));

      const paint = await sidebarPaint(page);
      expect(paint.colour).toBeDefined();
      expect(paint.documentHeight).toBeGreaterThan(2 * paint.viewportHeight);
      expect(paint.bottom).toBeGreaterThanOrEqual(paint.documentHeight);
      await expectNoA11yViolations(page);
    });
  }
});

test.describe("in Dutch", () => {
  test("the shell, an overview and a section are translated and axe-clean", async ({
    page,
    context,
  }) => {
    await signInAs(page, "admin");
    await context.addCookies([{ name: "EDULIMS_LOCALE", value: "nl", url: appUrl() }]);
    await page.goto("/admin");
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
    await expect(
      page.getByRole("heading", { level: 1, name: dutch("portal_admin") }),
    ).toBeVisible();
    await expect(page).toHaveTitle(`${dutch("portal_admin")} | eduLIMS`);
    const nav = page.getByRole("navigation", { name: dutch("main_menu") });
    await expect(nav.getByRole("link", { name: dutch("nav_users_roles") })).toBeVisible();
    await expect(sidebarToggle(page, dutch("sidebar_toggle"))).toBeVisible();
    await expectNoA11yViolations(page);

    await nav.getByRole("link", { name: dutch("nav_activity_log") }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: dutch("nav_activity_log") }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("navigation", { name: dutch("breadcrumb_label") })).toContainText(
      dutch("nav_activity_log"),
    );
    await expectNoA11yViolations(page);
  });

  for (const path of ["/", "/login"]) {
    test(`${path} is translated and axe-clean in both themes`, async ({ page, context }) => {
      await context.addCookies([{ name: "EDULIMS_LOCALE", value: "nl", url: appUrl() }]);
      for (const theme of ["light", "dark"] as const) {
        await setThemeCookie(context, theme);
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("lang", "nl");
        await expectNoA11yViolations(page);
      }
    });
  }
});
