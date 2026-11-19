// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The inputs of the test catalogue (D9, S4, #266): the table state in the URL and the create and
// edit form. Shared by the route, the form and the server functions, so both sides refuse the
// same input. The form is flat; the server reads it as a discriminated source, so a setting that
// does not belong to the chosen source never reaches the service.
import { z } from "zod";
import { m } from "@/i18n/messages";
import {
  EPOCH_CALCULATORS,
  HL7_DELIMITERS,
  TEST_ANALYTE_MAX,
  TEST_MATERIAL_MAX,
  TEST_NAME_MAX,
  TEST_SOURCES,
  TEST_STATUSES,
  TEST_UNIT_MAX,
  type TestSource,
} from "@/lib/catalogue";

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

const testId = z.uuid();

/** The input of the actions about one test: retire and restore. */
export const testIdInput = z.strictObject({ testId });
export type TestIdInput = z.infer<typeof testIdInput>;

const tooLong = (max: number) => () => m.form_too_long({ max: String(max) });

function requiredText(max: number, required: () => string) {
  return z
    .string()
    .trim()
    .min(1, { error: required })
    .max(max, { error: tooLong(max) });
}

const testFormFields = z.object({
  name: requiredText(TEST_NAME_MAX, () => m.catalogue_name_required()),
  unit: requiredText(TEST_UNIT_MAX, () => m.catalogue_unit_required()),
  material: requiredText(TEST_MATERIAL_MAX, () => m.catalogue_material_required()),
  source: z
    .enum([...TEST_SOURCES, ""])
    .refine((value) => value !== "", { error: () => m.catalogue_source_required() }),
  analyte: z
    .string()
    .trim()
    .max(TEST_ANALYTE_MAX, { error: tooLong(TEST_ANALYTE_MAX) }),
  calculatedBy: z.enum([...EPOCH_CALCULATORS, ""]),
});
type TestFormValues = z.output<typeof testFormFields>;

/** Checks the setting of the chosen source: the analyte of an Afinion 2 test, the calculator of an Epoch 2 one. */
function checkSourceSetting(value: TestFormValues, ctx: z.RefinementCtx): void {
  if (value.source === "afinion") {
    if (value.analyte === "") {
      ctx.addIssue({ code: "custom", path: ["analyte"], message: m.catalogue_analyte_required() });
    } else if (HL7_DELIMITERS.test(value.analyte)) {
      ctx.addIssue({
        code: "custom",
        path: ["analyte"],
        message: m.catalogue_analyte_delimiters(),
      });
    }
  }
  if (value.source === "epoch_upload" && value.calculatedBy === "") {
    ctx.addIssue({
      code: "custom",
      path: ["calculatedBy"],
      message: m.catalogue_calculated_by_required(),
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
  unit: string;
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
  return { name: form.name, unit: form.unit, material: form.material, source };
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
