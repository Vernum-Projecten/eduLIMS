// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useForm } from "@tanstack/react-form";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { m } from "@/i18n/messages";
import { authClient } from "@/lib/auth-client";
import { safeRedirectPath } from "@/lib/guards";
import { providerLabel } from "@/lib/i18n/labels";
import { cookieLocaleDiffersFromDocument } from "@/lib/i18n/locale";
import { type IdentityProviderId, NO_ROLE_ERROR } from "@/lib/identity-providers";
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

function LoginPage() {
  const { providers, devLogin } = Route.useLoaderData();
  const search = Route.useSearch();

  return (
    <div className="flex justify-center">
      <Card className="w-full sm:max-w-md">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold">{m.sign_in()}</h1>
          </CardTitle>
          <CardDescription>{m.login_description()}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {search.error && (
              <p role="alert" className="text-sm text-destructive">
                {search.error === NO_ROLE_ERROR ? m.login_error_no_role() : m.login_error_failed()}
              </p>
            )}
            {providers.map((provider) => (
              <ProviderLoginButton
                key={provider.id}
                providerId={provider.id}
                label={providerLabel(provider)}
                redirectTo={search.redirect}
              />
            ))}
            {providers.length === 0 && !devLogin && (
              <p className="text-sm text-muted-foreground">{m.login_no_method()}</p>
            )}
            {devLogin && (
              <>
                <FieldSeparator>{m.dev_login_separator()}</FieldSeparator>
                <DevLoginForm />
              </>
            )}
          </FieldGroup>
        </CardContent>
      </Card>
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
      {label}
    </Button>
  );
}

const devLoginSchema = z.object({
  email: z.email({ error: () => m.validation_email() }),
  password: z.string().min(1, { error: () => m.validation_password() }),
});

function DevLoginForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

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

  return (
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
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" variant="outline" disabled={isSubmitting}>
              {m.dev_login_submit()}
            </Button>
          )}
        </form.Subscribe>
      </FieldGroup>
    </form>
  );
}
