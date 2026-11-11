// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute } from "@tanstack/react-router";
import { pingDatabase } from "@/server/db";

/** Readiness: the app can serve traffic (database reachable). */
export const Route = createFileRoute("/api/ready")({
  server: {
    handlers: {
      GET: async () => {
        const database = await pingDatabase();
        return Response.json(
          { status: database ? "ok" : "unavailable", checks: { database } },
          { status: database ? 200 : 503, headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
