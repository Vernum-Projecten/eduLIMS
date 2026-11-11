// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { HistoryIcon, LogInIcon, MailIcon } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";
import { DemoAccountsPanel } from "@/components/login/demo-accounts";
import { ProviderIconGlyph } from "@/components/login/provider-icon";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { m } from "@/i18n/messages";
import { authClient } from "@/lib/auth-client";
import { rolesLabel } from "@/lib/i18n/labels";
import { cookieLocaleDiffersFromDocument } from "@/lib/i18n/locale";
import { signInMethodLabel } from "@/lib/i18n/user-labels";
import {
  ACCOUNT_NOT_LINKED_ERROR,
  type IdentityProviderOption,
  NO_ROLE_ERROR,
  normalizeSignInError,
  PROVIDER_DISABLED_ERROR,
  type ProviderId,
  ROLE_CONFLICT_ERROR,
  SAML_NAMEID_ERROR,
} from "@/lib/identity-providers";
import { routeInstitutionEmail } from "@/lib/session.functions";
import type { SignInMethod } from "@/lib/sign-in-method";
import type { DemoAccount, DemoAccounts } from "@/server/demo-accounts";

/**
 * The sign-in options (from the login-02 block's `LoginForm`): the heading, an error from the
 * identity provider, one button per enabled provider, the institution-email field when any
 * provider has domains and, in development only, the test-account form with the demo accounts.
 */
export function LoginForm({
  providers,
  emailRouting,
  devLogin,
  demoAccounts,
  redirectTo,
  error,
  lastSignInMethod,
}: Readonly<{
  providers: readonly IdentityProviderOption[];
  emailRouting: boolean;
  devLogin: boolean;
  demoAccounts: DemoAccounts | null;
  redirectTo: string | undefined;
  error: string | undefined;
  /** The method this browser signed in with last time, when the page still offers it (#34). */
  lastSignInMethod: SignInMethod | null;
}>) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 text-center">
        <h1 className="text-2xl font-bold tracking-tight">{m.sign_in()}</h1>
        <p className="text-sm text-balance text-muted-foreground">{m.login_description()}</p>
      </div>
      <FieldGroup>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {loginErrorMessage(error)}
          </p>
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
        {providers.length === 0 && !devLogin && (
          <p className="text-sm text-muted-foreground">{m.login_no_method()}</p>
        )}
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

/** better-auth's error code for a sign-in of a blocked user (admin plugin, 1.7.20). */
const BLOCKED_ERROR = "BANNED_USER";

/**
 * Returns the translated message for a sign-in error code on `/login`. Every other code (the
 * plugin's `invalid_state`, `invalid_provider`, `discovery_failed`, a replayed assertion) gets
 * one generic message; the details are in the server log only.
 */
export function loginErrorMessage(error: string): string {
  if (error === BLOCKED_ERROR) return m.login_error_blocked();
  const code = normalizeSignInError(error);
  if (code === NO_ROLE_ERROR) return m.login_error_no_role();
  if (code === ROLE_CONFLICT_ERROR) return m.login_error_role_conflict();
  if (code === ACCOUNT_NOT_LINKED_ERROR) return m.login_error_account_not_linked();
  if (code === PROVIDER_DISABLED_ERROR) return m.login_error_provider_disabled();
  if (code === SAML_NAMEID_ERROR) return m.login_error_saml_nameid();
  if (code === "banned_user") return m.login_error_blocked();
  return m.login_error_failed();
}

/** Returns the name the hint gives a sign-in method: the provider's button label. */
function lastMethodName(
  method: SignInMethod,
  providers: readonly IdentityProviderOption[],
): string {
  const label = providers.find((provider) => provider.id === method)?.label;
  return label ?? signInMethodLabel(method);
}

/** Where the identity provider returns the browser: the login page, which then redirects on. */
function callbackFor(redirectTo: string | undefined): string {
  return redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : "/login";
}

