// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// better-auth's organization plugin, set up for classes (#28, ADR 0017): it owns the schema, the
// class roles' access control and the ids; eduLIMS's class service (src/server/classes/) does
// every write, in one transaction with its activity-log row. The plugin's HTTP endpoints stay
// unreachable, as the sso plugin's management endpoints do (ADR 0015).
// Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { organization } from "better-auth/plugins";
import { classAccessControl, classRoles } from "../../lib/classes.ts";

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
          academicYear: { type: "string", required: true, fieldName: "academic_year" },
          archivedAt: { type: "date", required: false, input: false, fieldName: "archived_at" },
        },
      },
      team: {
        additionalFields: {
          groupSet: { type: "string", required: true, fieldName: "group_set" },
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

/** Returns the guard that answers every organization plugin path with 404. */
export function classOrganizationGuard() {
  return {
    id: "edulims-class-guard",
    hooks: {
      before: [
        {
          // A second lock behind `disabledPaths`, which matches the request path exactly.
          matcher: (ctx) => typeof ctx.path === "string" && ctx.path.startsWith("/organization"),
          handler: createAuthMiddleware(async () => refuse()),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
