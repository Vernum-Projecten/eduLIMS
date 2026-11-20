// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AddTest } from "@/components/catalogue/add-test";
import { CatalogueTable } from "@/components/catalogue/catalogue-table";
import { CatalogueMaterialsContext } from "@/components/catalogue/materials-context";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { Page } from "@/components/shell/page-header";
import { RouteErrorState } from "@/components/shell/route-error";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { catalogueTestsQueryOptions } from "@/server/catalogue/query-options";
import { testListSearchSchema } from "@/server/catalogue/schemas";
import { testListInput } from "@/server/catalogue/table-state";

export const Route = createFileRoute("/_authed/admin/catalogue")({
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
    meta: [{ title: portalPageTitle(portalNavigation("admin"), sectionOf("admin", "catalogue")) }],
  }),
  pendingComponent: CataloguePendingPage,
  errorComponent: RouteErrorState,
  component: CataloguePage,
});

const NO_MATERIALS: readonly string[] = [];

function CataloguePendingPage() {
  return (
    <Page
      title={sectionOf("admin", "catalogue").label()}
      description={<p>{m.catalogue_page_description()}</p>}
      fill
    >
      <DataTableSkeleton rows={3} />
    </Page>
  );
}

/**
 * The test catalogue of the Admin portal (D9, #393): one page frame with "Add test" as its one
 * primary action, then the table; adding and editing happen in a dialog (#384).
 */
function CataloguePage() {
  const search = Route.useSearch();
  const tests = useQuery(catalogueTestsQueryOptions(testListInput(search)));

  return (
    <CatalogueMaterialsContext value={tests.data?.materials ?? NO_MATERIALS}>
      <Page
        title={sectionOf("admin", "catalogue").label()}
        description={<p>{m.catalogue_page_description()}</p>}
        actions={<AddTest />}
        fill
      >
        {tests.data ? (
          <CatalogueTable
            page={tests.data}
            search={search}
            fetching={tests.isFetching && tests.isPlaceholderData}
          />
        ) : (
          <DataTableSkeleton rows={3} />
        )}
      </Page>
    </CatalogueMaterialsContext>
  );
}
