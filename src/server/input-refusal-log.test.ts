// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The log line of input a server function refuses at validation (ASVS 5.0 V16.3.3, #304): Start's
// own refusal is recognised and nothing else is, the line names the function, the paths and codes
// and the user, never the value, and the caller gets the same error. The chain test runs Start's
// own `executeMiddleware` with the app's global function middleware, as a request does.
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { sep } from "node:path";
import { notFound } from "@tanstack/react-router";
import { createMiddleware, executeMiddleware, execValidator } from "@tanstack/react-start";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/** The headers of the current request; new in each case, so no case sees another's user. */
let headers = new Headers();
const getSession = vi.fn();
vi.mock("./auth.ts", () => ({
  getAuth: () => ({ api: { getSession }, $context: Promise.resolve({}) }),
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHeaders: () => headers }));

const { REFUSAL_ISSUES_MAX, issueCodes, logInputRefusal, noteRequestActor, validationIssues } =
  await import("./input-refusal-log.ts");
const { AuthError, inputRefusalLogMiddleware, requireRole } = await import("./middleware.ts");
const { setSecurityLogWriter } = await import("./security-log.ts");
const { labIdInput, emailListInput } = await import("./simulations/schemas.ts");
const { LOGO_FORM_FIELDS, uploadLogoInput } = await import("./simulations/logo-schemas.ts");

let lines: string[] = [];
let restore: (() => void) | undefined;

beforeEach(() => {
  getSession.mockReset();
  headers = new Headers({ "x-request-id": "req-304" });
  lines = [];
  restore = setSecurityLogWriter((line) => lines.push(line));
});

afterEach(() => {
  restore?.();
});

function logged(): unknown[] {
  return lines.map((line): unknown => JSON.parse(line));
}

/** Returns what Start's own validator step throws for `input`. */
async function refusal(schema: z.ZodType, input: unknown): Promise<unknown> {
  return execValidator(schema, input).then(
    () => {
      throw new Error("the input passed");
    },
    (error: unknown) => error,
  );
}

const teacherSession = {
  session: { token: "secret-token", createdAt: new Date() },
  user: { id: "u-teacher", name: "Test Teacher", email: "teacher@example.test", role: "teacher" },
};

describe("validationIssues", () => {
  it("reads the paths and codes of Start's refusal of a malformed lab id", async () => {
    const error = await refusal(labIdInput, { labId: "jan@example.test" });
    expect(validationIssues(error)).toEqual([{ path: ["labId"], code: "invalid_format" }]);
  });

  it("reads an array index and a nested key as path segments", async () => {
    const schema = z.object({ rows: z.array(z.object({ value: z.number() })) });
    const error = await refusal(schema, { rows: [{ value: 1 }, { value: "x" }] });
    expect(validationIssues(error)).toEqual([
      { path: ["rows", "1", "value"], code: "invalid_type" },
    ]);
  });

  it("replaces a path segment or code that is not a key or a Zod code", () => {
    const issues = [
      { message: "m", path: ["Jan Jansen", { key: "ok_key" }, { key: 7 }, null], code: "Bad Code" },
    ];
    expect(validationIssues(new Error(JSON.stringify(issues)))).toEqual([
      { path: ["unknown", "ok_key", "7", "unknown"], code: "unknown" },
    ]);
  });

  it("takes an issue without a path or code as a refusal of the whole input", () => {
    expect(validationIssues(new Error(JSON.stringify([{ message: "m" }])))).toEqual([
      { path: [], code: "unknown" },
    ]);
  });

  it.each([
    ["an AuthError", new AuthError(403)],
    ["a plain error", new Error("Forbidden")],
    ["a TypeError with a JSON issue list", new TypeError('[{"message":"m"}]')],
    ["an error with a JSON object", new Error('{"message":"m"}')],
    ["an error with an empty JSON list", new Error("[]")],
    ["an error with a list of non-issues", new Error('[{"path":["a"]}]')],
    ["a notFound", notFound()],
    ["a string", "[]"],
  ])("does not take %s for a refusal", (_name, error) => {
    expect(validationIssues(error)).toBeNull();
  });
});

