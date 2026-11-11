// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useForm } from "@tanstack/react-form";
import { PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { useId, useRef, useState } from "react";
import {
  NumberControl,
  roleOptions,
  SelectControl,
  SwitchControl,
} from "@/components/admin-idp/choice-controls";
import { iconLabel } from "@/components/admin-idp/idp-labels";
import {
  domainsFromText,
  type ProviderFormValues,
  providerFormSchema,
  type StoredSecrets,
} from "@/components/admin-idp/provider-form-schema";
import { TextControl } from "@/components/admin-idp/text-control";
import { type SaveRefusal, useSaveProvider } from "@/components/admin-idp/use-save-provider";
import { Button } from "@/components/ui/button";
import {
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { m } from "@/i18n/messages";
import { PROVIDER_ICONS, type ProviderProtocol } from "@/lib/identity-providers";
import { isRole } from "@/lib/roles";
import { providerSettingsSchema } from "@/server/idp/schemas";

/**
 * The add and edit form of an identity provider (#46): the sign-in button, the connection for
 * its protocol (secrets write-only), the role claim and role map, and the email settings. A
 * server refusal shows at the field it concerns, else at the top with focus moved to it.
 */
export function ProviderForm({
  mode,
  protocol,
  initial,
  stored,
}: Readonly<{
  mode: "create" | "edit";
  protocol: ProviderProtocol;
  initial: ProviderFormValues;
  stored?: StoredSecrets;
}>) {
  const save = useSaveProvider(mode);
  const id = useId();
  const alertRef = useRef<HTMLParagraphElement>(null);
  const [refusal, setRefusal] = useState<SaveRefusal | null>(null);
  const [domainsText, setDomainsText] = useState(initial.settings.domains.join("\n"));

  const form = useForm({
    defaultValues: initial,
    validators: { onSubmit: providerFormSchema(mode, protocol) },
    onSubmit: async ({ value }) => {
      setRefusal(null);
      const refused = await save(value);
      if (refused) {
        setRefusal(refused);
        if (!refused.field) requestAnimationFrame(() => alertRef.current?.focus());
        return;
      }
      if (mode === "create") return;
      form.setFieldValue("oidc.clientSecret", "");
      form.setFieldValue("saml.spPrivateKey", "");
      form.setFieldValue("saml.metadataXml", "");
    },
  });

  const serverErrorAt = (field: string) => (refusal?.field === field ? refusal.message : null);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      className="flex max-w-2xl flex-col gap-8"
    >
      {refusal && refusal.field === null && (
        <p ref={alertRef} tabIndex={-1} role="alert" className="text-sm text-destructive">
          {refusal.message}
        </p>
      )}
      <FieldSet>
        <FieldLegend>{m.idp_section_general()}</FieldLegend>
        <FieldGroup>
          <form.Field name="providerId">
            {(field) => (
              <TextControl
                field={field}
                id={`${id}-provider-id`}
                label={m.idp_field_id()}
                help={m.idp_field_id_help()}
                serverError={serverErrorAt("providerId")}
                disabled={mode === "edit"}
              />
            )}
          </form.Field>
          <form.Field name="settings.labelEn">
            {(field) => (
              <TextControl
                field={field}
                id={`${id}-label-en`}
                label={m.idp_field_label_en()}
                help={m.idp_label_help()}
              />
            )}
          </form.Field>
          <form.Field name="settings.labelNl">
            {(field) => (
              <TextControl field={field} id={`${id}-label-nl`} label={m.idp_field_label_nl()} />
            )}
          </form.Field>
          <form.Field name="settings.icon">
            {(field) => (
              <SelectControl
                id={`${id}-icon`}
                name={field.name}
                label={m.idp_field_icon()}
                value={field.state.value}
                options={PROVIDER_ICONS.map((icon) => ({ value: icon, label: iconLabel(icon) }))}
                onValueChange={(value) => {
                  const icon = PROVIDER_ICONS.find((option) => option === value);
                  if (icon) field.handleChange(icon);
                }}
              />
            )}
          </form.Field>
          <form.Field name="settings.sortOrder">
            {(field) => (
              <NumberControl
                id={`${id}-order`}
                name={field.name}
                label={m.idp_field_order()}
                help={m.idp_field_order_help()}
                value={field.state.value}
                onBlur={field.handleBlur}
                onValueChange={(value) => field.handleChange(value)}
              />
            )}
          </form.Field>
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>{m.idp_section_protocol()}</FieldLegend>
        {protocol === "oidc" ? (
          <FieldGroup>
            <form.Field name="oidc.issuer">
              {(field) => (
                <TextControl
                  field={field}
                  id={`${id}-issuer`}
                  type="url"
                  label={m.idp_field_issuer()}
                  help={m.idp_field_issuer_help()}
                  serverError={serverErrorAt("oidc.issuer")}
                />
              )}
            </form.Field>
            <form.Field name="oidc.clientId">
              {(field) => (
                <TextControl field={field} id={`${id}-client-id`} label={m.idp_field_client_id()} />
              )}
            </form.Field>
            <form.Field name="oidc.clientSecret">
              {(field) => (
                <TextControl
                  field={field}
                  id={`${id}-client-secret`}
                  type="password"
                  label={m.idp_field_client_secret()}
                  help={stored?.clientSecret ? m.idp_secret_set() : m.idp_secret_help_new()}
                  serverError={serverErrorAt("oidc.clientSecret")}
                />
              )}
            </form.Field>
            <form.Field name="oidc.attestPkce">
              {(field) => (
                <SwitchControl
                  id={`${id}-attest-pkce`}
                  name={field.name}
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                  label={m.idp_field_attest_pkce()}
                  help={m.idp_attest_pkce_help()}
                  warning={m.idp_attest_pkce_warning()}
                />
              )}
            </form.Field>
          </FieldGroup>
        ) : (
          <FieldGroup>
            <FieldDescription>
              {stored?.metadata ? m.idp_metadata_keep() : m.idp_metadata_help()}
            </FieldDescription>
            <form.Field name="saml.metadataXml">
              {(field) => (
                <TextControl
                  field={field}
                  id={`${id}-metadata`}
                  rows={6}
                  mono
                  label={m.idp_field_metadata_xml()}
                  serverError={serverErrorAt("saml.metadataXml")}
                />
              )}
            </form.Field>
            <form.Field name="saml.metadataUrl">
              {(field) => (
                <TextControl
                  field={field}
                  id={`${id}-metadata-url`}
                  type="url"
                  label={m.idp_field_metadata_url()}
                />
              )}
            </form.Field>
            <form.Field name="saml.spPrivateKey">
              {(field) => (
                <TextControl
                  field={field}
                  id={`${id}-sp-key`}
                  rows={3}
                  mono
                  label={m.idp_field_sp_key()}
                  help={stored?.spPrivateKey ? m.idp_sp_key_set() : m.idp_sp_key_help()}
                />
              )}
            </form.Field>
          </FieldGroup>
        )}
      </FieldSet>

      <FieldSet>
        <FieldLegend>{m.idp_section_roles()}</FieldLegend>
        <FieldGroup>
          <form.Field name="settings.roleClaim">
            {(field) => (
              <TextControl
                field={field}
                id={`${id}-role-claim`}
                label={
                  protocol === "oidc"
                    ? m.idp_field_role_claim_oidc()
                    : m.idp_field_role_claim_saml()
                }
                help={
                  protocol === "oidc" ? m.idp_role_claim_oidc_help() : m.idp_role_claim_saml_help()
                }
              />
            )}
          </form.Field>
          <form.Field name="settings.roleMap" mode="array">
            {(rows) => (
              <FieldSet>
                <FieldLegend variant="label">{m.idp_role_map_legend()}</FieldLegend>
                <FieldDescription>{m.idp_role_map_help()}</FieldDescription>
                {rows.state.value.length === 0 && (
                  <p className="text-sm text-muted-foreground">{m.idp_role_map_empty()}</p>
                )}
                <ul className="flex flex-col gap-3">
                  {rows.state.value.map((_, index) => {
                    const row = String(index + 1);
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: TanStack Form addresses array rows by index.
                      <li key={index} className="flex flex-wrap items-end gap-2">
                        <form.Field name={`settings.roleMap[${index}].value`}>
                          {(field) => (
                            <TextControl
                              field={field}
                              id={`${id}-value-${index}`}
                              label={m.idp_role_map_value({ row })}
                              className="min-w-48 flex-1"
                            />
                          )}
                        </form.Field>
                        <form.Field name={`settings.roleMap[${index}].role`}>
                          {(field) => (
                            <SelectControl
                              id={`${id}-role-${index}`}
                              name={field.name}
                              label={m.idp_role_map_role({ row })}
                              value={field.state.value}
                              options={roleOptions()}
                              onValueChange={(value) => {
                                if (isRole(value)) field.handleChange(value);
                              }}
                              className="w-40"
                            />
                          )}
                        </form.Field>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label={m.idp_role_map_remove({ row })}
                          onClick={() => rows.removeValue(index)}
                        >
                          <Trash2Icon aria-hidden="true" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => rows.pushValue({ value: "", role: "student" })}
                >
                  <PlusIcon aria-hidden="true" data-icon="inline-start" />
                  {m.idp_role_map_add()}
                </Button>
                {rows.state.meta.errors.length > 0 && (
                  <FieldError errors={rows.state.meta.errors} />
                )}
              </FieldSet>
            )}
          </form.Field>
          <form.Field name="settings.defaultRole">
            {(field) => (
              <SelectControl
                id={`${id}-default-role`}
                name={field.name}
                label={m.idp_field_default_role()}
                help={m.idp_default_role_help()}
                value={field.state.value ?? ""}
                options={[{ value: "", label: m.idp_default_role_none() }, ...roleOptions()]}
                onValueChange={(value) => field.handleChange(isRole(value) ? value : null)}
              />
            )}
          </form.Field>
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>{m.idp_section_email()}</FieldLegend>
        <FieldGroup>
          <form.Field name="settings.emailAuthoritative">
            {(field) => (
              <SwitchControl
                id={`${id}-email-authoritative`}
                name={field.name}
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked)}
                label={m.idp_field_email_authoritative()}
                help={m.idp_email_authoritative_help()}
              />
            )}
          </form.Field>
          <form.Field
            name="settings.domains"
            validators={{ onBlur: providerSettingsSchema.shape.domains }}
          >
            {(field) => (
              <TextControl
                field={{
                  name: field.name,
                  state: { value: domainsText, meta: field.state.meta },
                  handleBlur: field.handleBlur,
                  handleChange: (value) => {
                    setDomainsText(value);
                    field.handleChange(domainsFromText(value));
                  },
                }}
                id={`${id}-domains`}
                rows={3}
                label={m.idp_field_domains()}
                help={m.idp_domains_help()}
                serverError={serverErrorAt("settings.domains")}
              />
            )}
          </form.Field>
        </FieldGroup>
      </FieldSet>

      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" disabled={isSubmitting} className="self-start">
            <SaveIcon aria-hidden="true" data-icon="inline-start" />
            {mode === "create" ? m.idp_create() : m.idp_save()}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
