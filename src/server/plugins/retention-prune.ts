// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The Nitro runtime plugin that applies the retention periods inside the app container (B4,
// #65): a prune shortly after start-up and every 24 hours after, with no host cron job. The
// advisory lock in `runPrune` lets one replica prune at a time; `NODE_ENV=test` runs none.
import { definePlugin } from "nitro";
import { runScheduledPrune } from "../audit/prune-job.ts";
import { installPruneSchedule } from "../audit/prune-schedule.ts";
import { getDb } from "../db/index.ts";

// Nitro loads a runtime plugin from its default export.
export default definePlugin((nitroApp) => {
  installPruneSchedule(nitroApp.hooks, process.env, () => runScheduledPrune(getDb(), new Date()));
});
