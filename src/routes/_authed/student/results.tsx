// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FlaskConicalIcon } from "lucide-react";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { StudentResults } from "@/components/results/student-results";
import { Page } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { RouteErrorState } from "@/components/shell/route-error";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { myResultsQueryOptions } from "@/server/results/query-options";
import { myLabQueryOptions } from "@/server/simulations/query-options";

export const Route = createFileRoute("/_authed/student/results")({
  loader: async ({ context }) => {
    const lab = await context.queryClient.ensureQueryData(myLabQueryOptions());
    if (!lab) return;
    await context.queryClient.ensureQueryData(myResultsQueryOptions(lab.labId));
  },
  head: () => ({
    meta: [
      { title: portalPageTitle(portalNavigation("student"), sectionOf("student", "results")) },
    ],
  }),
  pendingComponent: PageSkeleton,
  errorComponent: RouteErrorState,
  component: ResultsPage,
});

function ResultsPage() {
  const section = sectionOf("student", "results");
  // NOTE: #379 (owner, 2026-11-20); one simulation at a time, so the server picks the one lab.
  const { data: lab } = useSuspenseQuery(myLabQueryOptions());
  return (
    <Page title={section.label()} description={<p>{section.description()}</p>}>
      {lab === null ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FlaskConicalIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{m.student_labs_empty_title()}</EmptyTitle>
            <EmptyDescription>{m.student_labs_empty_body()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <p className="text-muted-foreground">
            {m.records_lab_choice({ lab: lab.labName, simulation: lab.simulationName })}
          </p>
          <StudentResults key={lab.labId} labId={lab.labId} />
        </>
      )}
    </Page>
  );
}
