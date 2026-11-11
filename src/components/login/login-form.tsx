// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { KeyRoundIcon, LogInIcon } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";
import { DemoAccountsPanel } from "@/components/login/demo-accounts";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { m } from "@/i18n/messages";
import { authClient } from "@/lib/auth-client";
import { providerLabel, roleLabel } from "@/lib/i18n/labels";
import { cookieLocaleDiffersFromDocument } from "@/lib/i18n/locale";
import {
  type IdentityProviderId,
  type IdentityProviderOption,
  NO_ROLE_ERROR,
} from "@/lib/identity-providers";
import type { DemoAccount, DemoAccounts } from "@/server/demo-accounts";

/**
 * The sign-in options (from the login-02 block's `LoginForm`): the heading, an error from the
 * identity provider, one button per configured provider and, in development only, the
 * test-account form with the demo accounts.
 */
export function LoginForm({
  providers,
  devLogin,
  demoAccounts,
  redirectTo,
  error,
}: Readonly<{
  providers: readonly IdentityProviderOption[];
  devLogin: boolean;
  demoAccounts: DemoAccounts | null;
  redirectTo: string | undefined;
  error: string | undefined;
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
            {error === NO_ROLE_ERROR ? m.login_error_no_role() : m.login_error_failed()}
          </p>
        )}
        {providers.map((provider) => (
          <ProviderLoginButton
            key={provider.id}
            providerId={provider.id}
            label={providerLabel(provider)}
            redirectTo={redirectTo}
          />
        ))}
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

function ProviderLoginButton({
  providerId,
  label,
  redirectTo,
}: Readonly<{ providerId: IdentityProviderId; label: string; redirectTo: string | undefined }>) {
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    const callback = redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : "/login";
    const { error } = await authClient.signIn.social({
      provider: providerId,
      callbackURL: callback,
      errorCallbackURL: "/login",
    });
    // On success the browser is already navigating to the identity provider.
    if (error) setPending(false);
  }

  return (
    <Button type="button" size="lg" onClick={() => void signIn()} disabled={pending}>
      <KeyRoundIcon aria-hidden="true" data-icon="inline-start" />
      {label}
    </Button>
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
        setFormError(m.dev_login_failed());
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
    setFilled(m.demo_accounts_filled({ role: roleLabel(account.role) }));
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
