// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Stub server functions of the development page `/dev/forms` (#61); bodies run on the server.
// They validate with the shared schemas and answer with fictional data, read nothing, write
// nothing and need no session. Outside development and test they answer 404, as the page does
// (OWASP ASVS 5.0 V13.4: no debug functionality in production).
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { devPagesEnabled } from "../dev-tools.ts";
import { isTakenDemoTitle, reviewDemoRubric, reviewDemoSession } from "./demo.ts";
import { demoRubricSchema, demoSessionSchema, demoTitleInput } from "./schemas.ts";

// NOTE: no requirement governs this: our own design, so the "Checking…" state can be seen.
const CHECK_DELAY_MS = 300;

function requireDevPages(): void {
  if (!devPagesEnabled(process.env)) throw notFound();
}

/** Returns whether a rubric title is still free among the fictional rubrics. */
export const checkDemoRubricTitle = createServerFn({ method: "GET" })
  .validator(demoTitleInput)
  .handler(async ({ data }) => {
    requireDevPages();
    await new Promise((resolve) => setTimeout(resolve, CHECK_DELAY_MS));
    return { available: !isTakenDemoTitle(data.title) };
  });

/** Validates a rubric and refuses a taken title at its field; saves nothing. */
export const submitDemoRubric = createServerFn({ method: "POST" })
  .validator(demoRubricSchema)
  .handler(({ data }) => {
    requireDevPages();
    return reviewDemoRubric(data);
  });

/** Validates a session form and refuses it as a whole when asked to; saves nothing. */
export const submitDemoSession = createServerFn({ method: "POST" })
  .validator(demoSessionSchema)
  .handler(({ data }) => {
    requireDevPages();
    return reviewDemoSession(data);
  });
