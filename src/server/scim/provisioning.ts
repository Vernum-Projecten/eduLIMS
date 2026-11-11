// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The options eduLIMS gives the scim plugin (#45, ADR 0017): bearer tokens per identity provider
// (the provider id is the connection id), linking on the directory `externalId` only, the
// provider's role map applied to SCIM groups and `roles` values (hybrid ownership, #32), and
// the deactivation state on the user row. Relative imports: `pnpm db:seed` loads auth.ts.
import "@tanstack/react-start/server-only";
import { queueAfterTransactionHook } from "@better-auth/core/context";
import {
  type SCIMIdentityState,
  type SCIMOptions,
  type SCIMPlugin,
  type SCIMProjectedUserState,
  scim,
} from "@better-auth/scim";
import type { DBTransactionAdapter } from "better-auth";
import type { Kysely } from "kysely";
import { type ProviderId, parseProviderId } from "../../lib/identity-providers.ts";
import { parseRoleSource } from "../../lib/role-source.ts";
import { formatRoles, isRole, type Role, validateRoleValue } from "../../lib/roles.ts";
import type { AuditEvent } from "../audit/events.ts";
import { recordCommittedAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import { providerSettings } from "../idp/registry.ts";
import { logSecurityEvent } from "../security-log.ts";
import { decideScimRoles, mapScimFacts, type ScimRoleFact } from "./roles.ts";
import type { ScimSupport } from "./support.ts";
import { verifyScimToken } from "./verify.ts";

/** Every scope a token grants: the connection reads and writes Users and Groups. */
const ALL_SCOPES = [
  "scim.users.read",
  "scim.users.write",
  "scim.groups.read",
  "scim.groups.write",
] as const;

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Writes an activity-log row once the SCIM transaction has committed (B4). */
export async function auditAfterCommit(db: Kysely<DB>, event: AuditEvent): Promise<void> {
  await queueAfterTransactionHook(() => recordCommittedAudit(db, event), {
    // NOTE: B4 (L3); the SCIM change has committed and cannot be undone, so a failed log
    // write goes to the security stream with the action and target id, and the request goes on.
    onError: () =>
      logSecurityEvent("error", "audit_write_failed", {
        outcome: "failure",
        reason: event.action,
        target_type: event.target?.type,
        target_id: event.target?.id,
      }),
  });
}

/** Returns the `roles` values of the stored SCIM User rows (`serializedAttributes.roles`). */
export function scimRoleValues(serializedAttributes: unknown): string[] {
  if (typeof serializedAttributes !== "string") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedAttributes);
  } catch {
    // NOTE: #45; the plugin validates this column on every read, so bad JSON maps no role.
    return [];
  }
  const roles = field(parsed, "roles");
  if (!Array.isArray(roles)) return [];
  return roles.flatMap((role: unknown) => {
    const value = text(field(role, "value"));
    return value ? [value] : [];
  });
}

async function sourceRoleFacts(
  database: DBTransactionAdapter,
  state: SCIMProjectedUserState,
): Promise<ScimRoleFact[]> {
  const active = state.sources.filter((source) => source.active).map((source) => source.id);
  if (active.length === 0) return [];
  const rows = await database.findMany<{ serializedAttributes?: unknown }>({
    model: "scimUser",
    where: [{ field: "id", value: active, operator: "in" }],
  });
  return rows.flatMap((row) =>
    scimRoleValues(row.serializedAttributes).map((value) => ({ keys: [value] })),
  );
}

/** Applies hybrid role ownership for one provisioned user inside the SCIM transaction. */
async function reconcileRoles(
  db: Kysely<DB>,
  state: SCIMProjectedUserState,
  database: DBTransactionAdapter,
): Promise<void> {
  const providerId = parseProviderId(state.provisioningDomainId);
  if (!providerId) return;
  const settings = await providerSettings(db, providerId);
  if (!settings) return;
  const grants: Role[] = state.grants.flatMap((grant) => (isRole(grant.role) ? [grant.role] : []));
  const fromValues = state.active
    ? mapScimFacts(await sourceRoleFacts(database, state), settings.roleMap)
    : [];
  const user = await database.findOne<{
    role?: unknown;
    roleSource?: unknown;
    roleChannel?: unknown;
  }>({
    model: "user",
    where: [{ field: "id", value: state.userId }],
  });
  if (!user) return;
  const decision = decideScimRoles(
    [...grants, ...fromValues],
    {
      roleSource: parseRoleSource(user.roleSource),
      roleChannel: typeof user.roleChannel === "string" ? user.roleChannel : null,
    },
    providerId,
  );
  if (decision.kind === "unchanged") return;
  const previous = validateRoleValue(user.role);
  const previousRole = previous.ok ? formatRoles(previous.roles) : null;
  if (
    previousRole === decision.role &&
    user.roleSource === decision.roleSource &&
    user.roleChannel === decision.roleChannel
  ) {
    return;
  }
  await database.update({
    model: "user",
    where: [{ field: "id", value: state.userId }],
    update: {
      role: decision.role,
      roleSource: decision.roleSource,
      roleChannel: decision.roleChannel,
      updatedAt: new Date(),
    },
  });
  if (decision.role === null) {
    // NOTE: A07; a role the directory took away ends the live access too.
    await database.deleteMany({
      model: "session",
      where: [{ field: "userId", value: state.userId }],
    });
  }
  await auditAfterCommit(db, {
    action: "authz_role_change",
    actor: { type: "system" },
    outcome: decision.reason ? "refused" : "success",
    target: { type: "user", id: state.userId },
    provider: providerId,
    ...(decision.reason ? { reason: decision.reason } : {}),
    metadata: {
      ...(decision.role ? { roles: decision.role } : {}),
      ...(previousRole ? { previous_roles: previousRole } : {}),
    },
  });
}

