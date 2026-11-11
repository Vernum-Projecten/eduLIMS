// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps, useNavigate } from "@tanstack/react-router";
import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { UserDetailContent } from "@/components/admin-users/user-detail-sheet";
import { userLinkId } from "@/components/admin-users/users-columns";
import { useRouteRetry } from "@/components/shell/route-error";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { m } from "@/i18n/messages";
import { portalNavigation, sectionOf } from "@/lib/navigation";
import { adminUserQueryOptions } from "@/server/users/query-options";

export const Route = createFileRoute("/_authed/admin/users/$userId")({
  loader: async ({ context, params }) => {
    const user = await context.queryClient.ensureQueryData(adminUserQueryOptions(params.userId));
    return { name: user.name };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.name ?? m.admin_users_detail()} | ${sectionOf("admin", "users").label()} | ${portalNavigation("admin").label()} | eduLIMS`,
      },
    ],
  }),
  pendingComponent: UserPending,
  errorComponent: UserError,
  notFoundComponent: UserNotFound,
  component: UserSheetPage,
});

/** The sheet over the users list; closing it returns to the list with its search params. */
function UserSheet({ userId, children }: Readonly<{ userId: string; children: ReactNode }>) {
  const navigate = useNavigate();
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) void navigate({ to: "/admin/users", search: (prev) => prev });
      }}
    >
      <SheetContent
        showCloseButton={false}
        className="w-full gap-0 data-[side=right]:sm:max-w-xl"
        onCloseAutoFocus={(event) => {
          // WCAG 2.4.3: focus returns to the user's link in the table.
          const link = document.getElementById(userLinkId(userId));
          if (link) {
            event.preventDefault();
            link.focus();
          }
        }}
      >
        {children}
      </SheetContent>
    </Sheet>
  );
}

function UserSheetPage() {
  const { userId } = Route.useParams();
  const { data, isFetching } = useSuspenseQuery(adminUserQueryOptions(userId));
  return (
    <UserSheet userId={userId}>
      <UserDetailContent user={data} updating={isFetching} />
    </UserSheet>
  );
}

/** The sheet while the user loads: a title for assistive technology and skeleton sections. */
function UserPending() {
  const { userId } = Route.useParams();
  return (
    <UserSheet userId={userId}>
      <SheetHeader className="border-b">
        <SheetTitle>{m.admin_users_detail_loading()}</SheetTitle>
        <SheetDescription className="sr-only">{m.admin_users_detail_loading()}</SheetDescription>
      </SheetHeader>
      <div aria-hidden="true" className="flex flex-col gap-4 p-4">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </UserSheet>
  );
}

/** The sheet when the user failed to load: what went wrong and a retry. */
function UserError({ reset }: ErrorComponentProps) {
  const { userId } = Route.useParams();
  const retry = useRouteRetry(reset);
  return (
    <UserSheet userId={userId}>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <CircleAlertIcon aria-hidden="true" className="text-destructive" />
          {m.error_title()}
        </SheetTitle>
        <SheetDescription role="alert">{m.error_body()}</SheetDescription>
      </SheetHeader>
      <div className="px-4">
        <Button type="button" onClick={retry}>
          {m.error_retry()}
        </Button>
      </div>
    </UserSheet>
  );
}

function UserNotFound() {
  const { userId } = Route.useParams();
  return (
    <UserSheet userId={userId}>
      <SheetHeader>
        <SheetTitle>{m.admin_users_not_found_title()}</SheetTitle>
        <SheetDescription>{m.admin_users_error_not_found()}</SheetDescription>
      </SheetHeader>
    </UserSheet>
  );
}
