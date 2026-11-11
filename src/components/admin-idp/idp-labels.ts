// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Display names and refusal messages of Admin → System → Identity providers (#46).
import { m } from "@/i18n/messages";
import type { ProviderIcon, ProviderProtocol } from "@/lib/identity-providers";
import type { IdpServiceError } from "@/server/idp/service";

/** Returns the name of a protocol. */
export function protocolLabel(protocol: ProviderProtocol): string {
  return protocol === "saml" ? m.idp_protocol_saml() : m.idp_protocol_oidc();
}

/** Returns the name of a login-button icon. */
export function iconLabel(icon: ProviderIcon): string {
  switch (icon) {
    case "key-round":
      return m.idp_icon_key_round();
    case "building":
      return m.idp_icon_building();
    case "school":
      return m.idp_icon_school();
    case "shield":
      return m.idp_icon_shield();
    case "globe":
      return m.idp_icon_globe();
    default: {
      const unknown: never = icon;
      return unknown;
    }
  }
}

const REFUSALS: Readonly<Record<string, () => string>> = {
  not_found: m.idp_refused_not_found,
  exists: m.idp_refused_exists,
  has_accounts: m.idp_refused_has_accounts,
  last_enabled: m.idp_refused_last_enabled,
  domain_taken: m.idp_refused_domain_taken,
  issuer_insecure: m.idp_refused_issuer_insecure,
  issuer_private: m.idp_refused_issuer_private,
  issuer_unresolvable: m.idp_refused_issuer_unresolvable,
  discovery_failed: m.idp_refused_discovery_failed,
  issuer_mismatch: m.idp_refused_issuer_mismatch,
  endpoint_foreign_origin: m.idp_refused_endpoint_foreign_origin,
  no_pkce: m.idp_refused_no_pkce,
  unsupported_client_auth: m.idp_refused_unsupported_client_auth,
  metadata_fetch_failed: m.idp_refused_metadata_fetch_failed,
  metadata_too_large: m.idp_refused_metadata_too_large,
  metadata_invalid: m.idp_refused_metadata_invalid,
  metadata_no_signing_cert: m.idp_refused_metadata_no_signing_cert,
  metadata_no_sso_service: m.idp_refused_metadata_no_sso_service,
  metadata_no_persistent_nameid: m.idp_refused_metadata_no_persistent_nameid,
  missing_key: m.idp_refused_data_key,
  unknown_key: m.idp_refused_data_key,
  malformed: m.idp_refused_data_key,
  tampered: m.idp_refused_data_key,
  plaintext: m.idp_refused_data_key,
};

/** Returns the message of a refused provider change. */
export function idpErrorMessage(code: IdpServiceError | "failed"): string {
  return Object.hasOwn(REFUSALS, code)
    ? (REFUSALS[code]?.() ?? m.idp_refused_failed())
    : m.idp_refused_failed();
}

/** Returns the field a refusal belongs to, so the form shows it there (WCAG 3.3.1). */
export function idpErrorField(code: IdpServiceError): string | null {
  if (code === "exists") return "providerId";
  if (code === "domain_taken") return "settings.domains";
  if (code.startsWith("issuer_") || code === "discovery_failed") return "oidc.issuer";
  if (code.startsWith("metadata_")) return "saml.metadataXml";
  return null;
}
