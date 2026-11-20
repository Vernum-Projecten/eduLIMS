// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Test support: runs a server function of the app on the server side as Start does, without the
// Start compiler. The compiler hands `.handler()` the function twice, as the client stub and as
// the server body; `withCompiledHandlers` does the same, so a test reaches the real chain of a
// function (its middleware, its validator, its handler) in Start's request context.
import { AsyncLocalStorage } from "node:async_hooks";

/** Wraps a builder so that `.handler(fn)` gets `fn` as its server body too. */
function compiled(builder: object): object {
  return new Proxy(builder, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      if (property === "handler") {
        return (fn: unknown) => Reflect.apply(value, target, [fn, fn]);
      }
      return (...args: unknown[]) => {
        const next: unknown = Reflect.apply(value, target, args);
        const chained = (typeof next === "object" && next !== null) || typeof next === "function";
        return chained ? compiled(next) : next;
      };
    },
  });
}

/**
 * Returns the `@tanstack/react-start` module with its server-function builder wrapped, for a
 * `vi.mock` factory: `vi.mock("@tanstack/react-start", async (original) =>
 * withCompiledHandlers(await original()))`.
 */
export function withCompiledHandlers<T extends object>(actual: T): T {
  const create: unknown = Reflect.get(actual, "createServerFn");
  if (typeof create !== "function") throw new Error("no server-function builder to wrap");
  return {
    ...actual,
    createServerFn: (...args: unknown[]) => compiled(Reflect.apply(create, actual, args)),
  };
}

/** The AsyncLocalStorage Start keeps its request context in (`@tanstack/start-storage-context`). */
function startStorage(): AsyncLocalStorage<object> {
  const storage: unknown = Reflect.get(
    globalThis,
    Symbol.for("tanstack-start:start-storage-context"),
  );
  if (!(storage instanceof AsyncLocalStorage)) throw new Error("no Start storage context");
  return storage;
}

/**
 * Calls a server function on the server side, as Start runs a request: in its request context,
 * through the function's own chain. Resolves with what Start sends back, `{ result }` or
 * `{ error }`.
 */
export function callOnServer(fn: unknown, data: unknown, method: "GET" | "POST"): Promise<unknown> {
  const execute: unknown = typeof fn === "function" ? Reflect.get(fn, "__executeServer") : null;
  if (typeof execute !== "function") throw new Error("no server side of the function");
  const context = {
    request: new Request("http://edulims.test/_serverFn/x"),
    startOptions: { functionMiddleware: [] },
    contextAfterGlobalMiddlewares: {},
    handlerType: "serverFn",
  };
  return startStorage().run(context, () => Reflect.apply(execute, fn, [{ data, method }]));
}
