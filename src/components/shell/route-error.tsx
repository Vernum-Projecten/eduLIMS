// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { type ErrorComponentProps, Link, useRouter } from "@tanstack/react-router";
import { CircleAlertIcon } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";

/** A full-page status (not found, an error) with its own `h1`, built on shadcn `Empty`. */
export function StatusPage({
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

/**
 * Returns the retry of a route's error state. Mounting resets the Query error boundary, so a
 * query that threw renders fresh once the route renders again; the retry resets the route's
 * own boundary and runs its loaders again (`router.invalidate`).
 */
export function useRouteRetry(reset: () => void): () => void {
  const router = useRouter();
  const queryErrorReset = useQueryErrorResetBoundary();
  useEffect(() => {
    queryErrorReset.reset();
  }, [queryErrorReset]);
  return () => {
    reset();
    void router.invalidate();
  };
}

/**
 * The error state of a data route (its `errorComponent`): what went wrong, in an alert, a
 * retry that loads the route's data again, and a way home. The app shell stays around it.
 */
export function RouteErrorState({ reset }: Pick<ErrorComponentProps, "reset">) {
  const retry = useRouteRetry(reset);
  return (
    <StatusPage
      icon={<CircleAlertIcon aria-hidden="true" />}
      title={m.error_title()}
      body={<span role="alert">{m.error_body()}</span>}
    >
      <Button type="button" onClick={retry}>
        {m.error_retry()}
      </Button>
      <Button asChild variant="outline">
        <Link to="/">{m.back_to_home()}</Link>
      </Button>
    </StatusPage>
  );
}
