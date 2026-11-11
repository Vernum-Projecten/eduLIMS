// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { locales } from "../../i18n/runtime.js";

/** Input of `savePreferredLocale`: one of the Paraglide locales, nothing else (ADR 0011). */
export const savePreferredLocaleInput = z.object({ locale: z.enum(locales) });

export type SavePreferredLocaleInput = z.infer<typeof savePreferredLocaleInput>;
