// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The Nitro runtime plugin that retries the pending writes of released results to FerroEHR every
// minute inside the app container (#148, S15). `NODE_ENV=test` runs none.
import { definePlugin } from "nitro";
import { getDb } from "../db/index.ts";
import { getEnv } from "../env.ts";
import { getOpenEhrClient, labResultWriteSettings } from "../openehr/index.ts";
import { runPendingResultWrites } from "../results/ehr-write.ts";
import {
  resultWriteScheduleEnabled,
  startResultWriteSchedule,
} from "../results/ehr-write-schedule.ts";

// Nitro loads a runtime plugin from its default export.
export default definePlugin((nitroApp) => {
  if (!resultWriteScheduleEnabled(process.env)) return;
  const stop = startResultWriteSchedule(() =>
    runPendingResultWrites({
      db: getDb(),
      client: getOpenEhrClient(),
      settings: labResultWriteSettings(getEnv()),
    }),
  );
  nitroApp.hooks.hook("close", stop);
});
