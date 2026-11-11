// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute } from "@tanstack/react-router";
import { requireRole } from "@/lib/guards";

export const Route = createFileRoute("/_authed/beheer")({
  beforeLoad: requireRole("beheerder"),
});
