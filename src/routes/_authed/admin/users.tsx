// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { UsersIcon } from "lucide-react";
import { pageCount, UsersPagination } from "@/components/admin-users/users-pagination";
import { UsersTable, UsersTableSkeleton } from "@/components/admin-users/users-table";
import { hasFilters, UsersToolbar } from "@/components/admin-users/users-toolbar";
import { portalPageTitle } from "@/components/portal/portal-pages";
import { Page } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import { formatNumber } from "@/lib/i18n/format";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { adminUsersQueryOptions } from "@/server/users/query-options";
import {
  type ListUsersInput,
  type UserListSearch,
  userListSearchSchema,
} from "@/server/users/schemas";

/** Returns the server function input for the URL search params: no empty search text. */
function toListInput(search: UserListSearch): ListUsersInput {
  const { q, ...rest } = search;
  const input: ListUsersInput = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) Reflect.set(input, key, value);
  }
  return q ? { ...input, q } : input;
}

export const Route = createFileRoute("/_authed/admin/users")({
  validateSearch: userListSearchSchema,
  loaderDeps: ({ search }) => toListInput(search),
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(adminUsersQueryOptions(deps)),
  head: () => ({
    meta: [{ title: portalPageTitle(portalNavigation("admin"), sectionOf("admin", "users")) }],
  }),
  pendingComponent: UsersPendingPage,
  component: UsersPage,
});

function UsersPendingPage() {
  const section = sectionOf("admin", "users");
  return (
    <Page title={section.label()} description={<p>{section.description()}</p>}>
      <UsersTableSkeleton />
    </Page>
  );
}

function caption(search: UserListSearch, page: number, pages: number): string {
  const column =
    (search.sort ?? "name") === "name"
      ? m.admin_users_col_user()
      : m.admin_users_col_last_sign_in();
  return search.dir === "desc"
    ? m.admin_users_caption_desc({ column, page: formatNumber(page), pages: formatNumber(pages) })
    : m.admin_users_caption_asc({ column, page: formatNumber(page), pages: formatNumber(pages) });
}

function UsersPage() {
  const search = Route.useSearch();
  const section = sectionOf("admin", "users");
  const { data } = useSuspenseQuery(adminUsersQueryOptions(toListInput(search)));
  const pages = pageCount(data.total, data.size);
  const filtered = hasFilters(search);

  return (
    <Page title={section.label()} description={<p>{m.admin_users_description()}</p>}>
      <UsersToolbar search={search} providerOptions={data.providerOptions} />
      <p role="status" className="sr-only">
        {m.admin_users_results({ total: formatNumber(data.total) })}
      </p>
      {data.rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h2>{filtered ? m.admin_users_empty_filtered() : m.admin_users_empty()}</h2>
            </EmptyTitle>
            <EmptyDescription>
              {filtered ? m.admin_users_empty_filtered_body() : m.admin_users_empty_body()}
            </EmptyDescription>
          </EmptyHeader>
          {(filtered || data.page > 1) && (
            <EmptyContent>
              <Button variant="outline" asChild>
                <Link to="/admin/users" search={{}}>
                  {m.admin_users_clear_filters()}
                </Link>
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          <UsersTable
            rows={data.rows}
            readAt={data.readAt}
            search={search}
            caption={caption(search, data.page, pages)}
          />
          <UsersPagination total={data.total} page={data.page} size={data.size} />
        </div>
      )}
      <Outlet />
    </Page>
  );
}
