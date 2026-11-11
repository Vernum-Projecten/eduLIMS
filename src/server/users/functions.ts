// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions of the Users screen (#34, B1); bodies run on the server. Every one requires
// the admin role first (a teacher-admin holds it), then parses its input with Zod.
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { getLocale } from "../../i18n/runtime.js";
import {
  CREDENTIAL_SIGN_IN,
  parseSignInMethod,
  type SignInMethod,
} from "../../lib/sign-in-method.ts";
import { getAuth } from "../auth.ts";
import type { SessionUser } from "../authz.ts";
import { getDb } from "../db/index.ts";
import { getEnv } from "../env.ts";
import { providerLabels } from "../idp/registry.ts";
import { requireRole } from "../middleware.ts";
import {
  type ActionContext,
  blockUser,
  bulkBlockUsers,
  bulkEndAllSessions,
  endAllSessions,
  endSession,
  setLocalRoles,
  unblockUser,
} from "./actions.ts";
import { getUserDetail } from "./detail.ts";
import { listUsers, userFacets } from "./queries.ts";
import {
  blockUserInput,
  bulkBlockUsersInput,
  bulkUsersInput,
  listUsersInput,
  revokeSessionInput,
  setUserRolesInput,
  userIdInput,
} from "./schemas.ts";

/**
 * Returns one page of the users table, the sign-in methods its provider facet offers (every
 * identity provider, and the development login while it is on) with the providers' names, and
 * the count of every facet value under the current search and filters.
 */
export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireRole("admin")])
  .validator(listUsersInput)
  .handler(async ({ data }) => {
    const env = getEnv();
    const db = getDb();
    const labels = await providerLabels(db, getLocale() === "nl" ? "nl" : "en");
    const providers = Object.keys(labels).flatMap((id) => parseSignInMethod(id) ?? []);
    const providerOptions: SignInMethod[] = env.EDULIMS_DEV_LOGIN
      ? [...providers, CREDENTIAL_SIGN_IN]
      : providers;
    const now = new Date();
    const [page, facets] = await Promise.all([
      listUsers(db, data, now),
      userFacets(db, data, now, providerOptions),
    ]);
    return { ...page, providerOptions, facets };
  });

/** Returns the user detail sheet of one user; throws `notFound` for an unknown id. */
export const getAdminUser = createServerFn({ method: "GET" })
  .middleware([requireRole("admin")])
  .validator(userIdInput)
  .handler(async ({ data, context }) => {
    const session = await getAuth().api.getSession({ headers: getRequestHeaders() });
    const detail = await getUserDetail(
      getDb(),
      data.userId,
      { userId: context.user.id, sessionId: session?.session.id ?? null },
      new Date(),
    );
    if (!detail) throw notFound();
    return detail;
  });

function actionContext(actor: SessionUser): ActionContext {
  return { auth: getAuth(), db: getDb(), actor, headers: getRequestHeaders(), now: new Date() };
}

/** Blocks a user with a reason and an optional last day (owner decision on #32). */
export const blockAdminUser = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(blockUserInput)
  .handler(async ({ data, context }) => blockUser(actionContext(context.user), data));

/** Lifts the block of a user. */
export const unblockAdminUser = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(userIdInput)
  .handler(async ({ data, context }) => unblockUser(actionContext(context.user), data));

/** Ends one session of a user, named by its id. */
export const endAdminUserSession = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(revokeSessionInput)
  .handler(async ({ data, context }) => endSession(actionContext(context.user), data));

/** Ends every session of a user (every other one on the administrator's own account). */
export const endAllAdminUserSessions = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(userIdInput)
  .handler(async ({ data, context }) => endAllSessions(actionContext(context.user), data));

/** Sets the local role set of another user (hybrid ownership, owner decision on #32). */
export const setAdminUserRoles = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(setUserRolesInput)
  .handler(async ({ data, context }) => setLocalRoles(actionContext(context.user), data));

/** Ends every session of each selected user (#58); the per-user rules of a single action apply. */
export const bulkEndAdminUserSessions = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(bulkUsersInput)
  .handler(async ({ data, context }) => bulkEndAllSessions(actionContext(context.user), data));

/** Blocks each selected user with one reason (#58); the administrator's own account is refused. */
export const bulkBlockAdminUsers = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(bulkBlockUsersInput)
  .handler(async ({ data, context }) => bulkBlockUsers(actionContext(context.user), data));
