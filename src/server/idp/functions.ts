// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions of Admin → System → Identity providers (#46, ADR 0015); bodies run on the
// server. Every one requires the admin role first (a teacher-admin holds it), then parses its
// input with the Zod schema the form shares.
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getLocale } from "../../i18n/runtime.js";
import type { SessionUser } from "../authz.ts";
import { getDb } from "../db/index.ts";
import { getEnv } from "../env.ts";
import { requireRole } from "../middleware.ts";
import { assertAdmin } from "../users/actions.ts";
import { adminServiceContext } from "./context.ts";
import { keyringOf } from "./crypto.ts";
import { listProviders, providerDetail } from "./queries.ts";
import { providerLabels } from "./registry.ts";
import {
  createProviderInput,
  providerIdInput,
  setProviderEnabledInput,
  testResultInput,
  updateProviderInput,
} from "./schemas.ts";
import {
  createProvider,
  deleteProvider,
  type IdpServiceContext,
  setProviderEnabled,
  updateProvider,
} from "./service.ts";
import { readTestOutcome, startTest } from "./test-flow.ts";

function locale(): "en" | "nl" {
  return getLocale() === "nl" ? "nl" : "en";
}

function serviceContext(actor: SessionUser): IdpServiceContext {
  return adminServiceContext(actor, getEnv(), getDb());
}

/** Returns every identity provider for the providers table. */
export const listIdentityProviders = createServerFn({ method: "GET" })
  .middleware([requireRole("admin")])
  .handler(({ context }) => {
    assertAdmin(context.user);
    return listProviders(getDb(), locale());
  });

/** Returns every provider id with its name in the active locale (role sources, sign-in methods). */
export const listIdentityProviderLabels = createServerFn({ method: "GET" })
  .middleware([requireRole("admin")])
  .handler(({ context }) => {
    assertAdmin(context.user);
    return providerLabels(getDb(), locale());
  });

/** Returns one provider for its edit page, without secrets; throws `notFound` for an unknown id. */
export const getIdentityProvider = createServerFn({ method: "GET" })
  .middleware([requireRole("admin")])
  .validator(providerIdInput)
  .handler(async ({ data, context }) => {
    assertAdmin(context.user);
    const env = getEnv();
    const detail = await providerDetail(getDb(), {
      keyring: keyringOf(env),
      baseURL: env.BETTER_AUTH_URL,
      providerId: data.providerId,
      locale: locale(),
    });
    if (!detail) throw notFound();
    return detail;
  });

/** Adds an identity provider, switched off (`idp_created`). */
export const createIdentityProvider = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(createProviderInput)
  .handler(({ data, context }) => createProvider(serviceContext(context.user), data));

/** Edits an identity provider (`idp_updated` and, when they apply, the rotation events). */
export const updateIdentityProvider = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(updateProviderInput)
  .handler(({ data, context }) => updateProvider(serviceContext(context.user), data));

/** Enables or disables an identity provider. */
export const setIdentityProviderEnabled = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(setProviderEnabledInput)
  .handler(({ data, context }) => setProviderEnabled(serviceContext(context.user), data));

/** Deletes an identity provider nobody signed in with. */
export const deleteIdentityProvider = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(providerIdInput)
  .handler(({ data, context }) => deleteProvider(serviceContext(context.user), data));

/** Starts a test sign-in and returns the callback URL of its result page. */
export const startIdentityProviderTest = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(providerIdInput)
  .handler(async ({ data, context }) => {
    assertAdmin(context.user);
    const db = getDb();
    const exists = await db
      .selectFrom("identity_provider")
      .select("provider_id")
      .where("provider_id", "=", data.providerId)
      .executeTakeFirst();
    if (!exists) throw notFound();
    const test = await startTest(db, {
      adminId: context.user.id,
      providerId: data.providerId,
      now: new Date(),
    });
    return { test };
  });

/** Returns the outcome of the caller's own test sign-in, or `null` when it is not theirs. */
export const getIdentityProviderTestResult = createServerFn({ method: "GET" })
  .middleware([requireRole("admin")])
  .validator(testResultInput)
  .handler(({ data, context }) => {
    assertAdmin(context.user);
    return readTestOutcome(getDb(), {
      test: data.test,
      adminId: context.user.id,
      providerId: data.providerId,
      now: new Date(),
    });
  });
