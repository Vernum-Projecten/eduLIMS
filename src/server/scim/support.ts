// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Whether this deployment can run SCIM (#45, ADR 0017). The scim plugin and the sso plugin's
// `resolveUser` (the SCIM link at sign-in) need a database adapter with native interactive
// transactions, sessions in the database, and the async context better-auth keeps the current
// transaction in. These are the checks of @better-auth/sso 1.7.20 (`assertSSOUserResolution*`)
// and @better-auth/scim 1.7.20 (`assertNativeSCIMTransactions`), run before the plugins are
// added: without them the scim plugin refuses to start, and `/scim/v2` answers 501 instead.
// Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import { getCurrentDBAdapterAsyncLocalStorage } from "@better-auth/core/context";
import type { BetterAuthOptions } from "better-auth";

/** Why SCIM is off; the 501 body names the code, never configuration values. */
export type ScimUnsupportedReason =
  | "no_native_transactions"
  | "no_database_sessions"
  | "no_async_context";

/** The outcome of {@link scimSupport}. */
export type ScimSupport = { ok: true } | { ok: false; reason: ScimUnsupportedReason };

/** What the transaction check reads from a better-auth adapter. */
export interface AdapterShape {
  options?: { adapterConfig: { transaction?: unknown } } | undefined;
}

/** What the session check reads from the better-auth options. */
export type ScimSessionOptions = Pick<BetterAuthOptions, "secondaryStorage" | "session">;

/** Returns whether `adapter` runs `transaction` natively, not as the sequential fallback. */
export function hasNativeTransactions(adapter: AdapterShape): boolean {
  return typeof adapter.options?.adapterConfig.transaction === "function";
}

/**
 * Returns whether sessions live in the database: no secondary storage, or secondary storage
 * with the database copy kept (the sso plugin's `assertSSOUserResolutionSessionStorage`).
 */
export function hasDatabaseSessions(options: ScimSessionOptions): boolean {
  if (!options.secondaryStorage) return true;
  return (
    options.session?.storeSessionInDatabase === true &&
    options.session.preserveSessionInDatabase !== true
  );
}

/** Returns whether better-auth's transaction async context is available in this runtime. */
export async function hasAsyncContext(
  load: () => Promise<unknown> = getCurrentDBAdapterAsyncLocalStorage,
): Promise<boolean> {
  try {
    await load();
    return true;
  } catch {
    // NOTE: #45; a runtime without AsyncLocalStorage is the refusal itself, answered with 501.
    return false;
  }
}

/**
 * Runs the two checks that need no I/O: createAuth runs them before it adds the plugins, since
 * the scim plugin refuses to start on an adapter without native transactions.
 */
export function staticScimSupport(adapter: AdapterShape, options: ScimSessionOptions): ScimSupport {
  if (!hasNativeTransactions(adapter)) return { ok: false, reason: "no_native_transactions" };
  if (!hasDatabaseSessions(options)) return { ok: false, reason: "no_database_sessions" };
  return { ok: true };
}

/** Runs all three checks in order; the first that fails is the reason. */
export async function scimSupport(
  adapter: AdapterShape,
  options: ScimSessionOptions,
  load?: () => Promise<unknown>,
): Promise<ScimSupport> {
  const fixed = staticScimSupport(adapter, options);
  if (!fixed.ok) return fixed;
  if (!(await hasAsyncContext(load))) return { ok: false, reason: "no_async_context" };
  return { ok: true };
}
