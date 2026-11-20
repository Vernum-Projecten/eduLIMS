// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PatientsView } from "@/components/lab-records/patients-list";
import { NoLabPage, RecordsPending } from "@/components/lab-records/student-records";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { RouteErrorState } from "@/components/shell/route-error";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { labRecordsQueryOptions } from "@/server/lab-records/query-options";
import { recordsPageSearch } from "@/server/lab-records/schemas";
import { myLabQueryOptions } from "@/server/simulations/query-options";

export const Route = createFileRoute("/_authed/student/patients")({
  validateSearch: recordsPageSearch,
  loader: async ({ context }) => {
    const lab = await context.queryClient.ensureQueryData(myLabQueryOptions());
    if (!lab) return;
    await context.queryClient.ensureQueryData(labRecordsQueryOptions(lab.labId));
  },
  head: () => ({
    meta: [
      { title: portalPageTitle(portalNavigation("student"), sectionOf("student", "patients")) },
    ],
  }),
  pendingComponent: () => <RecordsPending section={sectionOf("student", "patients")} />,
  errorComponent: RouteErrorState,
  component: PatientsPage,
});

function PatientsPage() {
  const { patient } = Route.useSearch();
  // NOTE: #379 (owner, 2026-11-20); one simulation at a time, so the server picks the one lab.
  const { data: lab } = useSuspenseQuery(myLabQueryOptions());
  if (lab === null) return <NoLabPage section={sectionOf("student", "patients")} />;
  return <PatientsView key={lab.labId} lab={lab} patientId={patient} />;
}
