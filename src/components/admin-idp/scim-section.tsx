// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { KeyRoundIcon, RefreshCwIcon, ShieldOffIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { CopyField } from "@/components/admin-idp/provider-urls";
import { ConfirmButton } from "@/components/admin-users/admin-action";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { m } from "@/i18n/messages";
import { formatDateTime } from "@/lib/i18n/format";
import {
  createScimTokenFn,
  revokeScimTokenFn,
  rotateScimTokenFn,
  setScimExternalIdClaimFn,
} from "@/server/scim/functions";
import {
  type IssuedScimToken,
  issueScimTokenMutationOptions,
  revokeScimTokenMutationOptions,
  type ScimChangeError,
  scimDetailQueryOptions,
  scimErrorCode,
  setExternalIdClaimMutationOptions,
} from "@/server/scim/query-options";
import { isExternalIdClaim } from "@/server/scim/schemas";

/** Returns the message of a refused SCIM change. */
export function scimErrorMessage(code: ScimChangeError): string {
  switch (code) {
    case "not_found":
      return m.idp_refused_not_found();
    case "exists":
      return m.scim_error_exists();
    case "no_token":
      return m.scim_error_no_token();
    case "invalid":
      return m.scim_claim_invalid();
    case "failed":
      return m.idp_refused_failed();
    default: {
      const unknown: never = code;
      return unknown;
    }
  }
}

