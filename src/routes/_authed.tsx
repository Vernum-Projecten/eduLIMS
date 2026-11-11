// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/guards";

/** Pathless layout: every child route requires a signed-in user. */
export const Route = createFileRoute("/_authed")({
  beforeLoad: requireUser,
});
