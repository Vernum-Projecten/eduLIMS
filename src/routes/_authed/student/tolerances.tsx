// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon, FlaskConicalIcon, SearchXIcon } from "lucide-react";
import { z } from "zod";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { Page } from "@/components/shell/page-header";
import { RouteErrorState, StatusPage } from "@/components/shell/route-error";
import { LabPicker, StudentTolerances } from "@/components/tolerances/student-tolerances";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import type { StudentLabRow } from "@/server/simulations/queries";
import { myLabsQueryOptions } from "@/server/simulations/query-options";
import { myTolerancesQueryOptions } from "@/server/tolerances/query-options";

const searchSchema = z.object({ lab: z.uuid().optional().catch(undefined) });

/** Returns the lab the page shows: the one in the URL, or else the student's first lab. */
function chosenLab(labs: readonly StudentLabRow[], lab: string | undefined): string | undefined {
  return lab ?? labs[0]?.labId;
}

function title(): string {
  return portalPageTitle(portalNavigation("student"), sectionOf("student", "tolerances"));
}

export const Route = createFileRoute("/_authed/student/tolerances")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ lab: search.lab }),
  loader: async ({ context, deps }) => {
    const labs = await context.queryClient.ensureQueryData(myLabsQueryOptions());
    const lab = chosenLab(labs, deps.lab);
    if (lab !== undefined) {
      await context.queryClient.ensureQueryData(myTolerancesQueryOptions(lab));
    }
  },
  head: () => ({ meta: [{ title: title() }] }),
  pendingComponent: TolerancesPending,
  errorComponent: RouteErrorState,
  notFoundComponent: LabNotFound,
  component: TolerancesPage,
});

/** A lab in the URL that is not the student's: the server answers an unknown lab the same (S10). */
function LabNotFound() {
  return (
    <StatusPage
      icon={<SearchXIcon aria-hidden="true" />}
      title={m.tolerances_lab_not_found_title()}
      body={<span role="alert">{m.tolerances_lab_not_found_body()}</span>}
    >
      <Button asChild variant="outline" size="sm">
        <Link to="/student/tolerances">
          <ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
          {m.tolerances_back()}
        </Link>
      </Button>
    </StatusPage>
  );
}

function TolerancesPending() {
  return (
    <Page title={sectionOf("student", "tolerances").label()}>
      <DataTableSkeleton rows={4} />
    </Page>
  );
}

function TolerancesPage() {
  const search = Route.useSearch();
  const { data: labs } = useSuspenseQuery(myLabsQueryOptions());
  const lab = chosenLab(labs, search.lab);
  return (
    <Page
      title={sectionOf("student", "tolerances").label()}
      description={<p>{m.tolerances_page_description()}</p>}
    >
      {lab === undefined ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FlaskConicalIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{m.tolerances_no_lab_title()}</EmptyTitle>
            <EmptyDescription>{m.tolerances_no_lab_body()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <LabPicker labs={labs} current={lab} />
          <StudentTolerances labId={lab} />
        </>
      )}
    </Page>
  );
}