/** Starts the sign-in through `providerId`; on success the browser is already navigating. */
async function startSignIn(providerId: ProviderId, redirectTo: string | undefined) {
  return authClient.signIn.sso({
    providerId,
    callbackURL: callbackFor(redirectTo),
    errorCallbackURL: "/login",
  });
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

const institutionEmailSchema = z.object({
  email: z.email({ error: () => m.validation_email() }),
});

/**
 * "Sign in with your institution email": the server maps the domain to an enabled provider.
 * An unknown domain gets the same message as any other miss, so no domain list leaks.
 */
function InstitutionEmailForm({ redirectTo }: Readonly<{ redirectTo: string | undefined }>) {
  const route = useServerFn(routeInstitutionEmail);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { email: "" },
    validators: { onSubmit: institutionEmailSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const { providerId } = await route({ data: { email: value.email } });
      if (!providerId) {
        setFormError(m.login_email_unknown());
        return;
      }
      const { error } = await startSignIn(providerId, redirectTo);
      if (error) setFormError(m.login_error_failed());
    },
  });

  return (
    <form
      noValidate
      aria-label={m.login_email_title()}
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <FieldSeparator>{m.login_email_separator()}</FieldSeparator>
        <form.Field name="email">
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor="institution-email">{m.login_email_label()}</FieldLabel>
                <Input
                  id="institution-email"
                  name={field.name}
                  type="email"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={isInvalid}
                  autoComplete="email"
                  className="bg-background"
                />
                <FieldDescription>{m.login_email_help()}</FieldDescription>
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" variant="outline" disabled={isSubmitting}>
              <MailIcon aria-hidden="true" data-icon="inline-start" />
              {m.login_email_submit()}
            </Button>
          )}
        </form.Subscribe>
      </FieldGroup>
    </form>
  );
}

const devLoginSchema = z.object({
  email: z.email({ error: () => m.validation_email() }),
  password: z.string().min(1, { error: () => m.validation_password() }),
});

function DevLoginForm({ demoAccounts }: Readonly<{ demoAccounts: DemoAccounts | null }>) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [filled, setFilled] = useState<string | null>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  const form = useForm({
    defaultValues: { email: "", password: "" },
    validators: { onSubmit: devLoginSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const { error } = await authClient.signIn.email(value);
      if (error) {
        setFormError(error.code === BLOCKED_ERROR ? m.login_error_blocked() : m.dev_login_failed());
        return;
      }
      // The sign-in set the cookie from the user's saved language: render the next page in it.
      if (cookieLocaleDiffersFromDocument()) {
        window.location.reload();
        return;
      }
      // Re-runs the login route's beforeLoad, which redirects to the right portal.
      await router.invalidate();
    },
  });

  function fillAccount(account: DemoAccount) {
    form.setFieldValue("email", account.username);
    form.setFieldValue("password", account.password);
    setFormError(null);
    setFilled(m.demo_accounts_filled({ role: rolesLabel(account.roles) }));
    submitRef.current?.focus();
  }

  return (
    <>
      <form
        id="dev-login-form"
        noValidate
        aria-label={m.dev_login_submit()}
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <FieldGroup>
          <form.Field name="email">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>{m.field_email()}</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="email"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={isInvalid}
                    aria-describedby={isInvalid ? `${field.name}-error` : undefined}
                    autoComplete="username"
                    className="bg-background"
                  />
                  {isInvalid && (
                    <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />
                  )}
                </Field>
              );
            }}
          </form.Field>
          <form.Field name="password">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>{m.field_password()}</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={isInvalid}
                    aria-describedby={isInvalid ? `${field.name}-error` : undefined}
                    autoComplete="current-password"
                    className="bg-background"
                  />
                  {isInvalid && (
                    <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />
                  )}
                </Field>
              );
            }}
          </form.Field>
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <p role="status" className="sr-only">
            {filled}
          </p>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button ref={submitRef} type="submit" variant="outline" disabled={isSubmitting}>
                <LogInIcon aria-hidden="true" data-icon="inline-start" />
                {m.dev_login_submit()}
              </Button>
            )}
          </form.Subscribe>
        </FieldGroup>
      </form>
      {demoAccounts && <DemoAccountsPanel accounts={demoAccounts} onUse={fillAccount} />}
    </>
  );
}
