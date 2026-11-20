// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon, FlaskConicalIcon, SearchXIcon } from "lucide-react";
import { DataTableSkeleton } from "@/components/data-table/data-table";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { Page } from "@/components/shell/page-header";
import { RouteErrorState, StatusPage } from "@/components/shell/route-error";
import { StudentTolerances } from "@/components/tolerances/student-tolerances";
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
import { myLabQueryOptions } from "@/server/simulations/query-options";
import { myTolerancesQueryOptions } from "@/server/tolerances/query-options";

function title(): string {
  return portalPageTitle(portalNavigation("student"), sectionOf("student", "tolerances"));
}

export const Route = createFileRoute("/_authed/student/tolerances")({
  loader: async ({ context }) => {
    const lab = await context.queryClient.ensureQueryData(myLabQueryOptions());
    if (lab !== null) {
      await context.queryClient.ensureQueryData(myTolerancesQueryOptions(lab.labId));
    }
  },
  head: () => ({ meta: [{ title: title() }] }),
  pendingComponent: TolerancesPending,
  errorComponent: RouteErrorState,
  notFoundComponent: LabNotFound,
  component: TolerancesPage,
});

/** A lab the student left between two reads: the server answers an unknown lab the same (S10). */
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
  // NOTE: #379 (owner, 2026-11-20); one simulation at a time, so the server picks the one lab.
  const { data: lab } = useSuspenseQuery(myLabQueryOptions());
  return (
    <Page
      title={sectionOf("student", "tolerances").label()}
      description={<p>{m.tolerances_page_description()}</p>}
    >
      {lab === null ? (
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
        <StudentTolerances labId={lab.labId} />
      )}
    </Page>
  );
}
