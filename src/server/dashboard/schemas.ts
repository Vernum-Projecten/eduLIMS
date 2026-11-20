// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The search parameters of the teacher dashboard (#271): only the order of the board, so a
// teacher can share a view sorted by lab name. Anything else falls back to the leaderboard.
import { z } from "zod";
import { BOARD_SORTS } from "../../lib/dashboard.ts";

/** The dashboard's search: `sort` is `name` or absent (the leaderboard order). */
export const dashboardSearch = z.object({
  sort: z.enum(BOARD_SORTS).optional().catch(undefined),
});