describe("issueCodes", () => {
  it("writes each issue as path:code, the whole input as :code", () => {
    expect(
      issueCodes([
        { path: ["emails", "3"], code: "too_big" },
        { path: [], code: "invalid_type" },
      ]),
    ).toEqual(["emails.3:too_big", ":invalid_type"]);
  });

  it(`names at most ${REFUSAL_ISSUES_MAX} issues`, () => {
    const issues = Array.from({ length: 50 }, (_, i) => ({ path: [String(i)], code: "custom" }));
    expect(issueCodes(issues)).toHaveLength(REFUSAL_ISSUES_MAX);
  });
});

describe("logInputRefusal", () => {
  it("logs the user the session middleware noted for the request", () => {
    const own = new Headers();
    noteRequestActor(own, "u-1");
    logInputRefusal(own, "getLabPage", [{ path: ["labId"], code: "invalid_format" }]);
    expect(logged()).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "input_validation_fail",
        outcome: "refused",
        reason: "invalid_input",
        actor_type: "user",
        actor_id: "u-1",
        server_fn: "getLabPage",
        issues: ["labId:invalid_format"],
        refused_count: 1,
      }),
    ]);
  });

  it("logs a request no session middleware ran for as anonymous", () => {
    logInputRefusal(new Headers(), "routeInstitutionEmail", [{ path: ["email"], code: "custom" }]);
    expect(logged()).toEqual([
      expect.not.objectContaining({ actor_id: expect.anything() as unknown }),
    ]);
    expect(logged()).toEqual([expect.objectContaining({ actor_type: "anonymous" })]);
  });

  it("counts every issue while it names the first ones", () => {
    const issues = Array.from({ length: 501 }, (_, i) => ({
      path: ["emails", String(i)],
      code: "invalid_format",
    }));
    logInputRefusal(new Headers(), "addEmailsFn", issues);
    expect(logged()).toEqual([
      expect.objectContaining({
        refused_count: 501,
        issues: issueCodes(issues),
      }),
    ]);
  });
});

/** The AsyncLocalStorage Start keeps its request context in (`@tanstack/start-storage-context`). */
function startStorage(): AsyncLocalStorage<object> {
  const storage: unknown = Reflect.get(
    globalThis,
    Symbol.for("tanstack-start:start-storage-context"),
  );
  if (!(storage instanceof AsyncLocalStorage)) throw new Error("no Start storage context");
  return storage;
}

/** The last step of a server function as Start builds it: its validator, then its handler. */
function handlerStep(schema: z.ZodType) {
  return createMiddleware({ type: "function" })
    .validator(schema)
    .server(({ next }) => next());
}

/** Start's request context with the app's global function middleware. */
function startContext() {
  return {
    request: new Request("http://edulims.test/_serverFn/x", { headers }),
    startOptions: { functionMiddleware: [inputRefusalLogMiddleware] },
    contextAfterGlobalMiddlewares: {},
    handlerType: "serverFn",
  };
}

/**
 * Runs a server function's chain the way Start runs a call on the server: the app's global
 * function middleware, then the function's own middleware, then its validator.
 */
async function callChain(schema: z.ZodType, data: unknown, name = "getLabPage") {
  const context = startContext();
  // NOTE: a call on the server carries the full ServerFnMeta; Start's option type names the id only.
  const serverFnMeta = { id: "fn-id", name, filename: "src/server/simulations/functions.ts" };
  return startStorage().run(context, () =>
    executeMiddleware([requireRole("teacher"), handlerStep(schema)], "server", {
      method: "GET",
      data,
      serverFnMeta,
    }),
  );
}

