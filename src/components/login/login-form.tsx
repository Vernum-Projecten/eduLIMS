// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { CircleAlertIcon, HistoryIcon, KeyRoundIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  const [refusal, setRefusal] = useState<StartRefusal | null>(null);
  const message = refusal?.message ?? (error ? loginErrorMessage(error) : null);
  return (
    <div className="flex flex-col gap-6">
      <LoginHeading />
      <FieldGroup>
        {message && <SignInErrorAlert message={message} focusKey={refusal?.key ?? null} />}
        {lastSignInMethod && (
          <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
            <HistoryIcon aria-hidden="true" className="size-4 shrink-0" />
            {m.login_last_method({ method: lastMethodName(lastSignInMethod, providers) })}
          </p>
        )}
        {providers.map((provider) => (
          <ProviderLoginButton
            key={provider.id}
            provider={provider}
            redirectTo={redirectTo}
            onRefused={(code) =>
              setRefusal((last) => ({
                message: loginErrorMessage(code),
                key: (last?.key ?? 0) + 1,
              }))
            }
          />
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

/** A refused start of a provider sign-in; `key` counts refusals, so a repeat takes focus again. */
interface StartRefusal {
  readonly message: string;
  readonly key: number;
}

/**
 * Why a sign-in was refused: from the identity provider's callback (`?error=`) or from a
 * provider that refused the start. A refused start moves focus here (WCAG 3.3.1, 4.1.3).
 */
function SignInErrorAlert({
  message,
  focusKey,
}: Readonly<{ message: string; focusKey: number | null }>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusKey !== null) ref.current?.focus();
  }, [focusKey]);
  return (
    <Alert
      ref={ref}
      tabIndex={-1}
      variant="destructive"
      className="outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <CircleAlertIcon aria-hidden="true" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function ProviderLoginButton({
  provider,
  redirectTo,
  onRefused,
}: Readonly<{
  provider: IdentityProviderOption;
  redirectTo: string | undefined;
  /** Called with the error code when the provider refuses the start. */
  onRefused: (code: string) => void;
}>) {
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    let code: string;
    try {
      const { error } = await startSignIn(provider.id, redirectTo);
      // On success the browser is already on its way to the identity provider.
      if (!error) return;
      code = error.code ?? "";
    } catch {
      // NOTE: no requirement governs this: our own design. A network failure gets the generic message.
      code = "";
    }
    setPending(false);
    onRefused(code);
  }

  return (
    <Button type="button" size="lg" onClick={() => void signIn()} disabled={pending}>
      <ProviderIconGlyph icon={provider.icon} />
      {m.login_with_provider({ provider: provider.label })}
    </Button>
  );
}
