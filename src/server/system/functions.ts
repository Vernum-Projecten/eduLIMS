// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The server function of Admin → System (#36); its body runs on the server. It requires the
// admin role first; the read checks it again.
import { createServerFn } from "@tanstack/react-start";
import { getLocale } from "../../i18n/runtime.js";
import { getDb } from "../db/index.ts";
import { getEnv } from "../env.ts";
import { requireRole } from "../middleware.ts";
import { readSystemConfiguration } from "./queries.ts";
import { systemConfigurationInput } from "./schemas.ts";

/** Returns the enabled identity providers with their URLs and role settings, and the build. */
export const getSystemConfiguration = createServerFn({ method: "GET" })
  .middleware([requireRole("admin")])
  .validator(systemConfigurationInput)
  .handler(({ context }) =>
    readSystemConfiguration({
      db: getDb(),
      actor: context.user,
      baseURL: getEnv().BETTER_AUTH_URL,
      locale: getLocale() === "nl" ? "nl" : "en",
      buildEnv: process.env,
    }),
  );
