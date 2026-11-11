// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The reads of the analyser register (B3, #35): one page of the table with server-side search,
// facets on status and route, sorting and pagination, and the facet counts. The register holds
// devices only: no person, no measurement.
import "@tanstack/react-start/server-only";
import { type Expression, type ExpressionBuilder, type Kysely, type SqlBool, sql } from "kysely";
import {
  ANALYSER_ROUTES,
  ANALYSER_STATUSES,
  type AnalyserRoute,
  type AnalyserStatus,
  parseAnalyserRoute,
  parseAnalyserStatus,
} from "../../lib/analysers.ts";
import type { DB } from "../db/schema.gen.ts";
import { containsPattern } from "../users/queries.ts";
import {
  type AnalyserSortField,
  DEFAULT_ANALYSER_PAGE_SIZE,
  type ListAnalysersInput,
} from "./schemas.ts";

/** One row of the analyser register. */
export interface AnalyserRow {
  id: string;
  model: string;
  serialNumber: string;
  location: string;
  route: AnalyserRoute;
  status: AnalyserStatus;
  notes: string | null;
  /** ISO instant of the last change. */
  updatedAt: string;
  /** ISO instant; set while the status is `retired`. */
  retiredAt: string | null;
}

/** One page of the analyser register. */
export interface AnalyserPage {
  rows: AnalyserRow[];
  total: number;
  page: number;
  size: number;
}

/** How many analysers each facet value would show. */
export interface AnalyserFacets {
  status: Record<AnalyserStatus, number>;
  route: Record<AnalyserRoute, number>;
}

/** The facets of the register: the filters that offer a list of values with counts. */
export type AnalyserFacet = "status" | "route";

const SORT_COLUMNS = {
  model: "analysers.model",
  serialNumber: "analysers.serial_number",
  location: "analysers.location",
  updatedAt: "analysers.updated_at",
} as const satisfies Record<AnalyserSortField, string>;

type AnalyserExpressions = ExpressionBuilder<DB, "analysers">;

/** Thrown when a stored row holds a value outside the vocabulary the CHECKs allow. */
export class AnalyserRowInvalidError extends Error {
  override readonly name = "AnalyserRowInvalidError";
  readonly kind = "analyser_row_invalid";
}

/** The conditions of the search and every facet in `input`, all but the facet `except`. */
function filterConditions(
  eb: AnalyserExpressions,
  input: ListAnalysersInput,
  except?: AnalyserFacet,
): Expression<SqlBool>[] {
  const conditions: Expression<SqlBool>[] = [];
  const search = input.q?.trim();
  if (search) {
    const pattern = containsPattern(search);
    conditions.push(
      eb.or([
        eb("analysers.model", "ilike", pattern),
        eb("analysers.serial_number", "ilike", pattern),
        eb("analysers.location", "ilike", pattern),
      ]),
    );
  }
  if (input.status && except !== "status") {
    conditions.push(eb("analysers.status", "in", [...input.status]));
  }
  if (input.route && except !== "route") {
    conditions.push(eb("analysers.route", "in", [...input.route]));
  }
  return conditions;
}

/** Maps a stored row to the screen's row, failing loud on a value the CHECKs should refuse. */
export function toAnalyserRow(row: {
  id: string;
  model: string;
  serial_number: string;
  location: string;
  route: string;
  status: string;
  notes: string | null;
  updated_at: Date;
  retired_at: Date | null;
}): AnalyserRow {
  const route = parseAnalyserRoute(row.route);
  const status = parseAnalyserStatus(row.status);
  if (!route || !status) throw new AnalyserRowInvalidError(`analyser ${row.id} is invalid`);
  return {
    id: row.id,
    model: row.model,
    serialNumber: row.serial_number,
    location: row.location,
    route,
    status,
    notes: row.notes,
    updatedAt: row.updated_at.toISOString(),
    retiredAt: row.retired_at?.toISOString() ?? null,
  };
}

const ROW_COLUMNS = [
  "analysers.id",
  "analysers.model",
  "analysers.serial_number",
  "analysers.location",
  "analysers.route",
  "analysers.status",
  "analysers.notes",
  "analysers.updated_at",
  "analysers.retired_at",
] as const;

/**
 * Reads one page of the register: search on model, serial number and location (contains,
 * case-insensitive), the status and route facets (any of the chosen values), one sort column
 * with the id as tie-break, and `limit`/`offset` pagination with the total count.
 */
export async function listAnalysers(
  db: Kysely<DB>,
  input: ListAnalysersInput,
): Promise<AnalyserPage> {
  const size = input.size ?? DEFAULT_ANALYSER_PAGE_SIZE;
  const page = input.page ?? 1;
  const sort = input.sort ?? "model";
  const dir = input.dir ?? "asc";
  const base = db.selectFrom("analysers").where((eb) => eb.and(filterConditions(eb, input)));
  const [rows, count] = await Promise.all([
    base
      .select(ROW_COLUMNS)
      .orderBy(sql.ref(SORT_COLUMNS[sort]), dir)
      .orderBy("analysers.id")
      .limit(size)
      .offset((page - 1) * size)
      .execute(),
    base.select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow(),
  ]);
  return { rows: rows.map(toAnalyserRow), total: Number(count.n), page, size };
}

/**
 * Counts, for every value of both facets, the analysers the list would show with that value
 * chosen: the search and the other facet apply, the facet's own choice does not.
 */
export async function analyserFacets(
  db: Kysely<DB>,
  input: ListAnalysersInput,
): Promise<AnalyserFacets> {
  const row = await db
    .selectFrom("analysers")
    .select((eb) => {
      const count = (facet: AnalyserFacet, value: Expression<SqlBool>, alias: string) =>
        eb.fn
          .countAll<string>()
          .filterWhere(eb.and([...filterConditions(eb, input, facet), value]))
          .as(alias);
      return [
        ...ANALYSER_STATUSES.map((status) =>
          count("status", eb("analysers.status", "=", status), `status:${status}`),
        ),
        ...ANALYSER_ROUTES.map((route) =>
          count("route", eb("analysers.route", "=", route), `route:${route}`),
        ),
      ];
    })
    .executeTakeFirstOrThrow();
  const read = (alias: string) => Number(Reflect.get(row, alias) ?? 0);
  return {
    status: {
      in_use: read("status:in_use"),
      maintenance: read("status:maintenance"),
      retired: read("status:retired"),
    },
    route: {
      hl7_ferrobridge: read("route:hl7_ferrobridge"),
      excel_upload: read("route:excel_upload"),
    },
  };
}
