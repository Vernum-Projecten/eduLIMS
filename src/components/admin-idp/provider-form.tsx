// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { iconLabel, idpErrorField, idpErrorMessage } from "@/components/admin-idp/idp-labels";
import {
  domainsFromText,
  type ProviderFormValues,
  providerFormSchema,
  toCreateInput,
  toUpdateInput,
} from "@/components/admin-idp/provider-form-schema";
import { TextControl } from "@/components/admin-idp/text-control";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { m } from "@/i18n/messages";
import { roleLabel } from "@/lib/i18n/labels";
import { PROVIDER_ICONS, type ProviderProtocol } from "@/lib/identity-providers";
import { isRole, ROLES } from "@/lib/roles";
import { createIdentityProvider, updateIdentityProvider } from "@/server/idp/functions";
import {
  createProviderMutationOptions,
  idpErrorCode,
  updateProviderMutationOptions,
} from "@/server/idp/query-options";
import { providerSettingsSchema } from "@/server/idp/schemas";

/** What the edit form knows about stored secrets: only whether one is set. */
export interface StoredSecrets {
  clientSecret: boolean;
  spPrivateKey: boolean;
  metadata: boolean;
}

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
  const queryClient = useQueryClient();
  const create = useMutation(
    createProviderMutationOptions(queryClient, useServerFn(createIdentityProvider)),
  );
  const update = useMutation(
    updateProviderMutationOptions(queryClient, useServerFn(updateIdentityProvider)),
  );
  const navigate = useNavigate();
  const id = useId();
  const alertRef = useRef<HTMLParagraphElement>(null);
  const [refusal, setRefusal] = useState<{ field: string | null; message: string } | null>(null);
  const [domainsText, setDomainsText] = useState(initial.settings.domains.join("\n"));

  const form = useForm({
    defaultValues: initial,
    validators: { onSubmit: providerFormSchema(mode, protocol) },
    onSubmit: async ({ value }) => {
      setRefusal(null);
      let providerId: string;
      try {
        providerId =
          mode === "create"
            ? await create.mutateAsync(toCreateInput(value))
            : await update.mutateAsync(toUpdateInput(value));
      } catch (error) {
        const code = idpErrorCode(error);
        const field = code === "failed" ? null : idpErrorField(code);
        setRefusal({ field, message: idpErrorMessage(code) });
        if (!field) requestAnimationFrame(() => alertRef.current?.focus());
        return;
      }
      const name = value.settings.labelEn;
      if (mode === "create") {
        toast.success(m.idp_created_done({ name }));
        await navigate({
          to: "/admin/system/identity-providers/$providerId",
          params: { providerId },
        });
        return;
      }
      toast.success(m.idp_saved_done({ name }));
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
              <Field>
                <FieldLabel htmlFor={`${id}-icon`}>{m.idp_field_icon()}</FieldLabel>
                <NativeSelect
                  id={`${id}-icon`}
                  name={field.name}
                  value={field.state.value}
                  onChange={(e) => {
                    const icon = PROVIDER_ICONS.find((option) => option === e.target.value);
                    if (icon) field.handleChange(icon);
                  }}
                >
                  {PROVIDER_ICONS.map((icon) => (
                    <NativeSelectOption key={icon} value={icon}>
                      {iconLabel(icon)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </form.Field>
          <form.Field name="settings.sortOrder">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={`${id}-order`}>{m.idp_field_order()}</FieldLabel>
                <Input
                  id={`${id}-order`}
                  name={field.name}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={999}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(Number(e.target.value))}
                />
                <FieldDescription>{m.idp_field_order_help()}</FieldDescription>
              </Field>
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
                            <Field className="w-40">
                              <FieldLabel htmlFor={`${id}-role-${index}`}>
                                {m.idp_role_map_role({ row })}
                              </FieldLabel>
                              <NativeSelect
                                id={`${id}-role-${index}`}
                                name={field.name}
                                value={field.state.value}
                                onChange={(e) => {
                                  if (isRole(e.target.value)) field.handleChange(e.target.value);
                                }}
                              >
                                {ROLES.map((role) => (
                                  <NativeSelectOption key={role} value={role}>
                                    {roleLabel(role)}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                            </Field>
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
              <Field>
                <FieldLabel htmlFor={`${id}-default-role`}>{m.idp_field_default_role()}</FieldLabel>
                <NativeSelect
                  id={`${id}-default-role`}
                  name={field.name}
                  value={field.state.value ?? ""}
                  onChange={(e) =>
                    field.handleChange(isRole(e.target.value) ? e.target.value : null)
                  }
                >
                  <NativeSelectOption value="">{m.idp_default_role_none()}</NativeSelectOption>
                  {ROLES.map((role) => (
                    <NativeSelectOption key={role} value={role}>
                      {roleLabel(role)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldDescription>{m.idp_default_role_help()}</FieldDescription>
              </Field>
            )}
          </form.Field>
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>{m.idp_section_email()}</FieldLegend>
        <FieldGroup>
          <form.Field name="settings.emailAuthoritative">
            {(field) => (
              <Field orientation="horizontal">
                <Switch
                  id={`${id}-email-authoritative`}
                  name={field.name}
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                />
                <FieldContent>
                  <FieldLabel htmlFor={`${id}-email-authoritative`}>
                    {m.idp_field_email_authoritative()}
                  </FieldLabel>
                  <FieldDescription>{m.idp_email_authoritative_help()}</FieldDescription>
                </FieldContent>
              </Field>
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