describe("a server function that refuses its input (ASVS V16.3.3, #304)", () => {
  it("getLabPage validates with labIdInput behind the teacher role", () => {
    const source = readFileSync("src/server/simulations/functions.ts", "utf8");
    expect(source).toMatch(
      /export const getLabPage = createServerFn\(\{ method: "GET" \}\)\s*\.middleware\(\[teacher\]\)\s*\.validator\(labIdInput\)/,
    );
  });

  it("writes one line with the teacher's id, the function and the field, never the value", async () => {
    getSession.mockResolvedValue(teacherSession);
    const result = await callChain(labIdInput, { labId: "jan.jansen@example.test" });
    expect(validationIssues(result.error)).not.toBeNull();
    expect(logged()).toEqual([
      expect.objectContaining({
        event: "input_validation_fail",
        actor_type: "user",
        actor_id: "u-teacher",
        server_fn: "getLabPage",
        issues: ["labId:invalid_format"],
        refused_count: 1,
        request_id: "req-304",
      }),
    ]);
    expect(lines.join("")).not.toMatch(/jansen|example\.test|Test Teacher|secret-token/);
  });

  it("hands the caller the same error Start threw", async () => {
    getSession.mockResolvedValue(teacherSession);
    const input = { labId: "not-a-uuid" };
    const result = await callChain(labIdInput, input);
    const direct = await refusal(labIdInput, input);
    expect(result.error).toBeInstanceOf(Error);
    expect(Object.getPrototypeOf(result.error)).toBe(Error.prototype);
    expect(result.error).toEqual(direct);
  });

  it("bounds a refused list of 500 addresses to one line", async () => {
    getSession.mockResolvedValue(teacherSession);
    const emails = Array.from({ length: 500 }, (_, i) => `person ${i} ${"x".repeat(330)}`);
    await callChain(emailListInput, { labId: "not-a-uuid", emails }, "addEmailsFn");
    expect(lines).toHaveLength(1);
    expect(logged()).toEqual([expect.objectContaining({ refused_count: 501 })]);
    expect(lines.join("")).not.toMatch(/person/);
  });

  it("logs nothing for valid input", async () => {
    getSession.mockResolvedValue(teacherSession);
    const result = await callChain(labIdInput, { labId: "0190a0b0-0000-7000-8000-000000000001" });
    expect(result.error).toBeUndefined();
    expect(lines).toEqual([]);
  });

  it("logs a refusal by role as authz_fail only, before the validator runs", async () => {
    getSession.mockResolvedValue({
      ...teacherSession,
      user: { ...teacherSession.user, role: "student" },
    });
    const result = await callChain(labIdInput, { labId: "not-a-uuid" });
    expect(result.error).toBeInstanceOf(AuthError);
    expect(logged()).toEqual([expect.objectContaining({ event: "authz_fail", status: 403 })]);
  });

  it("logs a refused upload form by its field, never the file (uploadLabLogoFn)", async () => {
    getSession.mockResolvedValue(teacherSession);
    const form = new FormData();
    form.set(LOGO_FORM_FIELDS.labId, "jan.jansen");
    form.set(LOGO_FORM_FIELDS.file, new File([Uint8Array.of(1, 2)], "jansen.png"));
    const result = await callChain(uploadLogoInput, form, "uploadLabLogoFn");
    expect(validationIssues(result.error)).not.toBeNull();
    expect(logged()).toEqual([
      expect.objectContaining({
        event: "input_validation_fail",
        actor_id: "u-teacher",
        server_fn: "uploadLabLogoFn",
        issues: ["labId:invalid_format"],
      }),
    ]);
    expect(lines.join("")).not.toMatch(/jansen/);
  });

  it("logs a refusal once when it passes through an outer server function (#357)", async () => {
    getSession.mockResolvedValue(teacherSession);
    const outer = createMiddleware({ type: "function" }).server(async () => {
      const inner = await callChain(labIdInput, { labId: "not-a-uuid" }, "innerFn");
      throw inner.error;
    });
    const serverFnMeta = { id: "outer-id", name: "outerFn", filename: "src/server/x.ts" };
    const result = await startStorage().run(startContext(), () =>
      executeMiddleware([outer], "server", { method: "POST", data: undefined, serverFnMeta }),
    );
    expect(validationIssues(result.error)).not.toBeNull();
    expect(logged()).toEqual([expect.objectContaining({ server_fn: "innerFn" })]);
  });

  it("hands the caller the refusal when the log write fails (#357)", async () => {
    getSession.mockResolvedValue(teacherSession);
    const input = { labId: "not-a-uuid" };
    const restoreFailing = setSecurityLogWriter(() => {
      throw new Error("disk full");
    });
    let result: Awaited<ReturnType<typeof callChain>>;
    try {
      result = await callChain(labIdInput, input);
    } finally {
      restoreFailing();
    }
    expect(result.error).toEqual(await refusal(labIdInput, input));
  });
});

