// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

/** The input of the overview read: nothing, as a strict empty object. */
export const adminOverviewInput = z.strictObject({});
export type AdminOverviewInput = z.infer<typeof adminOverviewInput>;
