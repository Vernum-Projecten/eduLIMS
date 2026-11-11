// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { m } from "@/i18n/messages";

/** The id of the `main` landmark every layout renders; the skip link targets it. */
export const MAIN_CONTENT_ID = "main-content";

/** The first focusable element of every page: a link past the navigation (WCAG 2.4.1). */
export function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:ring-3 focus:ring-ring"
    >
      {m.skip_to_content()}
    </a>
  );
}
