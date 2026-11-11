// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { LoginForm } from "@/components/login/login-form";
import { LoginLayout, LoginSkeleton } from "@/components/login/login-layout";
import { RouteErrorState } from "@/components/shell/route-error";
import { UpdatingIndicator } from "@/components/shell/updating-indicator";
import { m } from "@/i18n/messages";
import { safeRedirectPath } from "@/lib/guards";
import { loginOptionsQueryOptions } from "@/lib/login.query-options";
import { portalPathFor } from "@/server/authz";

const loginSearchSchema = z.object({
  redirect: z.string().optional().catch(undefined).transform(safeRedirectPath),
  error: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/login")({
  validateSearch: loginSearchSchema,
  beforeLoad: ({ context, search }) => {
    if (context.user) {
      throw redirect({ href: search.redirect ?? portalPathFor(context.user) ?? "/" });
    }
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(loginOptionsQueryOptions());
  },
  head: () => ({ meta: [{ title: `${m.sign_in()} | eduLIMS` }] }),
  pendingComponent: LoginPending,
  errorComponent: LoginError,
  component: LoginPage,
});

function LoginPending() {
  return (
    <LoginLayout busy>
      <LoginSkeleton />
    </LoginLayout>
  );
}

function LoginError({ reset }: Pick<ErrorComponentProps, "reset">) {
  return (
    <LoginLayout>
      <RouteErrorState reset={reset} />
    </LoginLayout>
  );
}

/** The login page, from the login-02 block: the form on one side, the brand panel on the other. */
function LoginPage() {
  const { data, isFetching } = useSuspenseQuery(loginOptionsQueryOptions());
  const search = Route.useSearch();

  return (
    <LoginLayout busy={isFetching}>
      <UpdatingIndicator active={isFetching} />
      <div className="w-full max-w-sm">
        <LoginForm options={data} redirectTo={search.redirect} error={search.error} />
      </div>
    </LoginLayout>
  );
}
