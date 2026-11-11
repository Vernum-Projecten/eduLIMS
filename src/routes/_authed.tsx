// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/shell/app-shell";
import { requireUser } from "@/lib/guards";

/** Pathless layout: every child route requires a signed-in user and renders in the app shell. */
export const Route = createFileRoute("/_authed")({
  beforeLoad: requireUser,
  component: AuthedLayout,
});

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user}>
      <Outlet />
    </AppShell>
  );
}
