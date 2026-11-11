// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The Users screen's Query layer (#62): every mutation invalidates only its own keys, and each
// optimistic update rolls back when the server fails or refuses.
import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionKeys } from "../../lib/session.query-options.ts";
import {
  invalidatedKeys,
  runMutation,
  seedCache,
  testQueryClient,
} from "../../lib/test-query-client.ts";
import type { AdminActionResult } from "./actions.ts";
import {
  AdminActionRefused,
  blockUserMutationOptions,
  bulkBlockMutationOptions,
  bulkEndSessionsMutationOptions,
  endAllSessionsMutationOptions,
  endSessionMutationOptions,
  setRolesMutationOptions,
  unblockUserMutationOptions,
  usersKeys,
} from "./query-options.ts";

vi.mock("./functions.ts", () => ({ listAdminUsers: vi.fn(), getAdminUser: vi.fn() }));
vi.mock("../../lib/session.functions.ts", () => ({ getSession: vi.fn() }));

const ONE = "user-one";
const TWO = "user-two";
const FIRST_PAGE = usersKeys.list({});
const SEARCHED = usersKeys.list({ q: "one" });

function row(id: string) {
  return { id, roles: ["teacher"], activeSessions: 2 };
}

function detail(id: string) {
  return {
    id,
    roles: ["teacher"],
    sessions: [
      { id: `${id}-a`, current: false },
      { id: `${id}-b`, current: true },
    ],
  };
}

/** A cache with both list pages, both details and the session, as the screen holds them. */
function seeded(): QueryClient {
  const queryClient = testQueryClient();
  seedCache(queryClient, [
    [FIRST_PAGE, { rows: [row(ONE), row(TWO)] }],
    [SEARCHED, { rows: [row(ONE)] }],
    [usersKeys.detail(ONE), detail(ONE)],
    [usersKeys.detail(TWO), detail(TWO)],
    [sessionKeys.current(), { id: "admin" }],
  ]);
  return queryClient;
}

const ok = (): Promise<AdminActionResult> => Promise.resolve({ ok: true });
const refused = (): Promise<AdminActionResult> =>
  Promise.resolve({ ok: false, error: "not_found" });
const serverError = (): Promise<AdminActionResult> => Promise.reject(new Error("500"));

const ONE_AND_LISTS = [FIRST_PAGE, SEARCHED, usersKeys.detail(ONE)]
  .map((key) => JSON.stringify(key))
  .sort();

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = seeded();
});

describe("usersKeys", () => {
  it("nests every list and detail under the area root, narrowest last", () => {
    expect(usersKeys.lists()).toEqual(["admin-users", "list"]);
    expect(usersKeys.list({ q: "x" })).toEqual(["admin-users", "list", { q: "x" }]);
    expect(usersKeys.detail(ONE)).toEqual(["admin-users", "detail", ONE]);
  });
});

