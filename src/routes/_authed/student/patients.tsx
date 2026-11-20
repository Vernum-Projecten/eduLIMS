// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FlaskConicalIcon } from "lucide-react";
import { z } from "zod";
import { LabRecordsView } from "@/components/lab-records/lab-records-view";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { Page } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { RouteErrorState } from "@/components/shell/route-error";
import { buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import {
  labRecordsQueryOptions,
  requestableTestsQueryOptions,
} from "@/server/lab-records/query-options";
import { myLabsQueryOptions } from "@/server/simulations/query-options";

/** The lab whose records show: one of the student's labs; the server checks it again. */
const searchSchema = z.object({ lab: z.uuid().optional().catch(undefined) });

/** Returns the lab to show: the one in the URL when it is the student's, else their newest. */
function chosenLab<T extends { labId: string }>(labs: readonly T[], lab: string | undefined) {
  return labs.find((row) => row.labId === lab) ?? labs[0];
}

export const Route = createFileRoute("/_authed/student/patients")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ lab: search.lab }),
  loader: async ({ context, deps }) => {
    const labs = await context.queryClient.ensureQueryData(myLabsQueryOptions());
    const lab = chosenLab(labs, deps.lab);
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
  const search = Route.useSearch();
  const { data: labs } = useSuspenseQuery(myLabsQueryOptions());
  const lab = chosenLab(labs, search.lab);
  return (
    <Page title={section.label()} description={<p>{section.description()}</p>}>
      {lab === undefined ? (
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
          {labs.length > 1 ? (
            <nav aria-label={m.records_lab_picker()} className="flex flex-wrap gap-2">
              {labs.map((row) => (
                <Link
                  key={row.labId}
                  to="/student/patients"
                  search={{ lab: row.labId }}
                  aria-current={row.labId === lab.labId ? "page" : undefined}
                  className={cn(
                    buttonVariants({
                      variant: row.labId === lab.labId ? "secondary" : "outline",
                      size: "sm",
                    }),
                    row.labId === lab.labId && "font-semibold underline underline-offset-4",
                  )}
                >
                  {m.records_lab_choice({ lab: row.labName, simulation: row.simulationName })}
                </Link>
              ))}
            </nav>
          ) : (
            <p className="text-muted-foreground">
              {m.records_lab_choice({ lab: lab.labName, simulation: lab.simulationName })}
            </p>
          )}
          <LabRecordsView key={lab.labId} labId={lab.labId} />
        </>
      )}
    </Page>
  );
}
