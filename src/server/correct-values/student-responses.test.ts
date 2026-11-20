// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// No response to a student carries a correct value, a limit or a field derived from one (D10,
// Q-SIM-1, R-13). Two halves: every server function a student can reach is named here, so a new
// one fails this test until its response is checked; and the responses of the ones that read a
// simulation are serialised, with the secrets in the database, and searched for them.
import { readFileSync } from "node:fs";
import { sep } from "node:path";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { readAdminSimulation, readAdminSimulationPage } from "../simulations/admin-queries.ts";
import { joinLabWithCode } from "../simulations/join.ts";
import { linkWaitingAddresses } from "../simulations/linking.ts";
import { listStudentLabs } from "../simulations/queries.ts";
import { startSimulation } from "../simulations/state.ts";
import { findStudentLab, findWorkingStudentLab } from "../simulations/student-access.ts";
import { NOW, person, world } from "../simulations/test-helpers.ts";
import { codeOf, context } from "../simulations/test-join.ts";
import { handWrittenSources } from "../test-source-files.ts";
import { SECRET_RED, SECRET_VALUE, SECRET_YELLOW, seedSecrets } from "./test-helpers.ts";

/** A call of `createServerFn(` in code, wherever it stands. */
const CALL = /\bcreateServerFn\(/g;
/** A server function bound to a name, exported or not, up to its handler. */
const CHAIN = /(?:export\s+)?const\s+(\w+)\s*=\s*createServerFn\(([\s\S]*?)\.handler\(/g;

/** What the scanner found in one source: the unguarded names, and every call it could not place. */
interface ScanResult {
  unguarded: string[];
  calls: number;
  placed: number;
}

/**
 * Returns the server functions of `source` whose middleware is not the teacher's or the admin's,
 * by the name of the `const` they are bound to, exported directly or not. `calls` counts every
 * `createServerFn(` and `placed` those bound to a name, so a shape the scanner does not know
 * (an inline call, a call passed as an argument) shows as a difference instead of a gap.
 */
function scanSource(source: string): ScanResult {
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  const aliases = [...code.matchAll(/const (\w+) = requireRole\("(teacher|admin)"\);/g)].map(
    (match) => match[1] ?? "",
  );
  const unguarded: string[] = [];
  let placed = 0;
  for (const match of code.matchAll(CHAIN)) {
    placed += 1;
    const chain = match[2] ?? "";
    const guarded =
      /requireRole\("(teacher|admin)"\)/.test(chain) ||
      aliases.some((alias) => chain.includes(`.middleware([${alias}])`));
    if (!guarded) unguarded.push(match[1] ?? "");
  }
  return { unguarded, calls: [...code.matchAll(CALL)].length, placed };
}

/** Every unguarded server function under src/, as `file#name`, and the files with stray calls. */
async function reachableByAStudent(): Promise<{ names: string[]; stray: string[] }> {
  const names: string[] = [];
  const stray: string[] = [];
  const sources = await handWrittenSources("src");
  for (const [file, source] of sources) {
    if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
    const scan = scanSource(source);
    if (scan.calls !== scan.placed) stray.push(file);
    for (const name of scan.unguarded) names.push(`${file.split(sep).join("/")}#${name}`);
  }
  return { names: names.sort(), stray };
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

describe("the scanner of server functions (#341 review, N2)", () => {
  it("finds an exported function and one exported later under its name", () => {
    const source = [
      'const teacher = requireRole("teacher");',
      'export const open = createServerFn({ method: "GET" }).handler(() => 1);',
      'const hidden = createServerFn({ method: "POST" })',
      "  .middleware([authMiddleware])",
      "  .handler(() => 2);",
      "export { hidden };",
      'export const guarded = createServerFn({ method: "GET" }).middleware([teacher]).handler(() => 3);',
    ].join("\n");
    expect(scanSource(source)).toEqual({ unguarded: ["open", "hidden"], calls: 3, placed: 3 });
  });

  it("counts a call it cannot place, so a new shape fails the list test", () => {
    const source = "export default { fn: createServerFn().handler(() => 1) };";
    expect(scanSource(source)).toEqual({ unguarded: [], calls: 1, placed: 0 });
  });

  it("ignores a mention in a comment", () => {
    expect(scanSource("// attach to every createServerFn( call\n").calls).toBe(0);
  });
});

describe("what a student can call (Q-SIM-1)", () => {
  it("is exactly the known list, so a new function is checked before it ships", async () => {
    const { names, stray } = await reachableByAStudent();
    expect(stray).toEqual([]);
    expect(names).toEqual(Object.keys(STUDENT_REACHABLE).sort());
  }, 60_000);

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
    expectClean(await readAdminSimulationPage(database, w.admin, {}), testId);
    expectClean(await readAdminSimulation(database, w.admin, w.simulationId), testId);
  });
});
