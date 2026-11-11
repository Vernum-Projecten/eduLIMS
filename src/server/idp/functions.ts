// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions of Admin → System → Identity providers (#46, ADR 0015); bodies run on the
// server. Every one requires the admin role first (a teacher-admin holds it), then parses its
// input with the Zod schema the form shares; its handler (handlers.ts) checks the role again.
import { createServerFn } from "@tanstack/react-start";
import { getLocale } from "../../i18n/runtime.js";
import { getDb } from "../db/index.ts";
import { getEnv } from "../env.ts";
import { requireRole } from "../middleware.ts";
import { type IdpHandlerDeps, idpHandlers } from "./handlers.ts";
import {
  createProviderInput,
  providerIdInput,
  setProviderEnabledInput,
  testResultInput,
  updateProviderInput,
} from "./schemas.ts";

function deps(): IdpHandlerDeps {
  return { db: getDb(), env: getEnv(), locale: getLocale() === "nl" ? "nl" : "en" };
}

/** Returns every identity provider for the providers table. */
export const listIdentityProviders = createServerFn({ method: "GET" })
  .middleware([requireRole("admin")])
  .handler(({ context }) => idpHandlers.list(context.user, deps()));

/** Returns every provider id with its name in the active locale (role sources, sign-in methods). */
export const listIdentityProviderLabels = createServerFn({ method: "GET" })
  .middleware([requireRole("admin")])
  .handler(({ context }) => idpHandlers.labels(context.user, deps()));

/** Returns one provider for its edit page, without secrets; throws `notFound` for an unknown id. */
export const getIdentityProvider = createServerFn({ method: "GET" })
  .middleware([requireRole("admin")])
  .validator(providerIdInput)
  .handler(({ data, context }) => idpHandlers.get(context.user, data, deps()));

/** Adds an identity provider, switched off (`idp_created`). */
export const createIdentityProvider = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(createProviderInput)
  .handler(({ data, context }) => idpHandlers.create(context.user, data, deps()));

/** Edits an identity provider (`idp_updated` and, when they apply, the rotation events). */
export const updateIdentityProvider = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(updateProviderInput)
  .handler(({ data, context }) => idpHandlers.update(context.user, data, deps()));

/** Enables or disables an identity provider. */
export const setIdentityProviderEnabled = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(setProviderEnabledInput)
  .handler(({ data, context }) => idpHandlers.setEnabled(context.user, data, deps()));

/** Deletes an identity provider nobody signed in with. */
export const deleteIdentityProvider = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(providerIdInput)
  .handler(({ data, context }) => idpHandlers.delete(context.user, data, deps()));

/** Starts a test sign-in and returns the callback URL of its result page. */
export const startIdentityProviderTest = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(providerIdInput)
  .handler(({ data, context }) => idpHandlers.startTest(context.user, data, deps()));

/** Returns the outcome of the caller's own test sign-in, or `null` when it is not theirs. */
export const getIdentityProviderTestResult = createServerFn({ method: "GET" })
  .middleware([requireRole("admin")])
  .validator(testResultInput)
  .handler(({ data, context }) => idpHandlers.testResult(context.user, data, deps()));
