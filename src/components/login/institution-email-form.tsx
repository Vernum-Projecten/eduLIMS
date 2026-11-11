// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { revalidateLogic } from "@tanstack/react-form";
import { useServerFn } from "@tanstack/react-start";
import { MailIcon } from "lucide-react";
import { useAppForm } from "@/components/form/app-form";
import { loginErrorMessage, startSignIn } from "@/components/login/sign-in";
import { FieldGroup, FieldSeparator } from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { applyServerRefusal } from "@/lib/forms/server-refusal";
import { routeInstitutionEmail } from "@/lib/session.functions";
import { institutionEmailInput } from "@/server/idp/schemas";

/**
 * "Sign in with your institution email": the server maps the domain to an enabled provider.
 * An unknown domain gets the same message as any other miss, so no domain list leaks; it shows
 * at the field, and a provider that refuses the start shows at the top of the form.
 */
export function InstitutionEmailForm({ redirectTo }: Readonly<{ redirectTo: string | undefined }>) {
  const route = useServerFn(routeInstitutionEmail);
  const form = useAppForm({
    defaultValues: { email: "" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: institutionEmailInput },
    onSubmit: async ({ value, formApi }) => {
      let providerId: Awaited<ReturnType<typeof route>>["providerId"];
      try {
        ({ providerId } = await route({ data: value }));
      } catch {
        // A failed check is not an unknown address: say so, and let the user try again.
        applyServerRefusal(formApi, { form: m.login_email_check_failed() });
        return;
      }
      if (!providerId) {
        applyServerRefusal(formApi, { fields: { email: m.login_email_unknown() } });
        return;
      }
      const { error } = await startSignIn(providerId, redirectTo);
      if (error) applyServerRefusal(formApi, { form: loginErrorMessage(error.code ?? "") });
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
      <form.AppForm>
        <FieldGroup>
          <FieldSeparator>{m.login_email_separator()}</FieldSeparator>
          <form.FormErrors title={null} />
          <form.AppField name="email">
            {(field) => (
              <field.TextField
                id="institution-email"
                type="email"
                label={m.login_email_label()}
                description={m.login_email_help()}
                autoComplete="email"
              />
            )}
          </form.AppField>
          <form.SubmitButton
            variant="outline"
            icon={<MailIcon aria-hidden="true" data-icon="inline-start" />}
          >
            {m.login_email_submit()}
          </form.SubmitButton>
        </FieldGroup>
      </form.AppForm>
    </form>
  );
}
