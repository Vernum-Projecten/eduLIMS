// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The vocabulary of the activity log (B4). Action names follow the OWASP Logging Vocabulary
// cheat sheet (docs/security/vendor/cheatsheets/Logging_Vocabulary_Cheat_Sheet.md). Every field
// is an id or a code: the schema has no place for a name, an e-mail address, an IP address, a
// token, a request body or a grade. Relative imports: `pnpm db:seed` loads this in plain Node.
import { z } from "zod";
import { PROVIDER_ID_PATTERN, PROVIDER_PROTOCOLS } from "../../lib/identity-providers.ts";
import { parseSignInMethod, type SignInMethod } from "../../lib/sign-in-method.ts";

/** Actions better-auth's sign-in, session and admin flows record. */
export const AUTH_AUDIT_ACTIONS = [
  "authn_login_success",
  "authn_login_fail",
  "authn_logout",
  "authz_role_change",
  "session_revoked",
  "session_expired",
  "user_created",
  "user_deleted",
  "user_banned",
  "user_unbanned",
] as const;

/** Actions reserved for eduLIMS's own flows: classes and invitations (#28), uploads (S4). */
export const EDULIMS_AUDIT_ACTIONS = [
  "class_created",
  "class_updated",
  "class_archived",
  "class_owner_changed",
  "class_deleted",
  "class_copied",
  "class_member_removed",
  "class_group_changed",
  "invitation_created",
  "invitation_accepted",
  "invitation_resent",
  "invitation_revoked",
  "upload_complete",
  "upload_validation_fail",
  "upload_delete",
  "idp_created",
  "idp_updated",
  "idp_enabled",
  "idp_disabled",
  "idp_deleted",
  "idp_secret_rotated",
  "idp_metadata_refreshed",
  "idp_tested",
  "admin_grant_created",
  "admin_grant_applied",
  "admin_grant_revoked",
] as const;

/** Actions eduLIMS records about itself, with no target: the scheduled retention prune (B4). */
export const SYSTEM_AUDIT_ACTIONS = ["sys_retention_prune"] as const;