/**
 * Keeps `provisioned_by` and `deprovisioned_at` in step with the directory: inactive in every
 * source (`active: false`, or the SCIM User deleted) marks the user deprovisioned, which blocks
 * sign-in; the plugin ends the sessions in the same transaction. Reactivation clears the mark.
 * The records stay either way (GDPR erasure is #47).
 */
async function reconcileLifecycle(
  db: Kysely<DB>,
  state: SCIMIdentityState,
  database: DBTransactionAdapter,
): Promise<void> {
  const user = await database.findOne<{ provisionedBy?: unknown; deprovisionedAt?: unknown }>({
    model: "user",
    where: [{ field: "id", value: state.userId }],
  });
  if (!user) return;
  const source = state.sources.find((entry) => entry.active) ?? state.sources[0];
  const provisionedBy =
    parseProviderId(source?.connectionId) ?? parseProviderId(user.provisionedBy);
  const wasDeprovisioned = user.deprovisionedAt instanceof Date;
  const update: Record<string, unknown> = {};
  if (provisionedBy && provisionedBy !== user.provisionedBy)
    update["provisionedBy"] = provisionedBy;
  if (state.active && wasDeprovisioned) update["deprovisionedAt"] = null;
  if (!state.active && !wasDeprovisioned) update["deprovisionedAt"] = new Date();
  if (Object.keys(update).length === 0) return;
  await database.update({
    model: "user",
    where: [{ field: "id", value: state.userId }],
    update,
  });
  if (!Object.hasOwn(update, "deprovisionedAt")) return;
  await auditAfterCommit(db, {
    action: state.active ? "user_reprovisioned" : "user_deprovisioned",
    actor: { type: "system" },
    outcome: "success",
    target: { type: "user", id: state.userId },
    ...(provisionedBy ? { provider: provisionedBy } : {}),
  });
}

/**
 * Returns the scim plugin options of eduLIMS: bearer tokens verified against `scim_token`, one
 * connection per enabled identity provider, explicit linking and the role projection.
 */
export function scimOptions(db: Kysely<DB>): SCIMOptions {
  return {
    connections: [],
    authentication: {
      async verifyBearerToken({ token }) {
        const verified = await verifyScimToken(db, token);
        if (!verified) return null;
        return {
          connection: { id: verified.providerId, provisioningDomainId: verified.providerId },
          credentialId: verified.tokenId,
          scopes: ALL_SCOPES,
          expiresAt: verified.expiresAt,
        };
      },
    },
    identity: {
      // NOTE: #45 and ASVS V6.8.1; a SCIM User links to an existing user only through that
      // provider's own account key, never through an email address.
      // The directory id a sign-in stored on the account (M1), else the account key itself
      // when the provider links on it: either way the same provider's own value.
      async resolveUser(input, context) {
        const externalId = input.resource.externalId;
        if (!externalId) return { action: "create" };
        const settings = await providerSettings(db, input.connectionId);
        if (!settings) return { action: "create" };
        const byDirectoryId = await context.database.findOne<{ userId?: unknown }>({
          model: "account",
          where: [
            { field: "providerId", value: input.connectionId },
            { field: "directoryId", value: externalId },
          ],
        });
        const byAccountKey =
          byDirectoryId === null && settings.scimExternalIdClaim === null
            ? await context.database.findOne<{ userId?: unknown }>({
                model: "account",
                where: [
                  { field: "providerId", value: input.connectionId },
                  { field: "accountId", value: externalId },
                ],
              })
            : null;
        const userId = text((byDirectoryId ?? byAccountKey)?.userId);
        return userId ? { action: "link", userId, profile: "manage" } : { action: "create" };
      },
      reconcileUser: (state, context) => reconcileLifecycle(db, state, context.database),
    },
    projection: {
      roles: {
        async map(input) {
          const settings = await providerSettings(db, input.connectionId);
          if (!settings) return [];
          const { externalId, displayName } = input.source;
          return mapScimFacts([{ keys: [externalId ?? displayName] }], settings.roleMap);
        },
        exists: (input) => isRole(input.role),
      },
      reconcileUser: (state, context) => reconcileRoles(db, state, context.database),
    },
    // NOTE: Microsoft Entra provisioning sends the attribute-less classic Group schema marker.
    compatibility: { microsoftEntra: { acceptLegacyGroupSchema: true } },
  };
}

/** Returns the provider id of a SCIM connection id, which eduLIMS sets to the provider id. */
export function providerOfConnection(connectionId: string): ProviderId | null {
  return parseProviderId(connectionId);
}

/** The scim plugin with the schema it declares for eduLIMS. */
/** The scim plugin's own tables, without the managed connection catalog eduLIMS does not use. */
type ScimSchema = Omit<
  SCIMPlugin["schema"],
  "scimManagedConnection" | "scimManagedCredential" | "scimManagedConnectionEvent"
>;

/** The scim plugin with the schema it declares for eduLIMS. */
export type ScimPlugin = Omit<SCIMPlugin, "schema"> & { schema: ScimSchema };

/**
 * Returns the scim plugin when this deployment can run it, else nothing (the gate answers 501).
 * The plugin's declared schema has optional managed-connection tables, which
 * `exactOptionalPropertyTypes` rejects; eduLIMS does not use them, so they are left out.
 */
export function scimPlugins(db: Kysely<DB>, support: ScimSupport): ScimPlugin[] {
  if (!support.ok) return [];
  const plugin = scim(scimOptions(db));
  const {
    scimManagedConnection: _connection,
    scimManagedCredential: _credential,
    scimManagedConnectionEvent: _event,
    ...schema
  } = plugin.schema;
  return [{ ...plugin, schema }];
}
