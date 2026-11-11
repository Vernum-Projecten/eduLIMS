// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicLayout } from "@/components/shell/public-layout";
import { VirtualTableDemo } from "@/components/virtual/virtual-table-demo";
import { m } from "@/i18n/messages";
import { getDevPagesEnabled } from "@/lib/dev-tools.functions";

/** A development-only demo of the virtual data table (#76): a 404 in production (ASVS V13.4). */
export const Route = createFileRoute("/dev/virtual-table")({
  beforeLoad: async () => {
    if (!(await getDevPagesEnabled())) throw notFound();
  },
  head: () => ({ meta: [{ title: `${m.dev_virtual_table_title()} | eduLIMS` }] }),
  component: VirtualTableDemoPage,
});

function VirtualTableDemoPage() {
  const { user } = Route.useRouteContext();
  return (
    <PublicLayout signedIn={user !== null}>
      <VirtualTableDemo />
    </PublicLayout>
  );
}
