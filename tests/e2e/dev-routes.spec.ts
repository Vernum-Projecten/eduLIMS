// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "@playwright/test";

// The production build renders no devtools (#64). That `/dev/*` is a 404 when NODE_ENV is
// production is unit-tested in src/server/dev-tools.test.ts; this e2e build runs as `test`.
test("the production build renders no devtools", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /devtools/i })).toHaveCount(0);
  const devtoolsScripts = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => /devtools/i.test(name)),
  );
  expect(devtoolsScripts).toEqual([]);
});
