// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The inputs of the test catalogue (D9, S4, #266): the table state in the URL and the create and
// edit form. Shared by the route, the form and the server functions, so both sides refuse the
// same input. The form is flat; the server reads it as a discriminated source, so a setting that
// does not belong to the chosen source never reaches the service.
import { z } from "zod";
import { m } from "@/i18n/messages";
import { afinionAnalyte, afinionUnitAllowed } from "@/lib/afinion";
import {
  CONTROL_OR_FORMAT,
  EPOCH_CALCULATORS,
  NO_UNIT,
  TEST_MATERIAL_MAX,
  TEST_NAME_MAX,
  TEST_SOURCES,
  TEST_STATUSES,
  type TestSource,
} from "@/lib/catalogue";
import { isUcumCode } from "@/lib/ucum";

/** The columns the catalogue sorts on. */
export const TEST_SORT_FIELDS = ["name", "unit", "material", "updatedAt"] as const;
export type TestSortField = (typeof TEST_SORT_FIELDS)[number];

/** The page sizes the catalogue offers. */
export const TEST_PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_TEST_PAGE_SIZE = 25;

/** The longest search text; longer input is cut in the URL, refused at the server function. */
export const TEST_SEARCH_MAX_LENGTH = 100;

const pageSize = z.coerce
  .number()
  .int()
  .refine((value) => (TEST_PAGE_SIZES as readonly number[]).includes(value));

/** A multi-select filter in the URL: known values only, nothing left means no filter. */
function searchValues<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .preprocess(
      (value) => (typeof value === "string" ? [value] : value),
      z.array(z.unknown()).max(values.length * 2),
    )
    .transform((list) => {
      const known = values.filter((value): value is T[number] => list.includes(value));
      return known.length > 0 ? known : undefined;
    })
    .optional()
    .catch(undefined);
}

/**
 * The catalogue's state in the URL search params. Every key falls back to its default instead of
 * failing, so a hand-edited or old link still opens the list.
 */
export const testListSearchSchema = z.object({
  q: z
    .string()
    .transform((value) => {
      const text = value.trim().slice(0, TEST_SEARCH_MAX_LENGTH);
      return text === "" ? undefined : text;
    })
    .optional()
    .catch(undefined),
  status: searchValues(TEST_STATUSES),
  source: searchValues(TEST_SOURCES),
  sort: z.enum(TEST_SORT_FIELDS).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
  size: pageSize.optional().catch(undefined),
});
export type TestListSearch = z.infer<typeof testListSearchSchema>;

/** The search params that narrow the list: the search text and the facets. */
export const TEST_FILTER_KEYS = ["q", "status", "source"] as const;

function inputValues<const T extends readonly [string, ...string[]]>(values: T) {
  return z.array(z.enum(values)).min(1).max(values.length).optional();
}

/** The input of `listCatalogueTests`: the search params, strictly (a server function is an API). */
export const listTestsInput = z.strictObject({
  q: z.string().max(TEST_SEARCH_MAX_LENGTH).optional(),
  status: inputValues(TEST_STATUSES),
  source: inputValues(TEST_SOURCES),
  sort: z.enum(TEST_SORT_FIELDS).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.number().int().min(1).max(100_000).optional(),
  size: pageSize.optional(),
});
export type ListTestsInput = z.infer<typeof listTestsInput>;

// NOTE: security review of #312 (F6); an id in upper case names the same test.
const testId = z.uuid().transform((value) => value.toLowerCase());

/** The input of the actions about one test: retire and restore. */
export const testIdInput = z.strictObject({ testId });
export type TestIdInput = z.infer<typeof testIdInput>;

const tooLong = (max: number) => () => m.form_too_long({ max: String(max) });

/** Returns the stored unit of a checked form's unit: `null` for the explicit choice of none. */
function unitOf(unit: string): string | null {
  return unit === NO_UNIT ? null : unit;
}

/** Free text without control or format characters (ASVS V2.2.1), trimmed, up to `max`. */
function plainText(max: number) {
  return z
    .string()
    .trim()
    .max(max, { error: tooLong(max) })
    .refine((value) => !CONTROL_OR_FORMAT.test(value), {
      error: () => m.catalogue_text_characters(),
    });
}

function requiredText(max: number, required: () => string) {
  return plainText(max).refine((value) => value !== "", { error: required });
}

