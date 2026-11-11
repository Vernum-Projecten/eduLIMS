// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArchiveIcon, SearchXIcon, Trash2Icon } from "lucide-react";
import { ConfirmButton } from "@/components/admin-users/admin-action";
import { CopyClassDialog, EditClassDialog } from "@/components/classes/class-dialogs";
import { ClassGroups } from "@/components/classes/class-groups";
import { ClassInvitations } from "@/components/classes/class-invitations";
import { ClassMembers } from "@/components/classes/class-members";
import { ClassName, classLabel } from "@/components/classes/class-name";
import { useClassMutation } from "@/components/classes/use-class-mutation";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { RouteErrorState, StatusPage } from "@/components/shell/route-error";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { m } from "@/i18n/messages";
import { classCan } from "@/lib/classes";
import { formatNumber } from "@/lib/i18n/format";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { archiveClassFn, deleteClassFn } from "@/server/classes/functions";
import {
  type ClassPage,
  classMutationOptions,
  classPageQueryOptions,
  deleteClassMutationOptions,
} from "@/server/classes/query-options";
import { CLASS_TABS, classPageSearchSchema } from "@/server/classes/schemas";

export const Route = createFileRoute("/_authed/teacher/classes/$classId")({
  validateSearch: classPageSearchSchema,
  loader: async ({ context, params }) => {
    const page = await context.queryClient.ensureQueryData(classPageQueryOptions(params.classId));
    return { label: classLabel(page) };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.label ?? m.classes_page()} | ${sectionOf("teacher", "classes").label()} | ${portalNavigation("teacher").label()} | eduLIMS`,
      },
    ],
  }),
  pendingComponent: PageSkeleton,
  errorComponent: RouteErrorState,
  notFoundComponent: ClassNotFound,
  component: ClassPageView,
});

function ClassNotFound() {
  return (
    <StatusPage
      icon={<SearchXIcon aria-hidden="true" />}
      title={m.classes_not_found()}
      body={m.classes_not_found_body()}
    >
      <Button asChild>
        <Link to="/teacher/classes">{m.classes_back()}</Link>
      </Button>
    </StatusPage>
  );
}

/** Archive and delete, for the owner of an active class. */
function ClassLifecycle({ page }: Readonly<{ page: ClassPage }>) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const archive = useClassMutation(
    classMutationOptions(queryClient, useServerFn(archiveClassFn)),
    () => m.classes_archived_done({ name: page.name }),
  );
  const remove = useClassMutation(
    deleteClassMutationOptions(queryClient, useServerFn(deleteClassFn), () =>
      navigate({ to: "/teacher/classes" }),
    ),
    () => m.classes_deleted({ name: page.name }),
  );
  return (
    <>
      {classCan(page.myRole, { class: ["archive"] }) && (
        <ConfirmButton
          icon={ArchiveIcon}
          label={m.classes_archive()}
          title={m.classes_archive_title({ name: page.name })}
          description={m.classes_archive_description()}
          confirm={m.classes_archive_confirm()}
          pending={archive.isPending}
          onConfirm={() => archive.mutate({ classId: page.id })}
        />
      )}
      {classCan(page.myRole, { class: ["delete"] }) && (
        <ConfirmButton
          icon={Trash2Icon}
          label={m.classes_delete()}
          title={m.classes_delete_title({ name: page.name })}
          description={m.classes_delete_description()}
          confirm={m.classes_delete_confirm()}
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate({ classId: page.id })}
        />
      )}
    </>
  );
}

function ClassActions({ page }: Readonly<{ page: ClassPage }>) {
  const archived = page.archivedAt !== null;
  return (
    <>
      {!archived && classCan(page.myRole, { class: ["update"] }) && (
        <EditClassDialog classId={page.id} name={page.name} academicYear={page.academicYear} />
      )}
      {classCan(page.myRole, { class: ["copy"] }) && (
        <CopyClassDialog classId={page.id} academicYear={page.academicYear} />
      )}
      {!archived && <ClassLifecycle page={page} />}
    </>
  );
}

function ClassPageView() {
  const { classId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: page } = useSuspenseQuery(classPageQueryOptions(classId));
  const students = page.members.filter((member) => member.role === "student").length;
  const pending = page.invitations.length;
  const section = sectionOf("teacher", "classes");
  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-6">
      <Breadcrumb aria-label={m.classes_breadcrumb()}>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/teacher/classes">{section.label()}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{classLabel(page)}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 id="page-title" className="text-2xl font-semibold tracking-tight">
            <ClassName
              name={page.name}
              academicYear={page.academicYear}
              archived={page.archivedAt !== null}
            />
          </h1>
          <p className="text-muted-foreground">
            {page.archivedAt !== null
              ? m.classes_archived_read_only()
              : m.classes_page_description()}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ClassActions page={page} />
        </div>
      </div>
      <Tabs
        value={tab ?? "members"}
        onValueChange={(value) => {
          const next = CLASS_TABS.find((candidate) => candidate === value);
          void navigate({ search: { tab: next }, replace: true });
        }}
      >
        <TabsList>
          <TabsTrigger value="members">
            {m.classes_tab_members({ count: formatNumber(page.members.length) })}
          </TabsTrigger>
          <TabsTrigger value="invitations">
            {m.classes_tab_invitations({ count: formatNumber(pending) })}
          </TabsTrigger>
          <TabsTrigger value="groups">{m.classes_tab_groups()}</TabsTrigger>
        </TabsList>
        <TabsContent value="members" className="pt-4">
          <p className="mb-4 text-muted-foreground">
            {m.classes_members_summary({ students: formatNumber(students) })}
          </p>
          <ClassMembers page={page} />
        </TabsContent>
        <TabsContent value="invitations" className="pt-4">
          <ClassInvitations page={page} />
        </TabsContent>
        <TabsContent value="groups" className="pt-4">
          <ClassGroups page={page} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
