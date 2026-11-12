// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArchiveIcon } from "lucide-react";
import { CreateClassDialog } from "@/components/classes/class-dialogs";
import { ClassesTable } from "@/components/classes/classes-table";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { Page } from "@/components/shell/page-header";
import { RouteErrorState } from "@/components/shell/route-error";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { myClassesQueryOptions } from "@/server/classes/query-options";
import { classListSearchSchema } from "@/server/classes/schemas";

export const Route = createFileRoute("/_authed/teacher/classes/")({
  validateSearch: classListSearchSchema,
  loaderDeps: ({ search }) => ({ archived: search.archived === true }),
  loader: async ({ context, deps, cause }) => {
    const list = context.queryClient.ensureQueryData(myClassesQueryOptions(deps));
    // NOTE: #58; switching the filter keeps the table on screen with "Updating…".
    if (cause === "stay") return void list.catch(() => undefined);
    await list;
  },
  head: () => ({
    meta: [
      { title: portalPageTitle(portalNavigation("teacher"), sectionOf("teacher", "classes")) },
    ],
  }),
  pendingComponent: ClassesPending,
  errorComponent: RouteErrorState,
  component: ClassesPage,
});

function ClassesPending() {
  const section = sectionOf("teacher", "classes");
  return (
    <Page title={section.label()} description={<p>{section.description()}</p>}>
      <DataTableSkeleton rows={4} />
    </Page>
  );
}

/** The Active / Archived filter: two links in a labelled navigation, the current one marked. */
function ArchiveFilter({ archived }: Readonly<{ archived: boolean }>) {
  return (
    <nav aria-label={m.classes_filter_label()} className="flex flex-wrap gap-2">
      <Button variant={archived ? "outline" : "secondary"} size="sm" asChild>
        <Link to="/teacher/classes" search={{}} aria-current={archived ? undefined : "page"}>
          {m.classes_filter_active()}
        </Link>
      </Button>
      <Button variant={archived ? "secondary" : "outline"} size="sm" asChild>
        <Link
          to="/teacher/classes"
          search={{ archived: true }}
          aria-current={archived ? "page" : undefined}
        >
          <ArchiveIcon aria-hidden="true" data-icon="inline-start" />
          {m.classes_filter_archived()}
        </Link>
      </Button>
    </nav>
  );
}

function ClassesPage() {
  const search = Route.useSearch();
  const archived = search.archived === true;
  const section = sectionOf("teacher", "classes");
  const { data, isFetching, isPlaceholderData } = useQuery(myClassesQueryOptions({ archived }));
  return (
    <Page
      title={section.label()}
      description={<p>{section.description()}</p>}
      actions={<CreateClassDialog />}
    >
      <div className="flex flex-col gap-4">
        <ArchiveFilter archived={archived} />
        {data ? (
          <ClassesTable rows={data} archived={archived} busy={isFetching && isPlaceholderData} />
        ) : (
          <DataTableSkeleton rows={4} />
        )}
      </div>
    </Page>
  );
}
