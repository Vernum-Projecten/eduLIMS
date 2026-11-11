// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { LogInIcon } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";
import { useAppForm } from "@/components/form/app-form";
import { DemoAccountsPanel } from "@/components/login/demo-accounts";
import { BLOCKED_ERROR } from "@/components/login/sign-in";
import { FieldGroup } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { authClient } from "@/lib/auth-client";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { rolesLabel } from "@/lib/i18n/labels";
import { cookieLocaleDiffersFromDocument } from "@/lib/i18n/locale";
import type { DemoAccount, DemoAccounts } from "@/server/demo-accounts";

const devLoginSchema = z.object({
  email: z.email({ error: () => m.validation_email() }),
  password: z.string().min(1, { error: () => m.validation_password() }),
});

/**
 * The development login (test accounts, never in production): email and password checked by
 * better-auth, whose refusal (wrong credentials, a blocked account) shows at the top of the form.
 */
export function DevLoginForm({ demoAccounts }: Readonly<{ demoAccounts: DemoAccounts | null }>) {
  const router = useRouter();
  const [filled, setFilled] = useState<string | null>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  const form = useAppForm({
    defaultValues: { email: "", password: "" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: devLoginSchema },
    onSubmit: async ({ value, formApi }) => {
      const { error } = await authClient.signIn.email(value);
      if (error) {
        applyServerRefusal(formApi, {
          form: error.code === BLOCKED_ERROR ? m.login_error_blocked() : m.dev_login_failed(),
        });
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
    applyServerRefusal(form, {});
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
        <form.AppForm>
          <FieldGroup>
            <form.FormErrors title={null} />
            <form.AppField name="email">
              {(field) => (
                <field.TextField
                  id="email"
                  type="email"
                  label={m.field_email()}
                  autoComplete="username"
                />
              )}
            </form.AppField>
            <form.AppField name="password">
              {(field) => (
                <field.TextField
                  id="password"
                  type="password"
                  label={m.field_password()}
                  autoComplete="current-password"
                />
              )}
            </form.AppField>
            <p role="status" className="sr-only">
              {filled}
            </p>
            <form.SubmitButton
              ref={submitRef}
              variant="outline"
              icon={<LogInIcon aria-hidden="true" data-icon="inline-start" />}
            >
              {m.dev_login_submit()}
            </form.SubmitButton>
          </FieldGroup>
        </form.AppForm>
      </form>
      {demoAccounts && <DemoAccountsPanel accounts={demoAccounts} onUse={fillAccount} />}
    </>
  );
}
