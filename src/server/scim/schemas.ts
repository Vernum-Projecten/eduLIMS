// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The inputs of the SCIM section of a provider's detail page (#45, ADR 0017), shared by the form
// and the server functions. Message-free, since the host CLI loads them in plain Node: the
// error message is a code the screen translates.
import { z } from "zod";
import { PROVIDER_ID_PATTERN } from "../../lib/identity-providers.ts";

/** The message code of a claim name the schema refuses. */
export const CLAIM_INVALID = "scim_claim_invalid";

/**
 * The claims whose value never changes for a person, so they may link a sign-in to a SCIM
 * user (#45, H4, ASVS V6.8.1): Entra ID's object id (`oid`), the OIDC subject (`sub`) and
 * Active Directory's `objectGUID`. `null` is the account key: the OIDC `sub` or the SAML
 * persistent NameID. A mutable claim (`email`, `preferred_username`, `upn`) is refused.
 */
export const IMMUTABLE_EXTERNAL_ID_CLAIMS = ["oid", "sub", "objectGUID"] as const;

/** The claim that carries the directory id: one of {@link IMMUTABLE_EXTERNAL_ID_CLAIMS}, or `null`. */
export const externalIdClaimSchema = z
  .enum(IMMUTABLE_EXTERNAL_ID_CLAIMS, { error: CLAIM_INVALID })
  .nullable();

/** A configured directory-id claim; `null` is the account key. */
export type ExternalIdClaim = z.infer<typeof externalIdClaimSchema>;

/** Returns whether `value` is an allowed directory-id claim (the form's narrowing). */
export function isExternalIdClaim(value: string): value is NonNullable<ExternalIdClaim> {
  return (IMMUTABLE_EXTERNAL_ID_CLAIMS as readonly string[]).includes(value);
}

/** The provider a SCIM token action is about. */
export const scimProviderInput = z.object({
  providerId: z.string().regex(PROVIDER_ID_PATTERN),
});

/** A new external-id claim for a provider. */
export const scimExternalIdInput = z.object({
  providerId: z.string().regex(PROVIDER_ID_PATTERN),
  claim: externalIdClaimSchema,
});
