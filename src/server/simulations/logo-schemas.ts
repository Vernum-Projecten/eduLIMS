// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The inputs of the lab logo (D10, #292). The upload is a form with the lab's id and one file;
// the file's name and declared type are never read, and its size and content are the server's
// own check (`checkLogo`), so a refusal is a typed code and a logged row.
import { z } from "zod";
import { m } from "@/i18n/messages";
import { logoRefusalMessage } from "@/lib/i18n/simulation-labels";
import { precheckLogoFile } from "@/lib/lab-logo";

/** The field names of the upload form; the screen (#293) builds its `FormData` with them. */
export const LOGO_FORM_FIELDS = { labId: "labId", file: "file" } as const;

/** The upload of a lab's logo: a `FormData` with the lab's id and the file. */
export const uploadLogoInput = z
  .instanceof(FormData)
  .transform((form) => ({
    labId: form.get(LOGO_FORM_FIELDS.labId),
    file: form.get(LOGO_FORM_FIELDS.file),
  }))
  .pipe(z.object({ labId: z.uuid(), file: z.instanceof(File) }));

/**
 * The logo form on the teacher's lab page (#293): one file, its declared type and size checked in
 * the browser before it is sent. The server reads neither and checks the content
 * ({@link uploadLogoInput}, then `checkLogo`); its refusal codes show at the same field.
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
