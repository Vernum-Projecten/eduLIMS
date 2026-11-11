// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { CopyIcon } from "lucide-react";
import { useId } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { m } from "@/i18n/messages";
import type { ProviderDetail } from "@/server/idp/queries";

function CopyField({ label, value }: Readonly<{ label: string; value: string }>) {
  const id = useId();
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(m.idp_copied({ name: label }));
    } catch {
      toast.error(m.idp_refused_failed());
    }
  }
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex gap-2">
        <Input id={id} readOnly value={value} className="font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={m.idp_copy({ name: label })}
          onClick={() => void copy()}
        >
          <CopyIcon aria-hidden="true" />
        </Button>
      </div>
    </Field>
  );
}

/** The read-only URLs an administrator registers at the identity provider, per protocol. */
export function ProviderUrls({ provider }: Readonly<{ provider: ProviderDetail }>) {
  const { urls } = provider;
  return (
    <section aria-labelledby="idp-urls" className="flex max-w-2xl flex-col gap-4">
      <h2 id="idp-urls" className="text-lg font-semibold">
        {m.idp_urls_title()}
      </h2>
      <FieldGroup>
        {provider.protocol === "oidc" ? (
          <>
            <CopyField label={m.idp_url_redirect()} value={urls.redirectUri} />
            <CopyField label={m.idp_url_post_logout()} value={urls.postLogoutRedirectUri} />
            <p className="text-sm text-muted-foreground">
              {provider.endSession ? m.idp_logout_note() : m.idp_logout_none()}
            </p>
          </>
        ) : (
          <>
            <CopyField label={m.idp_url_entity_id()} value={urls.spEntityId} />
            <CopyField label={m.idp_url_acs()} value={urls.acsUrl} />
            <CopyField label={m.idp_url_metadata()} value={urls.spMetadataUrl} />
          </>
        )}
      </FieldGroup>
    </section>
  );
}
