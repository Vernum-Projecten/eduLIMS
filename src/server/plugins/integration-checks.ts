// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The Nitro runtime plugin that checks FerroEHR and FerroBRIDGE every minute inside the app
// container (B3, #35): operators run only the image, so no host cron job is needed. The advisory
// lock in `runScheduledCheck` makes one replica check per interval.
import { definePlugin } from "nitro";
import { getDb } from "../db/index.ts";
import { getEnv } from "../env.ts";
import { runScheduledCheck, startCheckSchedule } from "../integrations/checks.ts";
import { DEFAULT_PROBE_DEPS } from "../integrations/probe.ts";

// Nitro loads a runtime plugin from its default export.
export default definePlugin((nitroApp) => {
  const stop = startCheckSchedule(() =>
    runScheduledCheck({ db: getDb(), env: getEnv(), deps: DEFAULT_PROBE_DEPS }),
  );
  nitroApp.hooks.hook("close", stop);
});
