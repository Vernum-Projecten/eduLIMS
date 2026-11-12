// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The Query layer of classes (#28): every write invalidates its class and the lists, nothing
// else; a refusal reaches the caller as a ClassActionRefused with its code.
import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionKeys } from "../../lib/session.query-options.ts";
import {
  invalidatedKeys,
  runMutation,
  seedCache,
  testQueryClient,
} from "../../lib/test-query-client.ts";
import type { ClassResult } from "./access.ts";
import {
  ClassActionRefused,
  classErrorCode,
  classesKeys,
  classIdOf,
  classMutationOptions,
  classReadMutationOptions,
  deleteClassMutationOptions,
} from "./query-options.ts";

vi.mock("./functions.ts", () => ({
  getClassPage: vi.fn(),
  getStudentClasses: vi.fn(),
  listGroupSetSourcesFn: vi.fn(),
  listMyClasses: vi.fn(),
}));
vi.mock("../../lib/session.functions.ts", () => ({ getSession: vi.fn() }));

const ONE = "01960000-0000-7000-8000-000000000001";
const TWO = "01960000-0000-7000-8000-000000000002";

function seeded(): QueryClient {
  const queryClient = testQueryClient();
  seedCache(queryClient, [
    [classesKeys.list({ archived: false }), []],
    [classesKeys.list({ archived: true }), []],
    [classesKeys.detail(ONE), { id: ONE }],
    [classesKeys.detail(TWO), { id: TWO }],
    [classesKeys.adminList({}), { rows: [] }],
    [classesKeys.adminDetail(ONE), { id: ONE }],
    [classesKeys.adminDetail(TWO), { id: TWO }],
    [classesKeys.teachers(), []],
    [classesKeys.student(), { classes: [], invitations: [] }],
    [sessionKeys.current(), { id: "teacher" }],
  ]);
  return queryClient;
}

const keys = (...list: readonly (readonly unknown[])[]) =>
  list.map((key) => JSON.stringify(key)).sort();

const LISTS = [
  classesKeys.list({ archived: false }),
  classesKeys.list({ archived: true }),
  classesKeys.adminList({}),
];

/** The teacher's and the administrator's page of one class. */
const PAGES = (classId: string) => [classesKeys.detail(classId), classesKeys.adminDetail(classId)];

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = seeded();
});

describe("classesKeys", () => {
  it("nests every entry under the area root, narrowest last", () => {
    expect(classesKeys.list({ archived: true })).toEqual(["classes", "list", { archived: true }]);
    expect(classesKeys.detail(ONE)).toEqual(["classes", "detail", ONE]);
    expect(classesKeys.sources(ONE)).toEqual(["classes", "detail", ONE, "sources"]);
    expect(classesKeys.adminList({ q: "LS" })).toEqual(["classes", "admin", "list", { q: "LS" }]);
    expect(classesKeys.adminDetail(ONE)).toEqual(["classes", "admin", "detail", ONE]);
    expect(classesKeys.teachers()).toEqual(["classes", "admin", "teachers"]);
  });
});

describe("classMutationOptions", () => {
  it("invalidates the class it changed and the lists, nothing else", async () => {
    const call = (): Promise<ClassResult> => Promise.resolve({ ok: true, value: null });
    await runMutation(queryClient, classMutationOptions(queryClient, call), { classId: ONE });
    expect(invalidatedKeys(queryClient)).toEqual(keys(...PAGES(ONE), ...LISTS));
  });

  it("invalidates only the lists after creating a class", async () => {
    const call = (): Promise<ClassResult<{ classId: string }>> =>
      Promise.resolve({ ok: true, value: { classId: TWO } });
    const result = await runMutation(queryClient, classMutationOptions(queryClient, call), {
      name: "LS-2A",
      academicYear: "2026-2027",
    });
    expect(result.data).toEqual({ classId: TWO });
    expect(invalidatedKeys(queryClient)).toEqual(keys(...LISTS));
  });

  it("throws a refusal with its code, and still invalidates", async () => {
    const call = (): Promise<ClassResult> => Promise.resolve({ ok: false, error: "archived" });
    const result = await runMutation(queryClient, classMutationOptions(queryClient, call), {
      classId: ONE,
    });
    expect(result.error).toBeInstanceOf(ClassActionRefused);
    expect(classErrorCode(result.error)).toBe("archived");
    expect(invalidatedKeys(queryClient)).toEqual(keys(...PAGES(ONE), ...LISTS));
  });

  it("maps a server error to no refusal code", () => {
    expect(classErrorCode(new Error("500"))).toBeNull();
  });
});

describe("deleteClassMutationOptions", () => {
  it("leaves the page, drops the class from the cache and invalidates the lists", async () => {
    const leave = vi.fn(async () => undefined);
    const call = (): Promise<ClassResult> => Promise.resolve({ ok: true, value: null });
    await runMutation(queryClient, deleteClassMutationOptions(queryClient, call, leave), {
      classId: ONE,
    });
    expect(leave).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(classesKeys.detail(ONE))).toBeUndefined();
    expect(invalidatedKeys(queryClient)).toEqual(keys(...LISTS));
  });

  it("stays on the page when the server refuses", async () => {
    const leave = vi.fn(async () => undefined);
    const call = (): Promise<ClassResult> => Promise.resolve({ ok: false, error: "has_work" });
    const result = await runMutation(
      queryClient,
      deleteClassMutationOptions(queryClient, call, leave),
      { classId: ONE },
    );
    expect(classErrorCode(result.error)).toBe("has_work");
    expect(leave).not.toHaveBeenCalled();
    expect(invalidatedKeys(queryClient)).toEqual([]);
  });
});

describe("classReadMutationOptions", () => {
  it("returns the value and invalidates nothing", async () => {
    const call = (): Promise<ClassResult<string[]>> => Promise.resolve({ ok: true, value: ["a"] });
    const result = await runMutation(queryClient, classReadMutationOptions(call), {});
    expect(result.data).toEqual(["a"]);
    expect(invalidatedKeys(queryClient)).toEqual([]);
  });
});

describe("classIdOf", () => {
  it("reads a class id from an input, or none", () => {
    expect(classIdOf({ classId: ONE })).toBe(ONE);
    expect(classIdOf({ name: "LS-2A" })).toBeNull();
  });
});
