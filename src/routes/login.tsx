// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { BrandPanel } from "@/components/login/brand-panel";
import { LoginForm } from "@/components/login/login-form";
import { BrandLink, DisplayMenus } from "@/components/shell/public-layout";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/shell/skip-link";
import { m } from "@/i18n/messages";
import { safeRedirectPath } from "@/lib/guards";
import { getLoginOptions } from "@/lib/session.functions";
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
  loader: () => getLoginOptions(),
  head: () => ({ meta: [{ title: `${m.sign_in()} | eduLIMS` }] }),
  component: LoginPage,
});

/** The login page, from the login-02 block: the form on one side, the brand panel on the other. */
function LoginPage() {
  const { providers, devLogin, demoAccounts, lastSignInMethod } = Route.useLoaderData();
  const search = Route.useSearch();

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <SkipLink />
      <div className="flex flex-col gap-4 p-4 sm:p-6 md:p-10">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <BrandLink />
          <DisplayMenus signedIn={false} />
        </header>
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="flex flex-1 items-center justify-center py-6 outline-none"
        >
          <div className="w-full max-w-sm">
            <LoginForm
              providers={providers}
              devLogin={devLogin}
              demoAccounts={demoAccounts}
              lastSignInMethod={lastSignInMethod}
              redirectTo={search.redirect}
              error={search.error}
            />
          </div>
        </main>
      </div>
      <BrandPanel className="min-h-40 lg:min-h-0" />
    </div>
  );
}
