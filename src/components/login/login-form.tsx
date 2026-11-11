// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { CircleAlertIcon, HistoryIcon, KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { DevLoginForm } from "@/components/login/dev-login-form";
import { InstitutionEmailForm } from "@/components/login/institution-email-form";
import { ProviderIconGlyph } from "@/components/login/provider-icon";
import { loginErrorMessage, startSignIn } from "@/components/login/sign-in";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { FieldGroup, FieldSeparator } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { signInMethodLabel } from "@/lib/i18n/user-labels";
import type { IdentityProviderOption } from "@/lib/identity-providers";
import type { LoginOptions } from "@/lib/login.query-options";
import type { SignInMethod } from "@/lib/sign-in-method";

/** The heading of the login page, shared by the page and its loading state. */
export function LoginHeading() {
  return (
    <div className="flex flex-col gap-1 text-center">
      <h1 className="text-2xl font-bold tracking-tight">{m.sign_in()}</h1>
      <p className="text-sm text-balance text-muted-foreground">{m.login_description()}</p>
    </div>
  );
}

/**
 * The sign-in options (from the login-02 block's `LoginForm`): the heading, an error from the
 * identity provider, one button per enabled provider, the institution-email field when any
 * provider has domains and, in development only, the test-account form with the demo accounts.
 */
export function LoginForm({
  options,
  redirectTo,
  error,
}: Readonly<{
  options: LoginOptions;
  redirectTo: string | undefined;
  error: string | undefined;
}>) {
  const { providers, emailRouting, devLogin, demoAccounts, lastSignInMethod } = options;
  const noMethod = providers.length === 0 && !emailRouting && !devLogin;
  return (
    <div className="flex flex-col gap-6">
      <LoginHeading />
      <FieldGroup>
        {error && (
          <Alert variant="destructive">
            <CircleAlertIcon aria-hidden="true" />
            <AlertDescription>{loginErrorMessage(error)}</AlertDescription>
          </Alert>
        )}
        {lastSignInMethod && (
          <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
            <HistoryIcon aria-hidden="true" className="size-4 shrink-0" />
            {m.login_last_method({ method: lastMethodName(lastSignInMethod, providers) })}
          </p>
        )}
        {providers.map((provider) => (
          <ProviderLoginButton key={provider.id} provider={provider} redirectTo={redirectTo} />
        ))}
        {emailRouting && <InstitutionEmailForm redirectTo={redirectTo} />}
        {noMethod && <NoSignInMethod />}
        {devLogin && (
          <>
            <FieldSeparator>{m.dev_login_separator()}</FieldSeparator>
            <DevLoginForm demoAccounts={demoAccounts} />
          </>
        )}
      </FieldGroup>
    </div>
  );
}

/** The empty state: no provider is enabled and the development login is off. */
function NoSignInMethod() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <KeyRoundIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{m.login_no_method_title()}</EmptyTitle>
        <EmptyDescription>{m.login_no_method()}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** Returns the name the hint gives a sign-in method: the provider's button label. */
function lastMethodName(
  method: SignInMethod,
  providers: readonly IdentityProviderOption[],
): string {
  const label = providers.find((provider) => provider.id === method)?.label;
  return label ?? signInMethodLabel(method);
}

function ProviderLoginButton({
  provider,
  redirectTo,
}: Readonly<{ provider: IdentityProviderOption; redirectTo: string | undefined }>) {
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    const { error } = await startSignIn(provider.id, redirectTo);
    if (error) setPending(false);
  }

  return (
    <Button type="button" size="lg" onClick={() => void signIn()} disabled={pending}>
      <ProviderIconGlyph icon={provider.icon} />
      {m.login_with_provider({ provider: provider.label })}
    </Button>
  );
}
