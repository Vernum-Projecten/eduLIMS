// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The vocabulary of the activity log (B4). Action names follow the OWASP Logging Vocabulary
// cheat sheet (docs/security/vendor/cheatsheets/Logging_Vocabulary_Cheat_Sheet.md). Every field
// is an id or a code: the schema has no place for a name, an e-mail address, an IP address, a
// token, a request body or a grade. Relative imports: `pnpm db:seed` loads this in plain Node.
import { z } from "zod";

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
  "invitation_created",
  "invitation_accepted",
  "invitation_revoked",
  "upload_complete",
  "upload_validation_fail",
  "upload_delete",
] as const;

/** Every action the activity log accepts. */
export const AUDIT_ACTIONS = [...AUTH_AUDIT_ACTIONS, ...EDULIMS_AUDIT_ACTIONS] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** The kinds of object an event can be about. */
export const AUDIT_TARGET_TYPES = ["user", "session", "class", "invitation", "upload"] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

/** The target type each action is about. */
export type AuditTargetOf<A extends AuditAction> = A extends `session_${string}`
  ? "session"
  : A extends `class_${string}`
    ? "class"
    : A extends `invitation_${string}`
      ? "invitation"
      : A extends `upload_${string}`
        ? "upload"
        : "user";

/** Returns the target type an action is about (the runtime form of {@link AuditTargetOf}). */
export function targetTypeOf(action: AuditAction): AuditTargetType {
  if (action.startsWith("session_")) return "session";
  if (action.startsWith("class_")) return "class";
  if (action.startsWith("invitation_")) return "invitation";
  if (action.startsWith("upload_")) return "upload";
  return "user";
}

export const AUDIT_OUTCOMES = ["success", "failure", "refused"] as const;
/** `refused`: an access decision said no; `failure`: the action went wrong. */
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const AUDIT_PROVIDERS = ["microsoft", "keycloak", "credential"] as const;
/** How a user signed in: Entra ID, Keycloak, or the development login. */
export type AuditProvider = (typeof AUDIT_PROVIDERS)[number];

/** Returns `value` when it names an {@link AuditProvider}, else `undefined`. */
export function auditProvider(value: unknown): AuditProvider | undefined {
  return AUDIT_PROVIDERS.find((provider) => provider === value);
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
    provider: z.enum(AUDIT_PROVIDERS).optional(),
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
