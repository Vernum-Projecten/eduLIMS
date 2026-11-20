// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { m } from "@/i18n/messages";
import { logoRefusalMessage } from "@/lib/i18n/simulation-labels";
import { precheckLogoFile } from "@/lib/lab-logo";

/**
 * The logo form on the teacher's lab page (#293), checked in the browser only: a file is chosen,
 * and its declared type and size pass {@link precheckLogoFile}. It differs from the server's
 * `uploadLogoInput` on purpose: the server ignores the declared type and the size field and reads
 * the content (ASVS 5.0 V2.2.2); its refusal codes show at the same field.
 */
export const logoFormSchema = z.object({
  file: z
    .instanceof(File)
    .nullable()
    .superRefine((file, ctx) => {
      if (file === null) {
        ctx.addIssue({ code: "custom", message: m.labs_logo_required() });
        return;
      }
      const refusal = precheckLogoFile(file);
      if (refusal !== null) ctx.addIssue({ code: "custom", message: logoRefusalMessage(refusal) });
    }),
});
export type LogoForm = z.input<typeof logoFormSchema>;
