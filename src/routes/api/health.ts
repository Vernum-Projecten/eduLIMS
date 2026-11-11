// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute } from "@tanstack/react-router";

/** Liveness: the process is up. Never touches dependencies. */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } }),
    },
  },
});
