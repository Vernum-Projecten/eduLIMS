// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { KeyRoundIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { m } from "@/i18n/messages";
import { formatDateTime } from "@/lib/i18n/format";
import { roleLabel } from "@/lib/i18n/labels";
import type { ProviderProtocol } from "@/lib/identity-providers";
import type { BuildInfo } from "@/server/system/build-info";
import type { SystemProvider } from "@/server/system/queries";

/** The organisation whose attestations a release image carries (docs/release.md). */
const ATTESTATION_OWNER = "Vernum-Projecten";

function protocolLabel(protocol: ProviderProtocol): string {
  return protocol === "saml" ? m.idp_protocol_saml() : m.idp_protocol_oidc();
}

function Item({ term, children }: Readonly<{ term: string; children: ReactNode }>) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** A value that may hold no spaces (a URL, a SHA): it wraps anywhere, so 320 px never scrolls. */
function Code({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm break-all">{children}</code>
  );
}

function NotAvailable() {
  return <span className="text-muted-foreground">{m.admin_system_not_available()}</span>;
}

function ProviderCard({ provider }: Readonly<{ provider: SystemProvider }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h3 className="text-base font-semibold">{provider.label}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
          <Item term={m.idp_field_id()}>
            <Code>{provider.providerId}</Code>
          </Item>
          <Item term={m.admin_system_protocol()}>{protocolLabel(provider.protocol)}</Item>
          <Item term={provider.protocol === "saml" ? m.idp_url_acs() : m.idp_url_redirect()}>
            <Code>{provider.callbackUrl}</Code>
          </Item>
          <Item
            term={
              provider.protocol === "saml"
                ? m.idp_field_role_claim_saml()
                : m.idp_field_role_claim_oidc()
            }
          >
            <Code>{provider.roleClaim}</Code>
          </Item>
          <Item term={m.idp_field_default_role()}>
            {provider.defaultRole ? roleLabel(provider.defaultRole) : m.idp_default_role_none()}
          </Item>
        </dl>
        {provider.roleMap.length === 0 ? (
          <p className="text-muted-foreground">{m.idp_role_map_empty()}</p>
        ) : (
          <Table>
            <TableCaption className="mt-0 mb-2 caption-top text-left text-foreground">
              {m.idp_role_map_legend()}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{m.admin_system_role_map_value()}</TableHead>
                <TableHead scope="col">{m.admin_system_role_map_role()}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {provider.roleMap.map((entry) => (
                <TableRow key={entry.value}>
                  <TableCell className="whitespace-normal">
                    <Code>{entry.value}</Code>
                  </TableCell>
                  <TableCell>{roleLabel(entry.role)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/** The enabled identity providers of the system page (#36), read-only and without secrets. */
export function SystemProviders({ providers }: Readonly<{ providers: SystemProvider[] }>) {
  if (providers.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <KeyRoundIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>
            <h3>{m.admin_system_providers_empty_title()}</h3>
          </EmptyTitle>
          <EmptyDescription>{m.admin_system_providers_empty_body()}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {providers.map((provider) => (
        <li key={provider.providerId}>
          <ProviderCard provider={provider} />
        </li>
      ))}
    </ul>
  );
}

/** The version, commit, build time and SLSA provenance of the running build (#36). */
export function SystemBuild({ build }: Readonly<{ build: BuildInfo }>) {
  return (
    <Card>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
          <Item term={m.admin_system_version()}>{build.version ?? <NotAvailable />}</Item>
          <Item term={m.admin_system_commit()}>
            {build.revision ? <Code>{build.revision}</Code> : <NotAvailable />}
          </Item>
          <Item term={m.admin_system_build_created()}>
            {build.createdAt ? (
              <time dateTime={build.createdAt}>{formatDateTime(build.createdAt)}</time>
            ) : (
              <NotAvailable />
            )}
          </Item>
          <Item term={m.admin_system_provenance()}>
            {build.provenance ? (
              <span className="flex flex-col gap-1">
                <Code>{build.provenance}</Code>
                <span className="text-sm text-muted-foreground">
                  {m.admin_system_provenance_verify()}
                </span>
                <Code>{`gh attestation verify ${build.provenance} --owner ${ATTESTATION_OWNER}`}</Code>
              </span>
            ) : (
              <NotAvailable />
            )}
          </Item>
        </dl>
      </CardContent>
    </Card>
  );
}
