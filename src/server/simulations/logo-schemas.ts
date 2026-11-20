// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The inputs of the lab logo (D10, #292). The upload is a form with the lab's id and one file;
// the file's name and declared type are never read, and its size and content are the server's
// own check (`checkLogo`), so a refusal is a typed code and a logged row.
import { z } from "zod";

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