const testFormFields = z.object({
  name: requiredText(TEST_NAME_MAX, () => m.catalogue_name_required()),
  // NOTE: maintainer 2026-11-19 (#266); a dimensionless result such as a ratio has no unit.
  // Owner 2026-11-20 (#393): a unit is a UCUM code from the supported list.
  unit: z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (value === "") ctx.addIssue({ code: "custom", message: m.catalogue_unit_required() });
      else if (value !== NO_UNIT && !isUcumCode(value)) {
        ctx.addIssue({ code: "custom", message: m.catalogue_unit_unsupported() });
      }
    }),
  material: requiredText(TEST_MATERIAL_MAX, () => m.catalogue_material_required()),
  source: z
    .enum([...TEST_SOURCES, ""])
    .refine((value) => value !== "", { error: () => m.catalogue_source_required() }),
  // NOTE: #393; checked against the analytes the Afinion 2 reports, for that source only.
  analyte: z.string().trim(),
  calculatedBy: z.enum([...EPOCH_CALCULATORS, ""]),
});
type TestFormValues = z.output<typeof testFormFields>;

/**
 * Checks the setting of the chosen source: an Afinion 2 test names an analyte the analyser
 * reports, with a unit that analyte allows (#393); an Epoch 2 test says who calculates.
 */
function checkSourceSetting(value: TestFormValues, ctx: z.RefinementCtx): void {
  if (value.source === "afinion") checkAfinionSetting(value, ctx);
  if (value.source === "epoch_upload" && value.calculatedBy === "") {
    ctx.addIssue({
      code: "custom",
      path: ["calculatedBy"],
      message: m.catalogue_calculated_by_required(),
    });
  }
}

function checkAfinionSetting(value: TestFormValues, ctx: z.RefinementCtx): void {
  if (value.analyte === "") {
    ctx.addIssue({ code: "custom", path: ["analyte"], message: m.catalogue_analyte_required() });
    return;
  }
  const entry = afinionAnalyte(value.analyte);
  if (entry === undefined) {
    ctx.addIssue({ code: "custom", path: ["analyte"], message: m.catalogue_analyte_unknown() });
    return;
  }
  if (value.unit === "") return;
  if (!afinionUnitAllowed(entry, unitOf(value.unit))) {
    ctx.addIssue({
      code: "custom",
      path: ["unit"],
      message: entry.unitConfigurable
        ? m.catalogue_unit_required_for_analyte()
        : m.catalogue_unit_fixed_by_analyte(),
    });
  }
}

/**
 * The create and edit form of a test (D9): its name, unit and material, where its measurements
 * come from, and the setting of that source. The analyte and the calculator are checked only
 * for the source they belong to.
 */
export const testFormSchema = testFormFields.superRefine(checkSourceSetting);
export type TestForm = z.input<typeof testFormSchema>;

/** One test as the service takes it: the source carries only its own setting. */
export interface TestDefinition {
  name: string;
  /** `null` for a dimensionless result; never an empty string. */
  unit: string | null;
  material: string;
  source: TestSource;
}

/** Returns the source a checked form names, or `null` when its setting is missing. */
function sourceOf(form: TestFormValues): TestSource | null {
  switch (form.source) {
    case "afinion":
      return form.analyte === "" ? null : { kind: "afinion", analyte: form.analyte };
    case "epoch_upload":
      return form.calculatedBy === ""
        ? null
        : { kind: "epoch_upload", calculatedBy: form.calculatedBy };
    case "manual":
      return { kind: "manual" };
    default: {
      const unknown: never = form.source;
      return unknown;
    }
  }
}

/**
 * Returns the definition of a checked form; a setting of another source is dropped, so it is
 * unrepresentable past this point.
 */
export function testDefinitionOf(form: TestFormValues, ctx: z.RefinementCtx): TestDefinition {
  const source = sourceOf(form);
  if (source === null) {
    ctx.addIssue({ code: "custom", path: ["source"], message: m.catalogue_source_required() });
    return z.NEVER;
  }
  const unit = unitOf(form.unit);
  return { name: form.name, unit, material: form.material, source };
}

const strictTestForm = testFormFields.strict().superRefine(checkSourceSetting);

/** The input of `createCatalogueTest`: the form, strictly, read as a definition. */
export const createTestInput = strictTestForm.transform(testDefinitionOf);
export type CreateTestInput = z.input<typeof createTestInput>;

/** The input of `updateCatalogueTest`: the test and its form, read as a definition. */
export const updateTestInput = z.strictObject({
  testId,
  test: strictTestForm.transform(testDefinitionOf),
});
export type UpdateTestInput = z.input<typeof updateTestInput>;
