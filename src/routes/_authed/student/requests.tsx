// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { RequestsView } from "@/components/lab-records/requests-list";
import { NoLabPage, RecordsPending } from "@/components/lab-records/student-records";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { RouteErrorState } from "@/components/shell/route-error";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import {
  labRecordsQueryOptions,
  requestableTestsQueryOptions,
} from "@/server/lab-records/query-options";
import { recordsPageSearch } from "@/server/lab-records/schemas";
import { myLabQueryOptions } from "@/server/simulations/query-options";

export const Route = createFileRoute("/_authed/student/requests")({
  validateSearch: recordsPageSearch,
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
      { title: portalPageTitle(portalNavigation("student"), sectionOf("student", "requests")) },
    ],
  }),
  pendingComponent: () => <RecordsPending section={sectionOf("student", "requests")} />,
  errorComponent: RouteErrorState,
  component: RequestsPage,
});

function RequestsPage() {
  const { patient } = Route.useSearch();
  // NOTE: #379 (owner, 2026-11-20); one simulation at a time, so the server picks the one lab.
  const { data: lab } = useSuspenseQuery(myLabQueryOptions());
  if (lab === null) return <NoLabPage section={sectionOf("student", "requests")} />;
  return <RequestsView key={lab.labId} lab={lab} patientId={patient} />;
}
