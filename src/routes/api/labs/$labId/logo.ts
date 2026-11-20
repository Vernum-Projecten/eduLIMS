// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/server/db";
import { getSessionUser } from "@/server/session";
import { labLogoResponse } from "@/server/simulations/logo-response";

/** A lab's logo, to the members of the lab and the teachers of its simulation only (D10, #292). */
export const Route = createFileRoute("/api/labs/$labId/logo")({
  server: {
    handlers: {
      GET: ({ request, params }) => labLogoResponse(getDb(), request, params.labId, getSessionUser),
    },
  },
});
