// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SearchXIcon } from "lucide-react";
import {
  AdminArchiveButton,
  AdminUnarchiveButton,
  TransferOwnershipDialog,
} from "@/components/admin-classes/admin-class-dialogs";
import { AdminClassImport } from "@/components/admin-classes/admin-class-import";
import {
  AdminClassInvitations,
  AdminClassMembers,
} from "@/components/admin-classes/admin-class-people";
import { ClassName, classLabel } from "@/components/classes/class-name";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { RouteErrorState, StatusPage } from "@/components/shell/route-error";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import { formatNumber } from "@/lib/i18n/format";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import {
  type AdminClassPageData,
  adminClassQueryOptions,
} from "@/server/classes/admin-query-options";

export const Route = createFileRoute("/_authed/admin/classes/$classId")({
  loader: async ({ context, params }) => {
    const page = await context.queryClient.ensureQueryData(adminClassQueryOptions(params.classId));
    // The top-bar breadcrumb reads `crumb` (AppBreadcrumb).
    return { crumb: classLabel(page) };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.crumb ?? m.classes_page()} | ${sectionOf("admin", "classes").label()} | ${portalNavigation("admin").label()} | eduLIMS`,
      },
    ],
  }),
  pendingComponent: PageSkeleton,
  errorComponent: RouteErrorState,
  notFoundComponent: ClassNotFound,
  component: AdminClassView,
});

function ClassNotFound() {
  return (
    <StatusPage
      icon={<SearchXIcon aria-hidden="true" />}
      title={m.classes_not_found()}
      body={m.classes_admin_not_found_body()}
    >
      <Button asChild>
        <Link to="/admin/classes">{m.classes_back()}</Link>
      </Button>
    </StatusPage>
  );
}

/** The class at a glance: its owner and counts, no grades or results (R-01). */
function ClassFacts({ page }: Readonly<{ page: AdminClassPageData }>) {
  const facts = [
    { term: m.classes_col_owner(), value: page.owner?.name ?? m.classes_no_owner() },
    { term: m.classes_col_teachers(), value: formatNumber(page.counts.teachers) },
    { term: m.classes_col_students(), value: formatNumber(page.counts.students) },
    { term: m.classes_col_pending(), value: formatNumber(page.counts.pendingInvitations) },
    { term: m.classes_admin_groups(), value: formatNumber(page.counts.groups) },
  ];
  return (
    <dl className="grid grid-cols-1 gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-5">
      {facts.map((fact) => (
        <div key={fact.term} className="flex min-w-0 flex-col gap-1">
          <dt className="text-sm text-muted-foreground">{fact.term}</dt>
          <dd className="font-medium break-words">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AdminClassView() {
  const { classId } = Route.useParams();
  const { data: page } = useSuspenseQuery(adminClassQueryOptions(classId));
  const archived = page.archivedAt !== null;
  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 id="page-title" className="text-2xl font-semibold tracking-tight">
            <ClassName name={page.name} academicYear={page.academicYear} archived={archived} />
          </h1>
          <p className="text-muted-foreground">
            {archived ? m.classes_archived_read_only() : m.classes_admin_page_description()}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {archived ? (
            <AdminUnarchiveButton page={page} />
          ) : (
            <>
              <TransferOwnershipDialog page={page} />
              <AdminArchiveButton page={page} />
            </>
          )}
        </div>
      </div>
      <ClassFacts page={page} />
      <section aria-labelledby="members-heading" className="flex flex-col gap-4">
        <h2 id="members-heading" className="text-lg font-semibold">
          {m.classes_admin_members_title({ count: formatNumber(page.members.length) })}
        </h2>
        <AdminClassMembers members={page.members} />
      </section>
      <section aria-labelledby="pending-heading" className="flex flex-col gap-4">
        <h2 id="pending-heading" className="text-lg font-semibold">
          {m.classes_invitations_title()}
        </h2>
        <AdminClassInvitations invitations={page.invitations} />
      </section>
      {!archived && (
        <section aria-labelledby="import-heading" className="flex flex-col gap-4">
          <h2 id="import-heading" className="text-lg font-semibold">
            {m.classes_admin_import_title()}
          </h2>
          <p className="text-muted-foreground">{m.classes_admin_import_description()}</p>
          <AdminClassImport classId={page.id} />
        </section>
      )}
    </section>
  );
}
