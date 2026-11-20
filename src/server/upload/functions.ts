// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions of a lab's Gen5 uploads (S4, S10, #156); bodies run on the server. Each
// requires the app role student first, then parses its input with Zod; the service checks the
// student's own place in the lab in SQL. No function here selects a correct value, an accuracy
// limit or an accuracy status (Q-SIM-1).
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "../db/index.ts";
import { requireRole } from "../middleware.ts";
import { linkGen5Upload } from "./linking.ts";
import { gen5UploadInput, linkGen5Input, uploadGen5Input } from "./schemas.ts";
import { readGen5Upload, storeGen5Upload } from "./uploads.ts";

const student = requireRole("student");

/**
 * Stores a Gen5 export for the student's own lab and returns its plate (S4). The request body is
 * capped before Start reads it (`GEN5_FORM_BODY_MAX`, src/start.ts).
 */
export const uploadGen5Fn = createServerFn({ method: "POST" })
  .middleware([student])
  .validator(uploadGen5Input)
  .handler(async ({ data, context }) => {
    const bytes = new Uint8Array(await data.file.arrayBuffer());
    return storeGen5Upload(getDb(), context.user, {
      labId: data.labId,
      fileName: data.file.name,
      bytes,
    });
  });

/** Links an upload's wells to the lab's samples with the team's results (S4, S14). */
export const linkGen5UploadFn = createServerFn({ method: "POST" })
  .middleware([student])
  .validator(linkGen5Input)
  .handler(({ data, context }) => linkGen5Upload(getDb(), context.user, data));

/** Returns one upload of the student's own lab with its wells and measurements (S4, S10). */
export const getGen5UploadFn = createServerFn({ method: "GET" })
  .middleware([student])
  .validator(gen5UploadInput)
  .handler(({ data, context }) => readGen5Upload(getDb(), context.user, data));