describe("targeted invalidation: each mutation invalidates the lists and its users' details only", () => {
  it("end one session", async () => {
    const options = endSessionMutationOptions(queryClient, ok);
    await runMutation(queryClient, options, { userId: ONE, sessionId: `${ONE}-a` });
    expect(invalidatedKeys(queryClient)).toEqual(ONE_AND_LISTS);
  });

  it("end all sessions", async () => {
    await runMutation(queryClient, endAllSessionsMutationOptions(queryClient, ok), { userId: ONE });
    expect(invalidatedKeys(queryClient)).toEqual(ONE_AND_LISTS);
  });

  it("set roles", async () => {
    const options = setRolesMutationOptions(queryClient, ok);
    await runMutation(queryClient, options, { userId: ONE, roles: ["admin"] });
    expect(invalidatedKeys(queryClient)).toEqual(ONE_AND_LISTS);
  });

  it("block", async () => {
    const options = blockUserMutationOptions(queryClient, ok);
    await runMutation(queryClient, options, { userId: ONE, reason: "r", until: "" });
    expect(invalidatedKeys(queryClient)).toEqual(ONE_AND_LISTS);
  });

  it("unblock", async () => {
    await runMutation(queryClient, unblockUserMutationOptions(queryClient, ok), { userId: ONE });
    expect(invalidatedKeys(queryClient)).toEqual(ONE_AND_LISTS);
  });

  it("bulk end sessions invalidates each selected user and the lists", async () => {
    const call = () => Promise.resolve({ done: [ONE, TWO], refused: [] });
    await runMutation(queryClient, bulkEndSessionsMutationOptions(queryClient, call), {
      userIds: [ONE, TWO],
    });
    expect(invalidatedKeys(queryClient)).toEqual(
      [FIRST_PAGE, SEARCHED, usersKeys.detail(ONE), usersKeys.detail(TWO)]
        .map((key) => JSON.stringify(key))
        .sort(),
    );
  });

  it("bulk block of one user leaves the other user's detail and the session alone", async () => {
    const call = () => Promise.resolve({ done: [TWO], refused: [] });
    await runMutation(queryClient, bulkBlockMutationOptions(queryClient, call), {
      userIds: [TWO],
      reason: "r",
      until: "",
    });
    const invalidated = invalidatedKeys(queryClient);
    expect(invalidated).not.toContain(JSON.stringify(usersKeys.detail(ONE)));
    expect(invalidated).not.toContain(JSON.stringify(sessionKeys.current()));
    expect(invalidated).toContain(JSON.stringify(usersKeys.detail(TWO)));
  });

  it("a failed action still invalidates only its keys", async () => {
    await runMutation(queryClient, unblockUserMutationOptions(queryClient, serverError), {
      userId: ONE,
    });
    expect(invalidatedKeys(queryClient)).toEqual(ONE_AND_LISTS);
  });
});

describe("optimistic updates roll back on a server error", () => {
  it("ending one session removes it at once and puts it back on a 500", async () => {
    let fail: (error: Error) => void = () => undefined;
    const call = () =>
      new Promise<AdminActionResult>((_resolve, reject) => {
        fail = reject;
      });
    const running = runMutation(queryClient, endSessionMutationOptions(queryClient, call), {
      userId: ONE,
      sessionId: `${ONE}-a`,
    });
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(usersKeys.detail(ONE))).toMatchObject({
        sessions: [{ id: `${ONE}-b` }],
      }),
    );
    expect(queryClient.getQueryData(FIRST_PAGE)).toMatchObject({
      rows: [
        { id: ONE, activeSessions: 1 },
        { id: TWO, activeSessions: 2 },
      ],
    });
    fail(new Error("500"));
    const { error } = await running;
    expect(error?.message).toBe("500");
    expect(queryClient.getQueryData(usersKeys.detail(ONE))).toEqual(detail(ONE));
    expect(queryClient.getQueryData(FIRST_PAGE)).toEqual({ rows: [row(ONE), row(TWO)] });
  });

  it("ending all sessions rolls the count back on a 500", async () => {
    const { error } = await runMutation(
      queryClient,
      endAllSessionsMutationOptions(queryClient, serverError),
      { userId: ONE },
    );
    expect(error).toBeInstanceOf(Error);
    expect(queryClient.getQueryData(SEARCHED)).toEqual({ rows: [row(ONE)] });
    expect(queryClient.getQueryData(usersKeys.detail(ONE))).toEqual(detail(ONE));
  });

  it("a role change rolls back on a 500", async () => {
    await runMutation(queryClient, setRolesMutationOptions(queryClient, serverError), {
      userId: ONE,
      roles: ["admin"],
    });
    expect(queryClient.getQueryData(usersKeys.detail(ONE))).toEqual(detail(ONE));
    expect(queryClient.getQueryData(FIRST_PAGE)).toEqual({ rows: [row(ONE), row(TWO)] });
  });

  it("a refused role change rolls back like a failed one, with the refusal code", async () => {
    const { error } = await runMutation(
      queryClient,
      setRolesMutationOptions(queryClient, refused),
      {
        userId: ONE,
        roles: ["admin"],
      },
    );
    expect(error).toBeInstanceOf(AdminActionRefused);
    expect(error instanceof AdminActionRefused && error.code).toBe("not_found");
    expect(queryClient.getQueryData(usersKeys.detail(ONE))).toEqual(detail(ONE));
  });
});
