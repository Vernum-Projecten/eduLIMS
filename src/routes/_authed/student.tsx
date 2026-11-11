// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute } from "@tanstack/react-router";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { requireRole } from "@/lib/guards";

export const Route = createFileRoute("/_authed/student")({
  beforeLoad: requireRole("student"),
  pendingComponent: PageSkeleton,
});
