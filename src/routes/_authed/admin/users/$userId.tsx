// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { UserDetailContent } from "@/components/admin-users/user-detail-sheet";
import { userLinkId } from "@/components/admin-users/users-columns";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  const { data } = useSuspenseQuery(adminUserQueryOptions(userId));
  return (
    <UserSheet userId={userId}>
      <UserDetailContent user={data} />
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
