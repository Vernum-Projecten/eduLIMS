// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import "@tanstack/react-start/server-only";
import type { BetterAuthOptions } from "better-auth";
import {
  NO_ROLE_ERROR,
  PROVIDER_DISABLED_ERROR,
  ROLE_CONFLICT_ERROR,
  SAML_NAMEID_ERROR,
} from "../lib/identity-providers.ts";
import { LOCAL_ROLE_SOURCE, parseRoleSource } from "../lib/role-source.ts";
import { formatRoles, validateRoleValue } from "../lib/roles.ts";
import { auditRecorderOf, requestIdOf } from "./audit/better-auth-hooks.ts";
import { auditProvider } from "./audit/events.ts";
import type { ProviderSettingsView } from "./idp/registry.ts";
import { hasPersistentNameId } from "./idp/saml-nameid.ts";
import { TEST_COMPLETE_ERROR, type TestOutcome } from "./idp/test-flow.ts";
import { type IdpRoles, resolveIdpRoles } from "./idp-roles.ts";
import {
  decideSignInRoles,
  parseRoleChannel,
  type SignInRoles,
  type StoredRoles,
} from "./role-ownership.ts";
import { logSecurityEvent } from "./security-log.ts";

type ValidateUserInfo = NonNullable<NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]>;
type GateContext = Parameters<ValidateUserInfo>[1];

