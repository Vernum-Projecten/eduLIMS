// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The tests a team recorded as not offered (#398), as the dashboard reads them (#271): per
// request the names as written, and per lab the count. eduLIMS does not record them yet, so the
// one source answers `null` and the dashboard shows no column for them.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import type { DB } from "../db/schema.gen.ts";

/** The tests not offered of a simulation's labs. */
export interface NotOffered {
  /** Per request id, the names as the team wrote them. */
  byRequest: ReadonlyMap<string, readonly string[]>;
  /** Per lab id, how many the team recorded. */
  byLab: ReadonlyMap<string, number>;
}

/** Reads the tests not offered of a simulation, or `null` while eduLIMS records none. */
export type NotOfferedSource = (db: Kysely<DB>, simulationId: string) => Promise<NotOffered | null>;

/** The source while eduLIMS records no test not offered. */
// TODO(#398): read the tests not offered of the simulation's requests once they are stored.
export const notOfferedNone: NotOfferedSource = () => Promise.resolve(null);