/**
 * The Zod 4 constructs whose issues can carry a key of the input in their path: records, maps,
 * and objects that keep unknown keys.
 */
const KEYED_SCHEMA =
  /\bz\.(?:record|partialRecord|looseRecord|map|looseObject)\(|\.(?:loose|catchall|passthrough)\(/;

/** The one schema file allowed one: FerroEHR's web template, an answer, never a function's input. */
const KEYED_ALLOWED = new Set(["src/server/openehr/schemas.ts"]);

/** Returns the source files, tests left out, that use a {@link KEYED_SCHEMA} construct. */
function keyedSchemaFiles(sources: ReadonlyMap<string, string>): string[] {
  return [...sources]
    .map(([path, text]) => [path.split(sep).join("/"), text] as const)
    .filter(([path]) => !/\.test\.tsx?$/.test(path) && !KEYED_ALLOWED.has(path))
    .filter(([, text]) => KEYED_SCHEMA.test(text))
    .map(([path]) => path);
}

describe("a logged path holds schema keys only (ASVS V16.2.5)", () => {
  it("no schema in src/server or src/lib takes keys from the input, except FerroEHR's answers", async () => {
    const { handWrittenSources } = await import("./test-source-files.ts");
    const sources = new Map([
      ...(await handWrittenSources("src/server")),
      ...(await handWrittenSources("src/lib")),
    ]);
    expect(keyedSchemaFiles(sources)).toEqual([]);
  });

  it.each([
    "z.record(z.string(), z.number())",
    "z.partialRecord(z.string(), z.number())",
    "z.looseRecord(z.string(), z.number())",
    "z.map(z.string(), z.number())",
    "z.looseObject({ a: z.string() })",
    "z.object({ a: z.string() }).loose()",
    "z.object({ a: z.string() }).catchall(z.number())",
    "z.object({ a: z.string() }).passthrough()",
  ])("catches %s in an input schema (#357)", (schema) => {
    const sources = new Map([["src/server/x/schemas.ts", `export const input = ${schema};`]]);
    expect(keyedSchemaFiles(sources)).toEqual(["src/server/x/schemas.ts"]);
  });

  it("allows the openEHR web template by its exact file only", () => {
    const text = "export const t = z.looseObject({});";
    const sources = new Map([
      ["src/server/openehr/schemas.ts", text],
      ["src/server/openehr/other.ts", text],
    ]);
    expect(keyedSchemaFiles(sources)).toEqual(["src/server/openehr/other.ts"]);
  });

  it("leaves a strict or a plain object alone", () => {
    const sources = new Map([
      [
        "src/server/x/schemas.ts",
        "z.strictObject({ a: z.string() }); z.object({ b: z.number() });",
      ],
    ]);
    expect(keyedSchemaFiles(sources)).toEqual([]);
  });
});

describe("the app registers the middleware for every server function", () => {
  it("lists it as global function middleware in src/start.ts", () => {
    const source = readFileSync("src/start.ts", "utf8");
    expect(source).toContain("functionMiddleware: [inputRefusalLogMiddleware]");
  });
});
