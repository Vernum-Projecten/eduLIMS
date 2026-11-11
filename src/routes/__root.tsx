// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/// <reference types="vite/client" />
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  type ErrorComponentProps,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { m } from "@/i18n/messages";
import { getLocale } from "@/lib/i18n/locale";
import { getSession } from "@/lib/session.functions";
import appCss from "@/styles/app.css?url";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // Resolved on the server for every navigation, so role changes apply immediately.
  beforeLoad: async () => ({ user: await getSession() }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "description", content: m.app_description() },
      { title: "eduLIMS" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
});

function RootComponent() {
  const { user } = Route.useRouteContext();
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:ring-3 focus:ring-ring"
      >
        {m.skip_to_content()}
      </a>
      <SiteHeader user={user} />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-5xl px-4 py-8 outline-none">
        <Outlet />
      </main>
      <Toaster />
    </>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang={getLocale()}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function NotFound() {
  return (
    <section aria-labelledby="page-title" className="max-w-3xl">
      <h1 id="page-title" className="text-2xl font-semibold">
        {m.not_found_title()}
      </h1>
      <p className="mt-2 text-muted-foreground">{m.not_found_body()}</p>
      <Button asChild className="mt-6">
        <Link to="/">{m.back_to_home()}</Link>
      </Button>
    </section>
  );
}

function RouteError({ reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <section aria-labelledby="page-title" className="max-w-3xl">
      <h1 id="page-title" className="text-2xl font-semibold">
        {m.error_title()}
      </h1>
      <p role="alert" className="mt-2 text-muted-foreground">
        {m.error_body()}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          {m.error_retry()}
        </Button>
        <Button asChild variant="outline">
          <Link to="/">{m.back_to_home()}</Link>
        </Button>
      </div>
    </section>
  );
}
