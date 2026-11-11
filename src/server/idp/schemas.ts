// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The inputs of Admin → System → Identity providers (#46, ADR 0015): the rules of input.ts with
// translated messages, shared by the TanStack Forms and the server functions, so both refuse
// the same input; the host CLI (`pnpm idp:add`) runs the same rules with message codes.
import type { z } from "zod";
import { m } from "../../i18n/messages.js";
import { idpSchemas } from "./input.ts";

export { MAX_DOMAINS, MAX_METADATA_BYTES, MAX_ROLE_MAP_ENTRIES } from "./input.ts";

const schemas = idpSchemas(m);

/** See {@link idpSchemas}. */
export const providerIdSchema = schemas.providerIdSchema;
/** See {@link idpSchemas}. */
export const roleMapEntrySchema = schemas.roleMapEntrySchema;
/** See {@link idpSchemas}. */
export const providerSettingsSchema = schemas.providerSettingsSchema;
/** See {@link idpSchemas}. */
export const oidcConfigSchema = schemas.oidcConfigSchema;
/** See {@link idpSchemas}. */
export const samlConfigSchema = schemas.samlConfigSchema;
/** See {@link idpSchemas}. */
export const createOidcProviderInput = schemas.createOidcProviderInput;
/** See {@link idpSchemas}. */
export const createSamlProviderInput = schemas.createSamlProviderInput;
/** See {@link idpSchemas}. */
export const createProviderInput = schemas.createProviderInput;
/** See {@link idpSchemas}. */
export const updateProviderInput = schemas.updateProviderInput;
/** See {@link idpSchemas}. */
export const providerIdInput = schemas.providerIdInput;
/** See {@link idpSchemas}. */
export const setProviderEnabledInput = schemas.setProviderEnabledInput;
/** See {@link idpSchemas}. */
export const testResultInput = schemas.testResultInput;
/** See {@link idpSchemas}. */
export const institutionEmailInput = schemas.institutionEmailInput;

export type ProviderSettings = z.infer<typeof providerSettingsSchema>;
export type CreateProviderInput = z.infer<typeof createProviderInput>;
export type UpdateProviderInput = z.infer<typeof updateProviderInput>;
