// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Stub server functions of the development page `/dev/forms` (#61); bodies run on the server.
// They validate with the shared schemas and answer with fictional data, read nothing, write
// nothing and need no session. Outside development and test they answer 404, as the page does
// (OWASP ASVS 5.0 V13.4: no debug functionality in production).
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { devPagesEnabled } from "../dev-tools.ts";
import { isTakenDemoSampleNumber, reviewDemoRequest, reviewDemoSession } from "./demo.ts";
import { demoRequestSchema, demoSampleNumberInput, demoSessionSchema } from "./schemas.ts";

// NOTE: no requirement governs this: our own design, so the "Checking…" state can be seen.
const CHECK_DELAY_MS = 300;

function requireDevPages(): void {
  if (!devPagesEnabled(process.env)) throw notFound();
}

/** Returns whether a sample number is still free among the fictional requests. */
export const checkDemoSampleNumber = createServerFn({ method: "GET" })
  .validator(demoSampleNumberInput)
  .handler(async ({ data }) => {
    requireDevPages();
    await new Promise((resolve) => setTimeout(resolve, CHECK_DELAY_MS));
    return { available: !isTakenDemoSampleNumber(data.sampleNumber) };
  });

/** Validates a request and refuses a taken sample number at its field; saves nothing. */
export const submitDemoRequest = createServerFn({ method: "POST" })
  .validator(demoRequestSchema)
  .handler(({ data }) => {
    requireDevPages();
    return reviewDemoRequest(data);
  });

/** Validates a session form and refuses it as a whole when asked to; saves nothing. */
export const submitDemoSession = createServerFn({ method: "POST" })
  .validator(demoSessionSchema)
  .handler(({ data }) => {
    requireDevPages();
    return reviewDemoSession(data);
  });
