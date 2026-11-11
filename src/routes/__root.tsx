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
  useRouteContext,
} from "@tanstack/react-router";
import { CompassIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { PublicLayout } from "@/components/shell/public-layout";
import { RouteErrorState, StatusPage } from "@/components/shell/route-error";
import { ThemeProvider, useThemeState } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { m } from "@/i18n/messages";
import { getLocale } from "@/lib/i18n/locale";
import { sessionQueryOptions } from "@/lib/session.query-options";
import { themeClass } from "@/lib/theme";
import appCss from "@/styles/app.css?url";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // NOTE: no requirement governs this: our own design. The session query is always stale, so
  // every navigation asks the server and role changes apply at once; guards read the answer.
  beforeLoad: async ({ context }) => ({
    user: await context.queryClient.fetchQuery(sessionQueryOptions()),
  }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "description", content: m.app_description() },
      { name: "theme-color", content: "#3730a3" },
      { title: "eduLIMS" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  shellComponent: RootDocument,
  component: Outlet,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
});

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  const theme = useThemeState();
  return (
    <html lang={getLocale()} className={themeClass(theme.theme)}>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider value={theme}>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}

/** Renders a page outside the route tree (not found, error) in the chrome the visitor has. */
function Chrome({ children }: Readonly<{ children: ReactNode }>) {
  const user = useRouteContext({ from: "__root__", select: (context) => context.user });
  return user ? (
    <AppShell user={user}>{children}</AppShell>
  ) : (
    <PublicLayout signedIn={false}>{children}</PublicLayout>
  );
}

function NotFound() {
  return (
    <Chrome>
      <StatusPage
        icon={<CompassIcon aria-hidden="true" />}
        title={m.not_found_title()}
        body={m.not_found_body()}
      >
        <Button asChild>
          <Link to="/">{m.back_to_home()}</Link>
        </Button>
      </StatusPage>
    </Chrome>
  );
}

function RouteError({ reset }: ErrorComponentProps) {
  return (
    <Chrome>
      <RouteErrorState reset={reset} />
    </Chrome>
  );
}
