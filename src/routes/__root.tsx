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
  useRouter,
} from "@tanstack/react-router";
import { CircleAlertIcon, CompassIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { PublicLayout } from "@/components/shell/public-layout";
import { ThemeProvider, useThemeState } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { m } from "@/i18n/messages";
import { getLocale } from "@/lib/i18n/locale";
import { getSession } from "@/lib/session.functions";
import { themeClass } from "@/lib/theme";
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

function StatusPage({
  icon,
  title,
  body,
  children,
}: Readonly<{ icon: ReactNode; title: string; body: ReactNode; children: ReactNode }>) {
  return (
    <section aria-labelledby="page-title" className="flex flex-1">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">{icon}</EmptyMedia>
          <h1 id="page-title" className="text-2xl font-semibold tracking-tight">
            {title}
          </h1>
          <EmptyDescription>{body}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row flex-wrap justify-center">{children}</EmptyContent>
      </Empty>
    </section>
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
  const router = useRouter();
  return (
    <Chrome>
      <StatusPage
        icon={<CircleAlertIcon aria-hidden="true" />}
        title={m.error_title()}
        body={<span role="alert">{m.error_body()}</span>}
      >
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
      </StatusPage>
    </Chrome>
  );
}