/** The token a create or rotate just returned, shown once until the administrator hides it. */
function NewToken({ issued, onDone }: Readonly<{ issued: IssuedScimToken; onDone: () => void }>) {
  return (
    <Alert>
      <KeyRoundIcon aria-hidden="true" />
      <AlertTitle>{m.scim_token_shown_once_title()}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>{m.scim_token_shown_once_body()}</p>
        <CopyField label={m.scim_token_label()} value={issued.token} />
        <p>{m.scim_token_new_expires({ date: formatDateTime(issued.expiresAt) })}</p>
        {issued.previousValidUntil && (
          <p>{m.scim_token_overlap({ until: formatDateTime(issued.previousValidUntil) })}</p>
        )}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={onDone}>
          {m.scim_token_done()}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function claimFormSchema() {
  return z.object({
    claim: z
      .string()
      .trim()
      .refine((value) => value === "" || isExternalIdClaim(value), m.scim_claim_invalid()),
  });
}

function ExternalIdClaimForm({
  providerId,
  claim,
}: Readonly<{ providerId: string; claim: string | null }>) {
  const queryClient = useQueryClient();
  const id = useId();
  const save = useMutation({
    ...setExternalIdClaimMutationOptions(queryClient, useServerFn(setScimExternalIdClaimFn)),
    onSuccess: () => toast.success(m.scim_claim_saved()),
    onError: (error) => toast.error(scimErrorMessage(scimErrorCode(error))),
  });
  const form = useForm({
    defaultValues: { claim: claim ?? "" },
    validators: { onSubmit: claimFormSchema() },
    onSubmit: async ({ value }) => {
      const trimmed = value.claim.trim();
      // The schema above already refused anything else.
      if (trimmed !== "" && !isExternalIdClaim(trimmed)) return;
      await save.mutateAsync({ providerId, claim: trimmed === "" ? null : trimmed });
    },
  });
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field name="claim">
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={`${id}-claim`}>{m.scim_claim_label()}</FieldLabel>
                <Input
                  id={`${id}-claim`}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={isInvalid}
                  aria-describedby={`${id}-claim-help`}
                  className="font-mono"
                  maxLength={200}
                />
                <FieldDescription id={`${id}-claim-help`}>{m.scim_claim_help()}</FieldDescription>
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>
      </FieldGroup>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(submitting) => (
          <Button type="submit" size="sm" className="self-start" disabled={submitting}>
            {submitting ? m.scim_claim_saving() : m.scim_claim_save()}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

/**
 * The SCIM section of a provider's detail page (#45): the endpoint, the token (created, rotated
 * and revoked here, shown once) and the claim that links a sign-in to its provisioned user.
 */
export function ScimSection({ providerId }: Readonly<{ providerId: string }>) {
  const queryClient = useQueryClient();
  const { data: scim } = useSuspenseQuery(scimDetailQueryOptions(providerId));
  const [token, setToken] = useState<IssuedScimToken | null>(null);
  const onError = (error: unknown) => toast.error(scimErrorMessage(scimErrorCode(error)));
  const create = useMutation({
    ...issueScimTokenMutationOptions(queryClient, useServerFn(createScimTokenFn)),
    onSuccess: setToken,
    onError,
  });
  const rotate = useMutation({
    ...issueScimTokenMutationOptions(queryClient, useServerFn(rotateScimTokenFn)),
    onSuccess: setToken,
    onError,
  });
  const revoke = useMutation({
    ...revokeScimTokenMutationOptions(queryClient, useServerFn(revokeScimTokenFn)),
    onSuccess: () => {
      setToken(null);
      toast.success(m.scim_token_revoked_done());
    },
    onError,
  });
  const pending = create.isPending || rotate.isPending || revoke.isPending;

  return (
    <section aria-labelledby="idp-scim" className="flex max-w-2xl flex-col gap-4">
      <h2 id="idp-scim" className="text-lg font-semibold">
        {m.scim_title()}
      </h2>
      <p className="text-sm text-muted-foreground">{m.scim_intro()}</p>
      {!scim.available && (
        <Alert variant="destructive">
          <ShieldOffIcon aria-hidden="true" />
          <AlertTitle>{m.scim_unavailable_title()}</AlertTitle>
          <AlertDescription>{m.scim_unavailable_body()}</AlertDescription>
        </Alert>
      )}
      <FieldGroup>
        <CopyField label={m.scim_endpoint_label()} value={scim.endpoint} />
      </FieldGroup>
      <div role="status" className="flex flex-col gap-1 text-sm">
        <p>
          {scim.active && scim.createdAt && scim.expiresAt
            ? m.scim_token_active({
                created: formatDateTime(scim.createdAt),
                expires: formatDateTime(scim.expiresAt),
                used: scim.lastUsedAt ? formatDateTime(scim.lastUsedAt) : m.scim_token_never_used(),
              })
            : scim.expired && scim.expiresAt
              ? m.scim_token_expired({ date: formatDateTime(scim.expiresAt) })
              : m.scim_token_none()}
        </p>
        {scim.previousValidUntil && (
          <p>{m.scim_token_overlap({ until: formatDateTime(scim.previousValidUntil) })}</p>
        )}
      </div>
      {scim.expiresSoon && scim.expiresAt && (
        <Alert>
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{m.scim_token_expiring_title()}</AlertTitle>
          <AlertDescription>
            {m.scim_token_expiring_body({ date: formatDateTime(scim.expiresAt) })}
          </AlertDescription>
        </Alert>
      )}
      {token && <NewToken issued={token} onDone={() => setToken(null)} />}
      <div className="flex flex-wrap items-center gap-2">
        {scim.active || scim.expired ? (
          <>
            <ConfirmButton
              icon={RefreshCwIcon}
              label={m.scim_token_rotate()}
              title={m.scim_token_rotate_title()}
              description={m.scim_token_rotate_body()}
              confirm={m.scim_token_rotate()}
              pending={pending}
              onConfirm={() => rotate.mutate({ providerId })}
            />
            <ConfirmButton
              icon={ShieldOffIcon}
              label={m.scim_token_revoke()}
              title={m.scim_token_revoke_title()}
              description={m.scim_token_revoke_body()}
              confirm={m.scim_token_revoke()}
              destructive
              pending={pending}
              onConfirm={() => revoke.mutate({ providerId })}
            />
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => create.mutate({ providerId })}
          >
            <KeyRoundIcon aria-hidden="true" data-icon="inline-start" />
            {m.scim_token_create()}
          </Button>
        )}
      </div>
      <ExternalIdClaimForm
        key={scim.externalIdClaim ?? ""}
        providerId={providerId}
        claim={scim.externalIdClaim}
      />
    </section>
  );
}
