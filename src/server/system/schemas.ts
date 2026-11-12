// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

/** The input of the system page's read: nothing, as a strict empty object. */
export const systemConfigurationInput = z.strictObject({});
export type SystemConfigurationInput = z.infer<typeof systemConfigurationInput>;
