// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { locales } from "../../i18n/runtime.js";
import { ROLES } from "../../lib/roles.ts";

/** Input of `savePreferredLocale`: one of the Paraglide locales, nothing else (ADR 0011). */
export const savePreferredLocaleInput = z.object({ locale: z.enum(locales) });

export type SavePreferredLocaleInput = z.infer<typeof savePreferredLocaleInput>;

/** Input of `saveLastPortal`: one portal name, which is a role name (ADR 0012). */
export const saveLastPortalInput = z.object({ portal: z.enum(ROLES) });

export type SaveLastPortalInput = z.infer<typeof saveLastPortalInput>;