/** Every action the activity log accepts. */
export const AUDIT_ACTIONS = [
  ...AUTH_AUDIT_ACTIONS,
  ...EDULIMS_AUDIT_ACTIONS,
  ...SYSTEM_AUDIT_ACTIONS,
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** The kinds of object an event can be about. */
export const AUDIT_TARGET_TYPES = [
  "user",
  "session",
  "class",
  "invitation",
  "upload",
  "identity_provider",
  "admin_grant",
] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

/** The target type each action is about; a `sys_` action has none. */
export type AuditTargetOf<A extends AuditAction> = A extends `sys_${string}`
  ? never
  : A extends `session_${string}`
    ? "session"
    : A extends `class_${string}`
      ? "class"
      : A extends `invitation_${string}`
        ? "invitation"
        : A extends `upload_${string}`
          ? "upload"
          : A extends `idp_${string}`
            ? "identity_provider"
            : A extends `admin_grant_${string}`
              ? "admin_grant"
              : "user";

/**
 * Returns the target type an action is about (the runtime form of {@link AuditTargetOf}), or
 * `null` for a `sys_` action, which has no target.
 */
export function targetTypeOf(action: AuditAction): AuditTargetType | null {
  if (action.startsWith("sys_")) return null;
  if (action.startsWith("session_")) return "session";
  if (action.startsWith("class_")) return "class";
  if (action.startsWith("invitation_")) return "invitation";
  if (action.startsWith("upload_")) return "upload";
  if (action.startsWith("idp_")) return "identity_provider";
  if (action.startsWith("admin_grant_")) return "admin_grant";
  return "user";
}

export const AUDIT_OUTCOMES = ["success", "failure", "refused"] as const;
/** `refused`: an access decision said no; `failure`: the action went wrong. */
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** How a user signed in: an identity provider (its provider id), or the development login. */
export type AuditProvider = SignInMethod;

/** Returns `value` when it names an {@link AuditProvider}, else `undefined`. */
export function auditProvider(value: unknown): AuditProvider | undefined {
  return parseSignInMethod(value) ?? undefined;
}

/** Who acted: a signed-in user, eduLIMS itself, or someone not signed in. */
export type AuditActor = { type: "user"; id: string } | { type: "system" } | { type: "anonymous" };

const ROLE_SET = /^(student|teacher|admin)(,(student|teacher|admin)){0,2}$/;

/**
 * The only keys an event's metadata may carry. A strict object: an unknown key, such as one that
 * would hold a name or an e-mail address, fails the parse.
 */
export const auditMetadataSchema = z.strictObject({
  roles: z.string().regex(ROLE_SET).optional(),
  previous_roles: z.string().regex(ROLE_SET).optional(),
  ban_expires_at: z.iso.datetime({ offset: true }).optional(),
  /** The identity provider an `idp_*` or `admin_grant_*` event is about. */
  provider_id: z.string().regex(PROVIDER_ID_PATTERN).optional(),
  protocol: z.enum(PROVIDER_PROTOCOLS).optional(),
  /** The names of the settings an `idp_updated` changed: never their values. */
  fields: z
    .array(z.string().regex(/^[a-z][a-z_]{0,39}$/))
    .max(40)
    .optional(),
  /**
   * The PKCE attestation: `true` on an `idp_created` that gives it, its new value on an
   * `idp_updated` that changes it.
   */
  attest_pkce: z.boolean().optional(),
  /** How many sessions an `idp_disabled` ended. */
  sessions_ended: z.number().int().min(0).optional(),
  /** The class an `invitation_*` event belongs to, or the source class of a `class_copied`. */
  class_id: z.uuid().optional(),
  /** The person a `class_member_removed` or `class_owner_changed` is about: an id only. */
  user_id: z.string().min(1).max(128).optional(),
  /** The class role an invitation or a removed member held. */
  class_role: z.enum(["owner", "teacher", "student"]).optional(),
  /** The lab group a `class_group_changed` is about. */
  team_id: z.uuid().optional(),
  /** What a `class_group_changed` did. */
  group_change: z.enum(["created", "renamed", "deleted", "members", "split", "copied"]).optional(),
  /** How many rows a bulk class action touched (groups created, students moved). */
  count: z.number().int().min(0).optional(),
  /** The outcome code of an `idp_tested` sign-in. */
  test_outcome: z
    .string()
    .regex(/^[a-z_]{1,40}$/)
    .optional(),
  /** How many rows a `sys_retention_prune` removed, per kind: counts only. */
  removed_audit_events: z.number().int().min(0).optional(),
  removed_sessions: z.number().int().min(0).optional(),
  removed_invitations: z.number().int().min(0).optional(),
  removed_admin_grants: z.number().int().min(0).optional(),
});
export type AuditMetadata = z.infer<typeof auditMetadataSchema>;

/** One activity-log event, typed by its action. */
export type AuditEvent = {
  [A in AuditAction]: {
    action: A;
    actor: AuditActor;
    outcome: AuditOutcome;
    target?: { type: AuditTargetOf<A>; id: string };
    /** A machine-readable code (`role_conflict`, `cannot_change_own_roles`). */
    reason?: string;
    provider?: AuditProvider;
    requestId?: string;
    /** Defaults to the database's `now()`. */
    occurredAt?: Date;
    metadata?: AuditMetadata;
  };
}[AuditAction];

/** The pattern of a reason code; {@link toReasonCode} maps a better-auth error code onto it. */
export const REASON_CODE = /^[a-z0-9_]{1,64}$/;

/** The pattern a request id from the reverse proxy (`X-Request-Id`) must match to be kept. */
export const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const id = z.string().min(1).max(128);

/** The runtime check of an {@link AuditEvent}; the database CHECKs hold the same rules. */
export const auditEventSchema = z
  .strictObject({
    action: z.enum(AUDIT_ACTIONS),
    actor: z.discriminatedUnion("type", [
      z.strictObject({ type: z.literal("user"), id }),
      z.strictObject({ type: z.literal("system") }),
      z.strictObject({ type: z.literal("anonymous") }),
    ]),
    outcome: z.enum(AUDIT_OUTCOMES),
    target: z.strictObject({ type: z.enum(AUDIT_TARGET_TYPES), id }).optional(),
    reason: z.string().regex(REASON_CODE).optional(),
    provider: z
      .string()
      .refine((value) => parseSignInMethod(value) !== null)
      .optional(),
    requestId: z.string().regex(REQUEST_ID).optional(),
    occurredAt: z.date().optional(),
    metadata: auditMetadataSchema.optional(),
  })
  .refine((event) => !event.target || event.target.type === targetTypeOf(event.action), {
    message: "target type does not match the action",
    path: ["target", "type"],
  });

/**
 * Returns a better-auth error code as a reason code (`INVALID_EMAIL_OR_PASSWORD` becomes
 * `invalid_email_or_password`), or `undefined` when nothing usable is left.
 */
export function toReasonCode(code: unknown): string | undefined {
  if (typeof code !== "string") return undefined;
  const reason = code
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return REASON_CODE.test(reason) ? reason : undefined;
}

/** Returns a request id from the reverse proxy when it has the expected shape, else `undefined`. */
export function toRequestId(value: string | null | undefined): string | undefined {
  return value && REQUEST_ID.test(value) ? value : undefined;
}
