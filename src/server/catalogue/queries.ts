// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The reads of the test catalogue (D9, #266): one page of the table with server-side search,
// facets on status and source, sorting and pagination, and the facet counts. The catalogue is
// shared by every teacher, so no row is filtered by its creator; it holds no correct value.
import "@tanstack/react-start/server-only";
import { type Expression, type ExpressionBuilder, type Kysely, type SqlBool, sql } from "kysely";
import {
  type CatalogueTestId,
  parseCatalogueTestId,
  parseEpochCalculator,
  parseTestSourceKind,
  TEST_SOURCES,
  TEST_STATUSES,
  type TestSource,
  type TestSourceKind,
  type TestStatus,
} from "../../lib/catalogue.ts";
import type { DB } from "../db/schema.gen.ts";
import { containsPattern } from "../users/queries.ts";
import { DEFAULT_TEST_PAGE_SIZE, type ListTestsInput, type TestSortField } from "./schemas.ts";

/** One row of the catalogue as the Teacher portal shows it. */
export interface CatalogueTestRow {
  id: CatalogueTestId;
  name: string;
  unit: string;
  material: string;
  source: TestSource;
  status: TestStatus;
  /** ISO instant of the last change. */
  updatedAt: string;
  /** Whether a simulation uses the test, so its unit and source are fixed (D9). */
  inUse: boolean;
}

/** One page of the catalogue. */
export interface CatalogueTestPage {
  rows: CatalogueTestRow[];
  total: number;
  page: number;
  size: number;
}

/** How many tests each facet value would show. */
export interface CatalogueTestFacets {
  status: Record<TestStatus, number>;
  source: Record<TestSourceKind, number>;
}

/** The facets of the catalogue: the filters that offer a list of values with counts. */
export type CatalogueTestFacet = "status" | "source";

const SORT_COLUMNS = {
  name: "catalogue_tests.name",
  unit: "catalogue_tests.unit",
  material: "catalogue_tests.material",
  updatedAt: "catalogue_tests.updated_at",
} as const satisfies Record<TestSortField, string>;

type TestExpressions = ExpressionBuilder<DB, "catalogue_tests">;

/** Thrown when a stored row holds a value outside the vocabulary the CHECKs allow. */
export class CatalogueTestRowInvalidError extends Error {
  override readonly name = "CatalogueTestRowInvalidError";
  readonly kind = "catalogue_test_row_invalid";
}

function statusCondition(eb: TestExpressions, status: TestStatus): Expression<SqlBool> {
  return status === "retired"
    ? eb("catalogue_tests.retired_at", "is not", null)
    : eb("catalogue_tests.retired_at", "is", null);
}

/** The conditions of the search and every facet in `input`, all but the facet `except`. */
function filterConditions(
  eb: TestExpressions,
  input: ListTestsInput,
  except?: CatalogueTestFacet,
): Expression<SqlBool>[] {
  const conditions: Expression<SqlBool>[] = [];
  const search = input.q?.trim();
  if (search) {
    const pattern = containsPattern(search);
    conditions.push(
      eb.or([
        eb("catalogue_tests.name", "ilike", pattern),
        eb("catalogue_tests.unit", "ilike", pattern),
        eb("catalogue_tests.material", "ilike", pattern),
        eb("catalogue_tests.afinion_analyte", "ilike", pattern),
      ]),
    );
  }
  if (input.status && except !== "status") {
    conditions.push(eb.or(input.status.map((status) => statusCondition(eb, status))));
  }
  if (input.source && except !== "source") {
    conditions.push(eb("catalogue_tests.source", "in", [...input.source]));
  }
  return conditions;
}

/** The stored columns of one test, as {@link toCatalogueTestRow} reads them. */
export interface StoredTest {
  id: string;
  name: string;
  unit: string;
  material: string;
  source: string;
  afinion_analyte: string | null;
  epoch_calculated_by: string | null;
  updated_at: Date;
  retired_at: Date | null;
}

/** The columns {@link StoredTest} names, for a select. */
export const STORED_TEST_COLUMNS = [
  "catalogue_tests.id",
  "catalogue_tests.name",
  "catalogue_tests.unit",
  "catalogue_tests.material",
  "catalogue_tests.source",
  "catalogue_tests.afinion_analyte",
  "catalogue_tests.epoch_calculated_by",
  "catalogue_tests.updated_at",
  "catalogue_tests.retired_at",
] as const;

