// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FlaskConicalIcon } from "lucide-react";
import { LabRecordsView } from "@/components/lab-records/lab-records-view";
import { portalPageTitle } from "@/components/portal/portal-pages";
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
import {
  labRecordsQueryOptions,
  requestableTestsQueryOptions,
} from "@/server/lab-records/query-options";
import { myLabQueryOptions } from "@/server/simulations/query-options";

export const Route = createFileRoute("/_authed/student/patients")({
  loader: async ({ context }) => {
    const lab = await context.queryClient.ensureQueryData(myLabQueryOptions());
    if (!lab) return;
    await Promise.all([
      context.queryClient.ensureQueryData(labRecordsQueryOptions(lab.labId)),
      context.queryClient.ensureQueryData(requestableTestsQueryOptions()),
    ]);
  },
  head: () => ({
    meta: [
      { title: portalPageTitle(portalNavigation("student"), sectionOf("student", "patients")) },
    ],
  }),
  pendingComponent: PageSkeleton,
  errorComponent: RouteErrorState,
  component: PatientsPage,
});

function PatientsPage() {
  const section = sectionOf("student", "patients");
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
          <LabRecordsView key={lab.labId} labId={lab.labId} />
        </>
      )}
    </Page>
  );
}
