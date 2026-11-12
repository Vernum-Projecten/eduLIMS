// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The FerroEHR answers the client reads, validated at the trust boundary. Each schema follows
// the ITS-REST 1.1.0 schema it names (`specifications/schemas/`).
import "@tanstack/react-start/server-only";
import { z } from "zod";

/**
 * The conformance manifest of the System API `OPTIONS` (ITS-REST 1.1.0,
 * `schemas/others/Options.yaml`): every member is optional there.
 */
export const conformanceManifest = z.object({
  solution: z.string().optional(),
  solution_version: z.string().optional(),
  vendor: z.string().optional(),
  restapi_specs_version: z.string().optional(),
  conformance_profile: z.string().optional(),
  endpoints: z.array(z.string()).optional(),
});
export type ConformanceManifest = z.infer<typeof conformanceManifest>;

/** One entry of the template list (ITS-REST 1.1.0, `schemas/definition/TemplateMetadata.yaml`). */
export const templateMetadata = z.object({
  template_id: z.string().min(1),
  concept: z.string(),
  archetype_id: z.string(),
  created_timestamp: z.string(),
});
export type TemplateMetadata = z.infer<typeof templateMetadata>;

/** The template list (ITS-REST 1.1.0, `schemas/definition/TemplateList.yaml`). */
export const templateList = z.array(templateMetadata);

/**
 * The WebTemplate (ITS-REST 1.1.0, `schemas/web_template/WebTemplate.yaml`): its required
 * members are checked, and the rest of the document is kept as it came.
 */
export const webTemplate = z.looseObject({
  templateId: z.string().min(1),
  version: z.string(),
  defaultLanguage: z.string(),
  languages: z.array(z.string()),
  tree: z.looseObject({}),
});
export type WebTemplate = z.infer<typeof webTemplate>;
