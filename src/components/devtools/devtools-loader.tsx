// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

// `import.meta.env.DEV` is the literal `false` in a production build, so the bundler drops the
// dynamic import and none of the devtools code reaches `.output/` (scripts/checks/no-devtools.sh).
const AppDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@/components/devtools/app-devtools").then((module) => ({
        default: module.AppDevtools,
      })),
    )
  : null;

/** Rendered after hydration only (inside `ClientOnly`), so reading `navigator` is safe. */
function ClientDevtools() {
  // Playwright and WebDriver set `navigator.webdriver`: the e2e and axe runs see the app alone.
  if (AppDevtools === null || navigator.webdriver) return null;
  return (
    <Suspense fallback={null}>
      <AppDevtools />
    </Suspense>
  );
}

/**
 * Renders the TanStack Devtools in `pnpm dev`, in the browser only, and never under browser
 * automation, so the e2e and axe runs see the app alone. Renders nothing in a production build.
 */
export function DevtoolsLoader() {
  if (AppDevtools === null) return null;
  return (
    <ClientOnly fallback={null}>
      <ClientDevtools />
    </ClientOnly>
  );
}
