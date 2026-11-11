// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon, CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { useEffect } from "react";
import { z } from "zod";
import { testResultPath } from "@/components/admin-idp/provider-actions";
import { Page } from "@/components/shell/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import { authClient } from "@/lib/auth-client";
import { rolesLabel } from "@/lib/i18n/labels";
import { parseProviderId, SAML_NAMEID_ERROR } from "@/lib/identity-providers";
import { portalNavigation } from "@/lib/navigation";
import { isRole } from "@/lib/roles";
import { identityProviderTestQueryOptions } from "@/server/idp/query-options";
import type { TestOutcome } from "@/server/idp/test-flow";

const testSearch = z.object({
  test: z
    .string()
    .regex(/^[A-Za-z0-9_-]{32}$/)
    .catch(""),
  start: z.literal("1").optional().catch(undefined),
});

export const Route = createFileRoute(
  "/_authed/admin/system/identity-providers/$providerId/test-result",
)({
  validateSearch: testSearch,
  loaderDeps: ({ search }) => ({ test: search.test, start: search.start }),
  loader: ({ context, params, deps }) =>
    deps.test && !deps.start
      ? context.queryClient.ensureQueryData(
          identityProviderTestQueryOptions(params.providerId, deps.test),
        )
      : null,
  head: () => ({
    meta: [{ title: `${m.idp_test_title()} | ${portalNavigation("admin").label()} | eduLIMS` }],
  }),
  component: TestResultPage,
});

/** Returns the sentence that explains a test outcome. */
function outcomeText(outcome: TestOutcome): string {
  const roles = rolesLabel(outcome.roles.filter(isRole));
  switch (outcome.outcome) {
    case "idp":
      return m.idp_test_outcome_idp({ roles });
    case "local":
      return m.idp_test_outcome_local({ roles });
    case "default":
      return m.idp_test_outcome_default({ roles });
    case "role_conflict":
      return m.idp_test_outcome_conflict();
    case SAML_NAMEID_ERROR:
      return m.idp_test_outcome_nameid();
    default:
      return m.idp_test_outcome_no_role();
  }
}

/** Starts the test sign-in in this tab, back to this page without the start flag. */
function StartTest({ providerId, test }: Readonly<{ providerId: string; test: string }>) {
  useEffect(() => {
    const id = parseProviderId(providerId);
    if (!id) return;
    const back = testResultPath(providerId, test);
    void authClient.signIn.sso({ providerId: id, callbackURL: back, errorCallbackURL: back });
  }, [providerId, test]);
  return <p role="status">{m.idp_test_pending()}</p>;
}

function Result({ providerId, test }: Readonly<{ providerId: string; test: string }>) {
  const { data } = useSuspenseQuery(identityProviderTestQueryOptions(providerId, test));
  if (data === null) {
    return (
      <Alert variant="destructive">
        <CircleAlertIcon aria-hidden="true" />
        <AlertDescription>{m.idp_test_not_found()}</AlertDescription>
      </Alert>
    );
  }
  if (!data.done) return <p role="status">{m.idp_test_pending()}</p>;
  const refused =
    data.outcome.outcome === "role_conflict" ||
    data.outcome.outcome === "no_edulims_role" ||
    data.outcome.outcome === SAML_NAMEID_ERROR;
  const Icon = refused ? CircleAlertIcon : CircleCheckIcon;
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Alert>
        <Icon aria-hidden="true" />
        <AlertDescription>{outcomeText(data.outcome)}</AlertDescription>
      </Alert>
      <section aria-labelledby="idp-claims" className="flex flex-col gap-2">
        <h2 id="idp-claims" className="text-lg font-semibold">
          {m.idp_test_claims()}
        </h2>
        <p className="text-sm text-muted-foreground">{m.idp_test_claims_help()}</p>
        <ul className="flex flex-wrap gap-2">
          {data.outcome.claimNames.map((name) => (
            <li key={name} className="rounded-md border px-2 py-1 font-mono text-xs">
              {name}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function TestResultPage() {
  const { providerId } = Route.useParams();
  const { test, start } = Route.useSearch();
  return (
    <Page
      title={m.idp_test_title()}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/system/identity-providers/$providerId" params={{ providerId }}>
            <ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
            {m.idp_test_back()}
          </Link>
        </Button>
      }
    >
      {!test ? (
        <p role="alert">{m.idp_test_not_found()}</p>
      ) : start ? (
        <StartTest providerId={providerId} test={test} />
      ) : (
        <Result providerId={providerId} test={test} />
      )}
    </Page>
  );
}
