// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// No response to a student carries a correct value, a limit or a field derived from one (D10,
// Q-SIM-1, R-13). Two halves: every server function a student can reach is named here, so a new
// one fails this test until its response is checked; and the responses of the ones that read a
// simulation are serialised, with the secrets in the database, and searched for them.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { readAdminSimulation, readAdminSimulations } from "../simulations/admin-queries.ts";
import { joinLabWithCode } from "../simulations/join.ts";
import { linkWaitingAddresses } from "../simulations/linking.ts";
import { listStudentLabs } from "../simulations/queries.ts";
import { startSimulation } from "../simulations/state.ts";
import { findStudentLab, findWorkingStudentLab } from "../simulations/student-access.ts";
import { NOW, person, world } from "../simulations/test-helpers.ts";
import { codeOf, context } from "../simulations/test-join.ts";
import { SECRET_RED, SECRET_VALUE, SECRET_YELLOW, seedSecrets } from "./test-helpers.ts";

/** Every file that defines server functions. */
function serverFunctionFiles(): string[] {
  const files: string[] = ["src/lib/session.functions.ts", "src/lib/dev-tools.functions.ts"];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
        if (readFileSync(path, "utf8").includes("createServerFn(")) files.push(path);
      }
    }
  };
  walk("src/server");
  return files.sort();
}

/** The exported server functions whose middleware is not the teacher's or the admin's. */
function reachableByAStudent(): string[] {
  const names: string[] = [];
  for (const file of serverFunctionFiles()) {
    const source = readFileSync(file, "utf8");
    const aliases = [...source.matchAll(/const (\w+) = requireRole\("(teacher|admin)"\);/g)].map(
      (match) => match[1] ?? "",
    );
    for (const match of source.matchAll(
      /export const (\w+) = createServerFn\(([\s\S]*?)\.handler\(/g,
    )) {
      const chain = match[2] ?? "";
      const guarded =
        /requireRole\("(teacher|admin)"\)/.test(chain) ||
        aliases.some((alias) => chain.includes(`.middleware([${alias}])`));
      if (!guarded) names.push(`${file}#${match[1] ?? ""}`);
    }
  }
  return names.sort();
}

/**
 * The server functions a student can reach, each with why its response holds no correct value.
 * A new entry needs a serialisation case below, or a reason it reads no simulation data.
 */
const STUDENT_REACHABLE: Record<string, string> = {
  "src/lib/dev-tools.functions.ts#getDevPagesEnabled": "a flag from NODE_ENV",
  "src/lib/session.functions.ts#getLoginOptions": "the sign-in providers",
  "src/lib/session.functions.ts#getSession": "the session user's own account",
  "src/lib/session.functions.ts#routeInstitutionEmail": "a provider for an address",
  "src/server/dev-forms/functions.ts#checkDemoRubricTitle": "fictional demo data",
  "src/server/dev-forms/functions.ts#submitDemoRubric": "fictional demo data",
  "src/server/dev-forms/functions.ts#submitDemoSession": "fictional demo data",
  "src/server/preferences/functions.ts#saveLastPortal": "the user's own preference",
  "src/server/preferences/functions.ts#savePreferredLocale": "the user's own preference",
  "src/server/simulations/functions.ts#getMyLabs": "serialised below",
  "src/server/simulations/functions.ts#joinLabFn": "serialised below",
  "src/server/simulations/functions.ts#linkMyLabsFn": "serialised below",
};

/** What must never appear in a student's response: the secrets in every written form. */
const NEEDLES = [
  SECRET_VALUE,
  SECRET_VALUE.replace(".", ","),
  "987654",
  SECRET_YELLOW,
  SECRET_RED,
  SECRET_YELLOW.replace(".", ","),
  SECRET_RED.replace(".", ","),
  "correct",
  "limit",
  "yellow",
  "absolute",
];

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

describe("what a student can call (Q-SIM-1)", () => {
  it("is exactly the known list, so a new function is checked before it ships", () => {
    expect(reachableByAStudent()).toEqual(Object.keys(STUDENT_REACHABLE).sort());
  });

  it("never imports the correct-values module into a student-reachable file", () => {
    for (const name of Object.keys(STUDENT_REACHABLE)) {
      const [file = ""] = name.split("#");
      expect(readFileSync(file, "utf8")).not.toMatch(/correct-values/);
    }
  });
});

describe("the responses to a student, serialised (D10, Q-SIM-1, R-13)", () => {
  async function open() {
    const database = await createTestDb();
    db = database;
    const w = await world(database);
    const testId = await seedSecrets(database, w);
    await startSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    return { database, w, testId };
  }

  function expectClean(response: unknown, testId: string): void {
    const text = JSON.stringify(response);
    for (const needle of [...NEEDLES, testId]) expect(text).not.toContain(needle);
  }

  it("carries no secret in the student's labs (getMyLabs)", async () => {
    const { database, w, testId } = await open();
    const labs = await listStudentLabs(database, w.student.id);
    expect(labs).toHaveLength(1);
    expectClean(labs, testId);
  });

  it("carries no secret in a join with the lab's code (joinLabFn)", async () => {
    const { database, w, testId } = await open();
    const code = await codeOf(database, w.teacher, w.labId);
    const joiner = await person(database, "joiner", ["student"]);
    const joined = await joinLabWithCode(database, joiner, { code }, context());
    expect(joined.ok).toBe(true);
    expectClean(joined, testId);
  });

  it("carries no secret in the link of waiting addresses (linkMyLabsFn)", async () => {
    const { database, w, testId } = await open();
    const linked = await linkWaitingAddresses(database, w.stranger.id, NOW);
    expectClean(linked, testId);
  });

  it("carries no secret in the lab predicates every later student read starts from", async () => {
    const { database, w, testId } = await open();
    expectClean(await findStudentLab(database, w.student.id, w.labId), testId);
    expectClean(await findWorkingStudentLab(database, w.student.id, w.labId), testId);
  });

  it("carries no secret in the administrator's read-only view either (B5)", async () => {
    const { database, w, testId } = await open();
    expectClean(await readAdminSimulations(database, w.admin), testId);
    expectClean(await readAdminSimulation(database, w.admin, w.simulationId), testId);
  });
});