/**
 * Returns the source of a stored test, failing loud on a combination the CHECKs should refuse.
 *
 * @throws CatalogueTestRowInvalidError on an unknown source or a missing setting.
 */
export function storedSource(row: StoredTest): TestSource {
  const kind = parseTestSourceKind(row.source);
  if (kind === "afinion" && row.afinion_analyte !== null) {
    return { kind, analyte: row.afinion_analyte };
  }
  const calculatedBy = parseEpochCalculator(row.epoch_calculated_by);
  if (kind === "epoch_upload" && calculatedBy) return { kind, calculatedBy };
  if (kind === "manual") return { kind };
  throw new CatalogueTestRowInvalidError(`catalogue test ${row.id} is invalid`);
}

/**
 * Maps a stored row to the screen's row.
 *
 * @throws CatalogueTestRowInvalidError on a value the CHECKs should refuse.
 */
export function toCatalogueTestRow(row: StoredTest, inUse: boolean): CatalogueTestRow {
  const id = parseCatalogueTestId(row.id);
  if (id === null) throw new CatalogueTestRowInvalidError(`catalogue test ${row.id} is invalid`);
  return {
    id,
    name: row.name,
    unit: row.unit,
    material: row.material,
    source: storedSource(row),
    status: row.retired_at === null ? "active" : "retired",
    updatedAt: row.updated_at.toISOString(),
    inUse,
  };
}

/**
 * Reads one page of the catalogue: search on name, unit, material and analyte (contains,
 * case-insensitive), the status and source facets (any of the chosen values), one sort column
 * with the id as tie-break, and `limit`/`offset` pagination with the total count.
 */
export async function listTests(
  db: Kysely<DB>,
  input: ListTestsInput,
  inUse: (ids: readonly CatalogueTestId[]) => Promise<ReadonlySet<CatalogueTestId>>,
): Promise<CatalogueTestPage> {
  const size = input.size ?? DEFAULT_TEST_PAGE_SIZE;
  const page = input.page ?? 1;
  const sort = input.sort ?? "name";
  const dir = input.dir ?? "asc";
  const base = db.selectFrom("catalogue_tests").where((eb) => eb.and(filterConditions(eb, input)));
  const [rows, count] = await Promise.all([
    base
      .select(STORED_TEST_COLUMNS)
      .orderBy(sql.ref(SORT_COLUMNS[sort]), dir)
      .orderBy("catalogue_tests.id")
      .limit(size)
      .offset((page - 1) * size)
      .execute(),
    base.select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow(),
  ]);
  const ids = rows.flatMap((row) => parseCatalogueTestId(row.id) ?? []);
  const used = await inUse(ids);
  return {
    rows: rows.map((row) => {
      const id = parseCatalogueTestId(row.id);
      return toCatalogueTestRow(row, id !== null && used.has(id));
    }),
    total: Number(count.n),
    page,
    size,
  };
}

/**
 * Counts, for every value of both facets, the tests the list would show with that value chosen:
 * the search and the other facet apply, the facet's own choice does not.
 */
export async function testFacets(
  db: Kysely<DB>,
  input: ListTestsInput,
): Promise<CatalogueTestFacets> {
  const row = await db
    .selectFrom("catalogue_tests")
    .select((eb) => {
      const count = (facet: CatalogueTestFacet, value: Expression<SqlBool>, alias: string) =>
        eb.fn
          .countAll<string>()
          .filterWhere(eb.and([...filterConditions(eb, input, facet), value]))
          .as(alias);
      return [
        ...TEST_STATUSES.map((status) =>
          count("status", statusCondition(eb, status), `status:${status}`),
        ),
        ...TEST_SOURCES.map((source) =>
          count("source", eb("catalogue_tests.source", "=", source), `source:${source}`),
        ),
      ];
    })
    .executeTakeFirstOrThrow();
  const read = (alias: string) => Number(Reflect.get(row, alias) ?? 0);
  return {
    status: { active: read("status:active"), retired: read("status:retired") },
    source: {
      afinion: read("source:afinion"),
      epoch_upload: read("source:epoch_upload"),
      manual: read("source:manual"),
    },
  };
}
