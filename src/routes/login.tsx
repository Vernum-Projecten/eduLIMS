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
import { authClient } from "@/lib/auth-client";
import { safeRedirectPath } from "@/lib/guards";
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
  head: () => ({ meta: [{ title: "Inloggen | eduLIMS" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { devLogin } = Route.useLoaderData();
  const search = Route.useSearch();

  return (
    <div className="flex justify-center">
      <Card className="w-full sm:max-w-md">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold">Inloggen</h1>
          </CardTitle>
          <CardDescription>Log in met je Hanze-account om eduLIMS te gebruiken.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {search.error && (
              <p role="alert" className="text-sm text-destructive">
                Inloggen is mislukt. Probeer het opnieuw of neem contact op met een beheerder.
              </p>
            )}
            <MicrosoftLoginButton redirectTo={search.redirect} />
            {devLogin && (
              <>
                <FieldSeparator>Alleen voor ontwikkeling</FieldSeparator>
                <DevLoginForm />
              </>
            )}
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  );
}

function MicrosoftLoginButton({ redirectTo }: Readonly<{ redirectTo: string | undefined }>) {
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    const callback = redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : "/login";
    const { error } = await authClient.signIn.social({
      provider: "microsoft",
      callbackURL: callback,
      errorCallbackURL: "/login?error=microsoft",
    });
    // On success the browser is already navigating to Microsoft.
    if (error) setPending(false);
  }

  return (
    <Button type="button" size="lg" onClick={() => void signIn()} disabled={pending}>
      Inloggen met Hanze-account
    </Button>
  );
}

const devLoginSchema = z.object({
  email: z.email("Vul een geldig e-mailadres in."),
  password: z.string().min(1, "Vul je wachtwoord in."),
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
        setFormError("Onjuist e-mailadres of wachtwoord.");
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
      aria-label="Inloggen met testaccount"
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
                <FieldLabel htmlFor={field.name}>E-mailadres</FieldLabel>
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
                <FieldLabel htmlFor={field.name}>Wachtwoord</FieldLabel>
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
              Inloggen met testaccount
            </Button>
          )}
        </form.Subscribe>
      </FieldGroup>
    </form>
  );
}
