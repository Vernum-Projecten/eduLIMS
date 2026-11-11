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
 * A claim name: an ID-token claim by dot path (`oid`, `ext.employee_id`) or a SAML attribute
 * name (`urn:oid:0.9.2342.19200300.100.1.1`, a URL); `null` is the account key.
 */
export const externalIdClaimSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.:/#-]{1,200}$/, CLAIM_INVALID)
  .nullable();

/** The provider a SCIM token action is about. */
export const scimProviderInput = z.object({
  providerId: z.string().regex(PROVIDER_ID_PATTERN),
});

/** A new external-id claim for a provider. */
export const scimExternalIdInput = z.object({
  providerId: z.string().regex(PROVIDER_ID_PATTERN),
  claim: externalIdClaimSchema,
});
