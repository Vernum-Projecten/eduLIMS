// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// better-auth's organization plugin, set up for classes (#28, ADR 0018): it owns the schema, the
// class roles' access control and the ids; eduLIMS's class service (src/server/classes/) does
// every write, in one transaction with its activity-log row. The plugin's HTTP endpoints stay
// unreachable, as the sso plugin's management endpoints do (ADR 0015).
// Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { organization } from "better-auth/plugins";
import type { Kysely } from "kysely";
import { classAccessControl, classRoles } from "../../lib/classes.ts";
import { auditRecorderOf, requestIdOf } from "../audit/better-auth-hooks.ts";
import type { DB } from "../db/schema.gen.ts";

/** How long an invitation stays valid (owner decision on #28 (4): 30 days), in seconds. */
export const INVITATION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

function refuse(): never {
  throw new APIError("NOT_FOUND");
}

/** Returns the organization plugin with classes' fields, roles and teams (lab groups). */
export function classOrganizations() {
  return organization({
    ac: classAccessControl,
    roles: classRoles,
    creatorRole: "owner",
    // NOTE: #28; classes are created by the class service only, which checks the app role.
    allowUserToCreateOrganization: false,
    invitationExpiresIn: INVITATION_LIFETIME_SECONDS,
    // NOTE: owner decision on #28; eduLIMS sends no email, so no `sendInvitationEmail`.
    teams: { enabled: true, defaultTeam: { enabled: false }, allowRemovingAllTeams: true },
    schema: {
      organization: {
        additionalFields: {
          academicYear: {
            type: "string",
            required: true,
            input: false,
            fieldName: "academic_year",
          },
          archivedAt: { type: "date", required: false, input: false, fieldName: "archived_at" },
        },
      },
      team: {
        additionalFields: {
          groupSet: { type: "string", required: true, input: false, fieldName: "group_set" },
        },
      },
      invitation: {
        additionalFields: {
          endedAt: { type: "date", required: false, input: false, fieldName: "ended_at" },
        },
      },
    },
    // A third lock behind `disabledPaths` and the guard below: the plugin's own writes refuse.
    organizationHooks: {
      beforeCreateOrganization: async () => refuse(),
      beforeUpdateOrganization: async () => refuse(),
      beforeDeleteOrganization: async () => refuse(),
      beforeAddMember: async () => refuse(),
      beforeRemoveMember: async () => refuse(),
      beforeUpdateMemberRole: async () => refuse(),
      beforeCreateInvitation: async () => refuse(),
      beforeAcceptInvitation: async () => refuse(),
      beforeCancelInvitation: async () => refuse(),
      beforeRejectInvitation: async () => refuse(),
      beforeCreateTeam: async () => refuse(),
      beforeUpdateTeam: async () => refuse(),
      beforeDeleteTeam: async () => refuse(),
      beforeAddTeamMember: async () => refuse(),
      beforeRemoveTeamMember: async () => refuse(),
    },
  });
}

/**
 * The organization plugin's HTTP paths (better-auth 1.7.20), all unreachable. `addMember` is a
 * server-only endpoint without a path.
 */
export const CLASS_ORGANIZATION_PATHS: readonly string[] = Object.values(
  classOrganizations().endpoints,
).flatMap((endpoint) => {
  const path: unknown = Reflect.get(endpoint, "path");
  return typeof path === "string" ? [path] : [];
});

/** The refusal of deleting a user who owns a class; the Users screen translates `owns_class`. */
export const OWNS_CLASS_ERROR = "owns_class";
export const OWNS_CLASS_REFUSED = { code: "OWNS_CLASS", message: OWNS_CLASS_ERROR };

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

/**
 * Returns the guards around classes: every organization plugin path answers 404, and
 * better-auth's `admin/remove-user` refuses a user who owns a class, which would orphan it
 * (security review of #28; transferring ownership as an administrator is #37).
 */
export function classOrganizationGuard(db: Kysely<DB>) {
  return {
    id: "edulims-class-guard",
    hooks: {
      before: [
        {
          // A second lock behind `disabledPaths`, which matches the request path exactly.
          matcher: (ctx) => typeof ctx.path === "string" && ctx.path.startsWith("/organization"),
          handler: createAuthMiddleware(async () => refuse()),
        },
        {
          matcher: (ctx) => ctx.path === "/admin/remove-user",
          handler: createAuthMiddleware(async (ctx) => {
            const userId = field(ctx.body, "userId");
            if (typeof userId !== "string" || userId === "") return;
            const owned = await db
              .selectFrom("member")
              .select("organizationId")
              .where("userId", "=", userId)
              .where("role", "=", "owner")
              .limit(1)
              .executeTakeFirst();
            if (!owned) return;
            const session = await getSessionFromCtx(ctx);
            const requestId = requestIdOf(ctx);
            await auditRecorderOf(ctx.context)?.record({
              action: "user_deleted",
              actor: session ? { type: "user", id: session.user.id } : { type: "anonymous" },
              outcome: "refused",
              reason: OWNS_CLASS_ERROR,
              target: { type: "user", id: userId },
              ...(requestId ? { requestId } : {}),
            });
            throw APIError.from("FORBIDDEN", OWNS_CLASS_REFUSED);
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
