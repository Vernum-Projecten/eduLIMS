// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The bodies of the identity-provider server functions (#46, ADR 0015). Each one checks the admin
// role itself before it reads anything, behind the `requireRole("admin")` middleware of its
// server function (functions.ts), so the check holds even if a function loses its middleware.
import "@tanstack/react-start/server-only";
import { notFound } from "@tanstack/react-router";
import type { Kysely } from "kysely";
import type { SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import type { Env } from "../env.ts";
import { assertAdmin } from "../users/actions.ts";
import { adminServiceContext } from "./context.ts";
import { keyringOf } from "./crypto.ts";
import { listProviders, providerDetail } from "./queries.ts";
import { providerLabels } from "./registry.ts";
import type { CreateProviderInput, UpdateProviderInput } from "./schemas.ts";
import { createProvider, deleteProvider, setProviderEnabled, updateProvider } from "./service.ts";
import { readTestOutcome, startTest } from "./test-flow.ts";

/** What a handler runs with besides the caller and the input. */
export interface IdpHandlerDeps {
  db: Kysely<DB>;
  env: Env;
  locale: "en" | "nl";
}

type Actor = Pick<SessionUser, "id" | "roles">;

/**
 * The handlers, one per server function, each refusing a caller without the admin role with
 * `AuthError` 403 before it reads anything (B1, R-01).
 */
export const idpHandlers = {
  list(user: Actor, deps: IdpHandlerDeps) {
    assertAdmin(user);
    return listProviders(deps.db, deps.locale);
  },

  labels(user: Actor, deps: IdpHandlerDeps) {
    assertAdmin(user);
    return providerLabels(deps.db, deps.locale);
  },

  async get(user: Actor, data: { providerId: string }, deps: IdpHandlerDeps) {
    assertAdmin(user);
    const detail = await providerDetail(deps.db, {
      keyring: keyringOf(deps.env),
      baseURL: deps.env.BETTER_AUTH_URL,
      providerId: data.providerId,
      locale: deps.locale,
    });
    if (!detail) throw notFound();
    return detail;
  },

  create(user: Actor, data: CreateProviderInput, deps: IdpHandlerDeps) {
    return createProvider(adminServiceContext(user, deps.env, deps.db), data);
  },

  update(user: Actor, data: UpdateProviderInput, deps: IdpHandlerDeps) {
    return updateProvider(adminServiceContext(user, deps.env, deps.db), data);
  },

  setEnabled(user: Actor, data: { providerId: string; enabled: boolean }, deps: IdpHandlerDeps) {
    return setProviderEnabled(adminServiceContext(user, deps.env, deps.db), data);
  },

  delete(user: Actor, data: { providerId: string }, deps: IdpHandlerDeps) {
    return deleteProvider(adminServiceContext(user, deps.env, deps.db), data);
  },

  async startTest(user: Actor, data: { providerId: string }, deps: IdpHandlerDeps) {
    assertAdmin(user);
    const exists = await deps.db
      .selectFrom("identity_provider")
      .select("provider_id")
      .where("provider_id", "=", data.providerId)
      .executeTakeFirst();
    if (!exists) throw notFound();
    const test = await startTest(deps.db, {
      adminId: user.id,
      providerId: data.providerId,
      now: new Date(),
    });
    return { test };
  },

  testResult(user: Actor, data: { providerId: string; test: string }, deps: IdpHandlerDeps) {
    assertAdmin(user);
    return readTestOutcome(deps.db, {
      test: data.test,
      adminId: user.id,
      providerId: data.providerId,
      now: new Date(),
    });
  },
};
