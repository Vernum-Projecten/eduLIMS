// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import "@tanstack/react-start/server-only";
import { getEnv } from "./env.ts";

/**
 * Tells whether eduLIMS is served over https (`BETTER_AUTH_URL`, which production requires), so
 * its cookies carry `Secure` and the `__Host-` prefix. The browser decides the same from
 * `location.protocol`, since it reaches eduLIMS on that URL.
 */
export function isSecureOrigin(baseURL: string = getEnv().BETTER_AUTH_URL): boolean {
  return new URL(baseURL).protocol === "https:";
}
