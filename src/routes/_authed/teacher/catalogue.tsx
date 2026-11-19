// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useId } from "react";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { Page } from "@/components/shell/page-header";
import { RouteErrorState } from "@/components/shell/route-error";
import { CatalogueTable } from "@/components/teacher-catalogue/catalogue-table";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { catalogueTestsQueryOptions } from "@/server/catalogue/query-options";
import { testListSearchSchema } from "@/server/catalogue/schemas";
import { testListInput } from "@/server/catalogue/table-state";

export const Route = createFileRoute("/_authed/teacher/catalogue")({
  validateSearch: testListSearchSchema,
  loaderDeps: ({ search }) => testListInput(search),
  loader: async ({ context, deps, cause }) => {
    const page = context.queryClient.ensureQueryData(catalogueTestsQueryOptions(deps));
    // NOTE: #58: on a new sort, filter or page the catalogue stays and shows "Updating…"
    // (keepPreviousData) instead of blocking the navigation; entering the page waits for it.
    if (cause === "stay") return void page.catch(() => undefined);
    await page;
  },
  head: () => ({
    meta: [
      { title: portalPageTitle(portalNavigation("teacher"), sectionOf("teacher", "catalogue")) },
    ],
  }),
  pendingComponent: CataloguePendingPage,
  errorComponent: RouteErrorState,
  component: CataloguePage,
});

function CataloguePendingPage() {
  const section = sectionOf("teacher", "catalogue");
  return (
    <Page title={section.label()} description={<p>{m.catalogue_page_description()}</p>}>
      <DataTableSkeleton rows={3} />
    </Page>
  );
}

function CataloguePage() {
  const search = Route.useSearch();
  const section = sectionOf("teacher", "catalogue");
  const headingId = useId();
  const tests = useQuery(catalogueTestsQueryOptions(testListInput(search)));

  return (
    <Page title={section.label()} description={<p>{m.catalogue_page_description()}</p>}>
      <section aria-labelledby={headingId}>
        {tests.data ? (
          <CatalogueTable
            page={tests.data}
            search={search}
            fetching={tests.isFetching && tests.isPlaceholderData}
            headingId={headingId}
          />
        ) : (
          <DataTableSkeleton rows={3} />
        )}
      </section>
    </Page>
  );
}
