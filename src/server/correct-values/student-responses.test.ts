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
import { correctPatient, registerPatient } from "../lab-records/patients.ts";
import { listRequestableTests, readLabRecords } from "../lab-records/queries.ts";
import { correctRequest, recordRequest } from "../lab-records/requests.ts";
import { PATIENT } from "../lab-records/test-helpers.ts";
import { recordManualMeasurement } from "../results/measurements.ts";
import { readStudentResults } from "../results/queries.ts";
import { releaseResult } from "../results/release.ts";
import { readAdminSimulation, readAdminSimulationPage } from "../simulations/admin-queries.ts";
import { joinLabWithCode } from "../simulations/join.ts";
import { linkWaitingAddresses } from "../simulations/linking.ts";
import { getCurrentStudentLab } from "../simulations/queries.ts";
import { finishSimulation, startSimulation } from "../simulations/state.ts";
import { findStudentLab, findWorkingStudentLab } from "../simulations/student-access.ts";
import { NOW, person, world } from "../simulations/test-helpers.ts";
import { codeOf, context } from "../simulations/test-join.ts";
import { handWrittenSources } from "../test-source-files.ts";
import { setTolerance } from "../tolerances/actions.ts";
import { readStudentTolerances } from "../tolerances/queries.ts";
import {
  catalogueTest,
  SECRET_RED,
  SECRET_VALUE,
  SECRET_YELLOW,
  seedSecrets,
} from "./test-helpers.ts";

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
  "src/server/dev-forms/functions.ts#checkDemoSampleNumber": "fictional demo data",
  "src/server/dev-forms/functions.ts#submitDemoRequest": "fictional demo data",
  "src/server/dev-forms/functions.ts#submitDemoSession": "fictional demo data",
  "src/server/lab-records/functions.ts#correctPatientFn": "serialised below",
  "src/server/lab-records/functions.ts#correctRequestFn": "serialised below",
  "src/server/lab-records/functions.ts#getLabRecordsFn": "serialised below",
  "src/server/lab-records/functions.ts#getRequestableTestsFn": "serialised below",
  "src/server/lab-records/functions.ts#recordRequestFn": "serialised below",
  "src/server/lab-records/functions.ts#registerPatientFn": "serialised below",
  "src/server/preferences/functions.ts#saveLastPortal": "the user's own preference",
  "src/server/results/functions.ts#getMyResultsFn": "serialised below",
  "src/server/results/functions.ts#recordMeasurementFn": "serialised below",
  "src/server/results/functions.ts#releaseResultFn": "serialised below",
  "src/server/preferences/functions.ts#savePreferredLocale": "the user's own preference",
  "src/server/simulations/functions.ts#getMyLab": "serialised below",
  "src/server/simulations/functions.ts#joinLabFn": "serialised below",
  "src/server/simulations/functions.ts#linkMyLabsFn": "serialised below",
  "src/server/tolerances/functions.ts#getMyTolerancesFn": "serialised below",
  "src/server/tolerances/functions.ts#setToleranceFn": "serialised below",
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

  it("carries no secret in the student's current lab (getMyLab)", async () => {
    const { database, w, testId } = await open();
    const lab = await getCurrentStudentLab(database, w.student.id);
    expect(lab?.labId).toBe(w.labId);
    expectClean(lab, testId);
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

  it("carries no secret in the team's records, written and read (#268)", async () => {
    const { database, w, testId } = await open();
    const patient = await registerPatient(database, w.student, { labId: w.labId, ...PATIENT });
    if (!patient.ok) throw new Error(patient.error);
    const patientId = patient.value.patientId;
    const recorded = await recordRequest(database, w.student, {
      kind: "patient",
      labId: w.labId,
      patientId,
      requester: "Dr. Invented",
      phoneThrough: false,
      remarks: null,
      testIds: [testId],
      // N2 of the #405 review: one entry carries the secret test's own name, so a field derived
      // from a match with the catalogue would carry a secret into the response.
      notOffered: [
        { name: "Glucose (invented)", remark: null },
        { name: "Invented test Q", remark: "on the form" },
      ],
      samples: [{ sampleNumber: "S-001", material: "whole blood" }],
    });
    if (!recorded.ok) throw new Error(recorded.error);
    const patientCorrection = await correctPatient(database, w.student, {
      labId: w.labId,
      patientId,
      ...PATIENT,
      name: "Ada Corrected",
    });
    const requestCorrection = await correctRequest(database, w.student, {
      labId: w.labId,
      requestId: recorded.value.requestId,
      requester: "Dr. Other",
      phoneThrough: true,
      remarks: null,
      testIds: [testId],
      notOffered: [{ name: "Glucose (invented)", remark: "second page" }],
      samples: [{ sampleNumber: "S-002", material: "plasma" }],
    });
    const records = await readLabRecords(database, w.student, w.labId);
    expect(records?.requests[0]?.notOffered).toEqual([
      { name: "Glucose (invented)", remark: "second page" },
    ]);
    const tests = await listRequestableTests(database, w.student);
    // The test's id is the request's own, so these responses are searched for the values only.
    const responses = [patient, recorded, patientCorrection, requestCorrection, records, tests];
    for (const response of responses) {
      const text = JSON.stringify(response);
      for (const needle of NEEDLES) expect(text).not.toContain(needle);
    }
  });

  it("carries no secret in the lab's tolerance page or a set (getMyTolerancesFn, setToleranceFn)", async () => {
    const { database, w, testId } = await open();
    const plain = await catalogueTest(database, "Albumin (invented)");
    const set = await setTolerance(database, w.student, {
      labId: w.labId,
      testId,
      lower: "1",
      upper: "2",
    });
    expect(set).toEqual({ ok: true, value: { changed: true } });
    expectClean(set, testId);
    const page = await readStudentTolerances(database, w.student, w.labId);
    // NOTE: S13; the page lists the whole active catalogue, so the test with a correct value is
    // there by its id like any other, with the same fields and nothing derived from its value.
    const text = JSON.stringify(page);
    for (const needle of NEEDLES) expect(text).not.toContain(needle);
    const [secret, other] = [testId, plain].map((id) =>
      Object.keys(page?.tests.find((test) => test.testId === id) ?? {}).sort(),
    );
    expect(secret).toEqual(other);
    expect(secret).toEqual(["lower", "name", "setAt", "testId", "unit", "upper"]);
  });

  it("gives the same refusals of a set whether or not the test has a correct value (review of #352)", async () => {
    const { database, w, testId } = await open();
    const plain = await catalogueTest(database, "Albumin (invented)");
    const both = async (actor: typeof w.student, labId: string) => {
      const answers = [];
      for (const id of [testId, plain]) {
        answers.push(
          await setTolerance(database, actor, { labId, testId: id, lower: "1", upper: "2" }),
        );
      }
      for (const answer of answers) expectClean(answer, testId);
      expect(answers[0]).toEqual(answers[1]);
      return answers[0];
    };
    expect(await both(w.otherLabStudent, w.labId)).toEqual({ ok: false, error: "not_found" });
    const unknown = await setTolerance(database, w.student, {
      labId: w.labId,
      testId: "01960000-0000-7000-8000-00000000dead",
      lower: "1",
      upper: "2",
    });
    expect(unknown).toEqual({ ok: false, error: "test_not_found" });
    expectClean(unknown, testId);
    // Test set-up: both tests retired, neither with a tolerance in the lab yet.
    await database
      .updateTable("catalogue_tests")
      .set({ retired_at: NOW })
      .where("id", "in", [testId, plain])
      .execute();
    expect(await both(w.student, w.labId)).toEqual({ ok: false, error: "test_retired" });
    await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    expect(await both(w.student, w.labId)).toEqual({ ok: false, error: "not_running" });
  });

  it("carries no secret in a measurement, a release or the results page (#270)", async () => {
    const { database, w, testId } = await open();
    const patient = await registerPatient(database, w.student, { labId: w.labId, ...PATIENT });
    if (!patient.ok) throw new Error(patient.error);
    // The EHR FerroEHR would have given the patient; a release needs it (#148, #364).
    await database
      .updateTable("patients")
      .set({ ehr_id: "01a1f79f-e2d0-77ea-8eac-fe74ff33c1a2" })
      .where("id", "=", patient.value.patientId)
      .execute();
    const recorded = await recordRequest(database, w.student, {
      kind: "patient",
      labId: w.labId,
      patientId: patient.value.patientId,
      requester: "Dr. Invented",
      phoneThrough: false,
      remarks: null,
      testIds: [testId],
      // N2 of the #405 review: one entry carries the secret test's own name, so a field derived
      // from a match with the catalogue would carry a secret into the response.
      notOffered: [
        { name: "Glucose (invented)", remark: null },
        { name: "Invented test Q", remark: "on the form" },
      ],
      samples: [{ sampleNumber: "S-001", material: "whole blood" }],
    });
    if (!recorded.ok) throw new Error(recorded.error);
    await setTolerance(database, w.student, { labId: w.labId, testId, lower: "1", upper: "2" });
    const tolerance = await database
      .selectFrom("lab_tolerances")
      .select("id")
      .where("lab_id", "=", w.labId)
      .executeTakeFirstOrThrow();
    const measured = await recordManualMeasurement(database, w.student, {
      labId: w.labId,
      requestId: recorded.value.requestId,
      testId,
      sampleId: recorded.value.samples[0]?.id ?? "",
      value: "1.5",
    });
    if (!measured.ok) throw new Error(measured.error);
    const released = await releaseResult(database, w.student, {
      labId: w.labId,
      requestId: recorded.value.requestId,
      testId,
      measurementId: measured.value.measurementId,
      toleranceId: tolerance.id,
    });
    expect(released.ok).toBe(true);
    const page = await readStudentResults(database, w.student, w.labId);
    // The test's id is the request's own, so these responses are searched for the values only.
    for (const response of [measured, released, page]) {
      const text = JSON.stringify(response);
      for (const needle of NEEDLES) expect(text).not.toContain(needle);
    }
  });

  it("carries no secret in the administrator's read-only view either (B5)", async () => {
    const { database, w, testId } = await open();
    expectClean(await readAdminSimulationPage(database, w.admin, {}), testId);
    expectClean(await readAdminSimulation(database, w.admin, w.simulationId), testId);
  });
});
