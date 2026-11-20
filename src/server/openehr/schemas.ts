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

/**
 * The EHR summary of the EHR API (ITS-REST 1.1.0, `schemas/ehr/EHR.yaml`): eduLIMS reads the
 * `ehr_id` and keeps the rest as it came.
 */
export const ehrSummary = z.looseObject({
  ehr_id: z.looseObject({ value: z.uuid() }),
});
export type EhrSummary = z.infer<typeof ehrSummary>;

/**
 * An `OBJECT_VERSION_ID` in its text form, `<object id>::<creating system id>::<version>`
 * (RM base 1.1.0, `OBJECT_VERSION_ID`); eduLIMS reads the object id as a UUID.
 */
export const OBJECT_VERSION_ID =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})::([^:\s]{1,255})::([1-9][0-9]{0,8})$/i;

/**
 * A committed CONTRIBUTION (ITS-REST 1.1.0, `schemas/common/Contribution.yaml`): its `uid` and
 * the version ids it holds; the rest is kept as it came.
 */
export const contribution = z.looseObject({
  uid: z.looseObject({ value: z.uuid() }),
  versions: z
    .array(z.looseObject({ id: z.looseObject({ value: z.string().regex(OBJECT_VERSION_ID) }) }))
    .min(1),
});
export type Contribution = z.infer<typeof contribution>;

/**
 * A COMPOSITION in the canonical JSON (ITS-REST 1.1.0, `schemas/ehr/Composition.yaml`): its type
 * and template are checked, and the rest of the document is kept as it came.
 */
export const compositionDocument = z.looseObject({
  _type: z.literal("COMPOSITION"),
  archetype_details: z.looseObject({
    template_id: z.looseObject({ value: z.string().min(1) }),
  }),
});
export type CompositionDocument = z.infer<typeof compositionDocument>;
