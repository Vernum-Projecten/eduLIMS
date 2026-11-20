// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The inputs of a lab's Gen5 uploads (S4, #156). The upload is a form with the lab's id and one
// file; the file's name is read for its extension only, and its size and layout are the parser's
// own checks. Every list and text has a cap (security review of #372; ASVS V15.2.2, API4:2023).
import { z } from "zod";
import {
  UPLOAD_LAB_NUMBER_MAX,
  UPLOAD_LINKS_MAX,
  UPLOAD_VALUE_MAX,
  UPLOAD_WELL_MAX,
} from "../../lib/uploads.ts";

/** An id from the client in its canonical lower-case form (security review of #370, N3). */
const id = () => z.uuid().toLowerCase();

/** The field names of the upload form; the screen (#157) builds its `FormData` with them. */
export const GEN5_FORM_FIELDS = { labId: "labId", file: "file" } as const;

/** The upload of a Gen5 export: a `FormData` with the lab's id and the file. */
export const uploadGen5Input = z
  .instanceof(FormData)
  .transform((form) => ({
    labId: form.get(GEN5_FORM_FIELDS.labId),
    file: form.get(GEN5_FORM_FIELDS.file),
  }))
  .pipe(z.object({ labId: id(), file: z.instanceof(File) }));

/** One link the team made: a well of the plate and the lab number of one of its samples. */
const wellLink = z.object({
  well: z.string().max(UPLOAD_WELL_MAX),
  labNumber: z.string().max(UPLOAD_LAB_NUMBER_MAX),
});

/** One result the team calculated for a linked sample and a requested test (S4, D9). */
const enteredResult = z.object({
  labNumber: z.string().max(UPLOAD_LAB_NUMBER_MAX),
  testId: id(),
  value: z.string().max(UPLOAD_VALUE_MAX),
});

/** Linking the wells of one upload to the lab's samples, with the team's results (S4). */
export const linkGen5Input = z.object({
  labId: id(),
  uploadId: id(),
  links: z.array(wellLink).max(UPLOAD_LINKS_MAX),
  results: z.array(enteredResult).max(UPLOAD_LINKS_MAX),
});
export type LinkGen5Input = z.output<typeof linkGen5Input>;

/** One upload of one lab. */
export const gen5UploadInput = z.object({ labId: id(), uploadId: id() });
export type Gen5UploadInput = z.output<typeof gen5UploadInput>;
