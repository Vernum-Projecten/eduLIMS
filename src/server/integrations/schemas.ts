// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

/**
 * The input of the status read and of "Check now": nothing. A strict empty object, so a request
 * that tries to name a target (`url`, `host`, `integration`) is refused (SSRF, ASVS V1.3.6).
 */
export const integrationStatusInput = z.strictObject({});
export type IntegrationStatusInput = z.infer<typeof integrationStatusInput>;
