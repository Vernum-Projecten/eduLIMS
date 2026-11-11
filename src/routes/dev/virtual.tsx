// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicLayout } from "@/components/shell/public-layout";
import { VirtualListDemo } from "@/components/virtual/virtual-list-demo";
import { m } from "@/i18n/messages";
import { getDevPagesEnabled } from "@/lib/dev-tools.functions";

/** A development-only demo of the virtualised list (#64): a 404 in production (ASVS V13.4). */
export const Route = createFileRoute("/dev/virtual")({
  beforeLoad: async () => {
    if (!(await getDevPagesEnabled())) throw notFound();
  },
  head: () => ({ meta: [{ title: `${m.dev_virtual_title()} | eduLIMS` }] }),
  component: VirtualDemoPage,
});

function VirtualDemoPage() {
  const { user } = Route.useRouteContext();
  return (
    <PublicLayout signedIn={user !== null}>
      <VirtualListDemo />
    </PublicLayout>
  );
}