/** What the sign-in gate reads, injected so it tests without a database. */
export interface IdpRoleSyncOptions {
  /** The provider's settings (`identity_provider`), or `null` for one eduLIMS does not know. */
  settingsOf: (providerId: string) => Promise<ProviderSettingsView | null>;
  /** Consumes a pending admin grant (#48) for a new user's email through the provider. */
  consumeAdminGrant?: (email: string, providerId: string) => Promise<boolean>;
  /** The test this sign-in belongs to (Admin "Test"), or `null` for a real sign-in. */
  testOf?: (ctx: GateContext, providerId: string) => Promise<string | null>;
  /** Stores the outcome of a test sign-in. */
  recordTest?: (test: string, outcome: TestOutcome) => Promise<void>;
  /** Whether a pending, unexpired class invitation as a student waits for the email (#28). */
  hasStudentInvitation?: (email: string) => Promise<boolean>;
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

/**
 * Reads the stored role set of an existing user through better-auth's internal adapter: the
 * `user` better-auth hands the gate carries the IdP profile, not the stored row.
 */
async function storedRolesOf(ctx: unknown, userId: string): Promise<StoredRoles | null> {
  const adapter = field(field(ctx, "context"), "internalAdapter");
  const find = field(adapter, "findUserById");
  if (typeof find !== "function") return null;
  const found: unknown = await Reflect.apply(find, adapter, [userId]);
  if (typeof found !== "object" || found === null) return null;
  return {
    role: field(found, "role"),
    roleSource: parseRoleSource(field(found, "roleSource")),
    emailVerified: field(found, "emailVerified") === true,
    roleChannel: parseRoleChannel(field(found, "roleChannel")),
    provisionedBy:
      typeof field(found, "provisionedBy") === "string"
        ? String(field(found, "provisionedBy"))
        : null,
  };
}

/**
 * Returns the claims the role claim is read from: the verified ID-token claims of an OIDC
 * provider, read by dot path, or one SAML assertion attribute by its exact name (SAML names
 * such as `urn:oid:1.3.6.1.4.1.5923.1.1.1.7` contain dots).
 */
function roleClaims(
  settings: ProviderSettingsView,
  profile: Record<string, unknown>,
): { claims: Record<string, unknown>; claimPath: string } {
  if (settings.protocol === "saml") {
    return { claims: { roles: profile[settings.roleClaim] }, claimPath: "roles" };
  }
  return { claims: profile, claimPath: settings.roleClaim };
}

function testOutcome(decision: SignInRoles, profile: Record<string, unknown>): TestOutcome {
  const claimNames = Object.keys(profile).sort((a, b) => a.localeCompare(b, "en"));
  if (decision.kind === "refused") return { outcome: decision.reason, roles: [], claimNames };
  return { outcome: decision.kind, roles: [...decision.roles], claimNames };
}

/**
 * Builds better-auth's `user.validateUserInfo` gate for SSO sign-ins (`sso-oidc`, `sso-saml`)
 * with hybrid role ownership (owner decision on #32, ADR 0012, ADR 0015).
 *
 * A disabled or unknown provider is refused (`provider_disabled`). The role set comes from the
 * provider's role claim and role map: a mapped role is authoritative and stored with the
 * provider as `roleSource`. Without one, the user's local roles apply, then the provider's
 * default role, then a pending admin grant for a new user; else `no_edulims_role`. A set
 * eduLIMS does not allow is `role_conflict`. `emailVerified` follows the provider's
 * "email is authoritative" setting. Other methods keep the stored roles.
 */
export function createIdpRoleSync(options: IdpRoleSyncOptions): ValidateUserInfo {
  return async ({ user, source }, ctx) => {
    if (source.method !== "sso-oidc" && source.method !== "sso-saml") return;
    const providerId = source.sso?.providerId ?? "";
    const settings = await options.settingsOf(providerId);
    const recorder = auditRecorderOf(ctx.context);
    const provider = auditProvider(providerId);
    const requestId = requestIdOf(ctx);
    const known = {
      ...(typeof user.id === "string" ? { target: { type: "user" as const, id: user.id } } : {}),
      ...(provider ? { provider } : {}),
      ...(requestId ? { requestId } : {}),
    };
    // Every refusal reaches the security log once: through the activity log (recordAudit), or
    // directly when no recorder is attached. Ids and codes only (A09, privacy).
    const refuse = async (reason: string): Promise<void> => {
      if (recorder) {
        await recorder.record({
          action: "authn_login_fail",
          actor: { type: "anonymous" },
          outcome: "refused",
          reason,
          ...known,
        });
        return;
      }
      logSecurityEvent("warn", "authn_login_fail", {
        outcome: "refused",
        actor_type: "anonymous",
        target_type: known.target?.type,
        target_id: known.target?.id,
        reason,
        provider: providerId,
        request_id: requestId,
      });
    };
    // A test sign-in (Admin "Test") ends here and creates nothing; the claim names and roles
    // stay in the test record, the stream gets the outcome code.
    const endTest = async (test: string, outcome: TestOutcome) => {
      await options.recordTest?.(test, outcome);
      logSecurityEvent("info", "idp_test_sign_in", {
        outcome: "refused",
        actor_type: "anonymous",
        reason: TEST_COMPLETE_ERROR,
        test_outcome: outcome.outcome,
        provider: providerId,
        request_id: requestId,
      });
      return { error: TEST_COMPLETE_ERROR, errorDescription: "Test sign-in complete" };
    };
    if (!settings) {
      await refuse(PROVIDER_DISABLED_ERROR);
      return { error: PROVIDER_DISABLED_ERROR, errorDescription: "Identity provider disabled" };
    }
    const profile = source.sso?.profile ?? {};
    // NOTE: #46 (L8); the NameID is the account key, so only a persistent one may sign in.
    if (source.method === "sso-saml" && !hasPersistentNameId(field(ctx.body, "SAMLResponse"))) {
      const test = options.testOf ? await options.testOf(ctx, providerId) : null;
      if (test !== null) {
        return endTest(test, { outcome: SAML_NAMEID_ERROR, roles: [], claimNames: [] });
      }
      await refuse(SAML_NAMEID_ERROR);
      return { error: SAML_NAMEID_ERROR, errorDescription: "SAML NameID is not persistent" };
    }
    const fromIdp: IdpRoles = resolveIdpRoles({
      ...roleClaims(settings, profile),
      roleMap: settings.roleMap,
    });
    const existingId =
      source.action !== "create-user" && typeof user.id === "string" ? user.id : null;
    const stored = existingId ? await storedRolesOf(ctx, existingId) : null;
    let decision = decideSignInRoles(fromIdp, stored, settings.defaultRole);
    const test = options.testOf ? await options.testOf(ctx, providerId) : null;
    if (test !== null) return endTest(test, testOutcome(decision, profile));
    if (!settings.enabled) {
      await refuse(PROVIDER_DISABLED_ERROR);
      return { error: PROVIDER_DISABLED_ERROR, errorDescription: "Identity provider disabled" };
    }
    const email = typeof user.email === "string" ? user.email : "";
    // NOTE: owner decisions on #28 and #45; an invitation grants only `student`, to a verified
    // email the IdP sends no role for, at a first sign-in of a user eduLIMS does not hold yet,
    // so never to a SCIM-provisioned user and never back after the IdP took a role.
    if (
      decision.kind === "refused" &&
      decision.reason === NO_ROLE_ERROR &&
      source.action === "create-user" &&
      stored === null &&
      settings.emailAuthoritative &&
      email !== "" &&
      (await options.hasStudentInvitation?.(email))
    ) {
      decision = { kind: "default", roles: ["student"] };
    }
    if (
      decision.kind === "refused" &&
      decision.reason === NO_ROLE_ERROR &&
      source.action === "create-user" &&
      settings.emailAuthoritative &&
      email !== "" &&
      (await options.consumeAdminGrant?.(email, providerId))
    ) {
      decision = { kind: "default", roles: ["admin"] };
    }
    if (decision.kind === "refused") {
      await refuse(decision.reason);
      // NOTE: A07; a role the IdP took away ends the live access too, not only the next sign-in.
      if (typeof user.id === "string")
        await ctx.context.internalAdapter.deleteUserSessions(user.id);
      if (decision.reason === ROLE_CONFLICT_ERROR) {
        // The provider only: never the user, the e-mail or the claims (A09, privacy). A conflict
        // means the provider's role map is wrong, so it is an operator alert of its own.
        logSecurityEvent("warn", "idp_role_conflict", {
          outcome: "refused",
          reason: ROLE_CONFLICT_ERROR,
          provider: providerId,
        });
        return { error: ROLE_CONFLICT_ERROR, errorDescription: "Conflicting eduLIMS roles" };
      }
      return { error: NO_ROLE_ERROR, errorDescription: "No eduLIMS role assigned" };
    }
    const emailVerified = settings.emailAuthoritative;
    if (source.action === "create-user") {
      // NOTE: better-auth 1.7.20 validates the exact record it then inserts
      // (internal-adapter.mjs createUser), so these fields are stored with the user.
      user.emailVerified = emailVerified;
      if (decision.kind === "idp" || decision.kind === "default") {
        user["role"] = formatRoles(decision.roles);
        user["roleSource"] = decision.kind === "idp" ? settings.providerId : LOCAL_ROLE_SOURCE;
        user["roleChannel"] = decision.kind === "idp" ? "claim" : "local";
      }
      return;
    }
    if (!existingId) return;
    const update: Record<string, unknown> = {};
    if (stored?.emailVerified !== emailVerified) update["emailVerified"] = emailVerified;
    if (decision.kind === "local" || decision.kind === "scim") {
      if (Object.keys(update).length > 0) {
        await ctx.context.internalAdapter.updateUser(existingId, update);
      }
      return;
    }
    const role = formatRoles(decision.roles);
    const nextSource = decision.kind === "idp" ? settings.providerId : LOCAL_ROLE_SOURCE;
    // NOTE: #45 (B1, V8.2.1); a set a claim gave is marked `claim`, so it never outlives the claim.
    const nextChannel = decision.kind === "idp" ? "claim" : "local";
    const previous = validateRoleValue(stored?.role);
    const previousRole = previous.ok ? formatRoles(previous.roles) : undefined;
    // A provider's set stored before the channel was recorded counts as the claim's.
    const storedChannel =
      stored?.roleSource == null || stored.roleSource === LOCAL_ROLE_SOURCE
        ? "local"
        : stored.roleChannel === "scim"
          ? "scim"
          : "claim";
    if (
      previousRole !== role ||
      stored?.roleSource !== nextSource ||
      storedChannel !== nextChannel
    ) {
      update["role"] = role;
      update["roleSource"] = nextSource;
      update["roleChannel"] = nextChannel;
    }
    if (Object.keys(update).length > 0) {
      await ctx.context.internalAdapter.updateUser(existingId, update);
    }
    if (previousRole === role) return;
    await recorder?.record({
      action: "authz_role_change",
      actor: { type: "system" },
      outcome: "success",
      metadata: { roles: role, ...(previousRole ? { previous_roles: previousRole } : {}) },
      ...known,
    });
  };
}
