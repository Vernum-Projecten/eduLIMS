// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Display text for the activity log screen (#36, B4): outcomes, actors and targets, reason
// codes, and the metadata of an event as readable, translated parts. The log holds codes; this
// is the one place they become words.
import { m } from "@/i18n/messages";
import { isClassRole } from "@/lib/classes";
import { analyserStatusLabel } from "@/lib/i18n/analyser-labels";
import { classRoleLabel } from "@/lib/i18n/class-labels";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import { rolesLabel } from "@/lib/i18n/labels";
import { type ProviderLabels, signInMethodLabel } from "@/lib/i18n/user-labels";
import { isRole, type Role } from "@/lib/roles";
import type {
  AuditMetadata,
  AuditOutcome,
  AuditProvider,
  AuditTargetType,
} from "@/server/audit/events";

/** Returns the name of an outcome as the activity table's status shows it ("Succeeded"). */
export function activityOutcomeLabel(outcome: AuditOutcome): string {
  switch (outcome) {
    case "success":
      return m.admin_activity_outcome_success();
    case "failure":
      return m.admin_activity_outcome_failure();
    case "refused":
      return m.admin_activity_outcome_refused();
    default: {
      const unknown: never = outcome;
      return unknown;
    }
  }
}

/** Returns the name of who acted when it was not a user: eduLIMS itself, or someone not signed in. */
export function activityNonUserActorLabel(actor: "system" | "anonymous"): string {
  return actor === "system" ? m.admin_activity_actor_system() : m.admin_activity_actor_anonymous();
}

/** An object an event is about, other than a user. */
export interface ActivityObjectTarget {
  type: Exclude<AuditTargetType, "user">;
  id: string;
}

/**
 * Returns what a non-user target is: its kind, and for an identity provider its name from
 * `labels` (its id when it has none, such as a deleted provider).
 */
export function activityTargetLabel(
  target: ActivityObjectTarget,
  labels: ProviderLabels = {},
): string {
  switch (target.type) {
    case "session":
      return m.admin_activity_target_session();
    case "class":
      return m.admin_activity_target_class();
    case "invitation":
      return m.admin_activity_target_invitation();
    case "upload":
      return m.admin_activity_target_upload();
    case "identity_provider":
      return m.admin_activity_target_identity_provider({ name: labels[target.id] ?? target.id });
    case "admin_grant":
      return m.admin_activity_target_admin_grant();
    case "analyser":
      return m.admin_activity_target_analyser();
    case "scim_user":
      return m.admin_activity_target_scim_user();
    case "scim_group":
      return m.admin_activity_target_scim_group();
    default: {
      const unknown: never = target.type;
      return unknown;
    }
  }
}

const REASON_LABELS: Readonly<Record<string, () => string>> = {
  access_denied: m.admin_activity_reason_access_denied,
  account_deprovisioned: m.admin_activity_reason_account_deprovisioned,
  address_domain: m.admin_activity_reason_address_domain,
  http_404: m.admin_activity_reason_not_found,
  provider_disabled: m.admin_activity_reason_provider_disabled,
  token_expired: m.admin_activity_reason_token_expired,
  token_missing: m.admin_activity_reason_token_missing,
  token_refused: m.admin_activity_reason_token_refused,
  token_revoked: m.admin_activity_reason_token_revoked,
  token_unknown: m.admin_activity_reason_token_unknown,
  uniqueness: m.admin_activity_reason_uniqueness,
  user_deprovisioned: m.admin_activity_reason_user_deprovisioned,
  admin_grant: m.admin_activity_reason_admin_grant,
  admin_grant_override: m.admin_activity_reason_admin_grant_override,
  admin_revoke: m.admin_activity_reason_admin_revoke,
  archived: m.admin_activity_reason_class_archived,
  banned_user: m.admin_activity_reason_banned_user,
  cannot_change_own_roles: m.admin_activity_reason_own_roles,
  forbidden: m.admin_activity_reason_class_forbidden,
  has_work: m.admin_activity_reason_class_has_work,
  invalid_code: m.admin_activity_reason_invalid_code,
  invalid_email_or_password: m.admin_activity_reason_invalid_password,
  no_edulims_role: m.admin_activity_reason_no_role,
  owns_class: m.admin_activity_reason_owns_class,
  role_conflict: m.admin_activity_reason_role_conflict,
  roles_not_local: m.admin_activity_reason_roles_not_local,
  sign_in_refused: m.admin_activity_reason_sign_in_refused,
  state_not_found: m.admin_activity_reason_state_not_found,
  user_banned: m.admin_activity_reason_user_banned,
  user_deleted: m.admin_activity_reason_user_deleted,
};

/**
 * Returns the reason of an event in words. A code this version has no words for is shown as the
 * code itself, labelled as one, so nothing the log holds is hidden.
 */
export function activityReasonLabel(code: string): string {
  const label = Object.hasOwn(REASON_LABELS, code) ? REASON_LABELS[code] : undefined;
  return label ? label() : m.admin_activity_reason_code({ code });
}

/** Returns the result of an identity provider's test sign-in in words. */
export function activityTestOutcomeLabel(outcome: string): string {
  if (outcome === "roles") return m.admin_activity_test_roles();
  if (outcome === "local") return m.admin_activity_test_local();
  if (outcome === "default") return m.admin_activity_test_default();
  return activityReasonLabel(outcome);
}

function roleList(value: string): Role[] {
  return value.split(",").filter(isRole);
}

/** Returns what a `class_group_changed` did to the lab groups, in words. */
export function groupChangeLabel(change: NonNullable<AuditMetadata["group_change"]>): string {
  switch (change) {
    case "created":
      return m.admin_activity_group_created();
    case "renamed":
      return m.admin_activity_group_renamed();
    case "deleted":
      return m.admin_activity_group_deleted();
    case "members":
      return m.admin_activity_group_members();
    case "split":
      return m.admin_activity_group_split();
    case "copied":
      return m.admin_activity_group_copied();
    default: {
      const unknown: never = change;
      return unknown;
    }
  }
}

/** The class parts of an event's metadata (#28): ids as ids, codes in words. */
function classParts(metadata: AuditMetadata): string[] {
  const parts: string[] = [];
  if (metadata.class_id) parts.push(m.admin_activity_detail_class({ id: metadata.class_id }));
  if (metadata.class_role && isClassRole(metadata.class_role)) {
    parts.push(m.admin_activity_detail_class_role({ role: classRoleLabel(metadata.class_role) }));
  }
  if (metadata.user_id) parts.push(m.admin_activity_detail_person({ id: metadata.user_id }));
  if (metadata.group_change) {
    parts.push(
      m.admin_activity_detail_group_change({ change: groupChangeLabel(metadata.group_change) }),
    );
  }
  if (metadata.team_id) parts.push(m.admin_activity_detail_lab_group({ id: metadata.team_id }));
  if (metadata.count !== undefined) {
    parts.push(m.admin_activity_detail_count({ count: formatNumber(metadata.count) }));
  }
  return parts;
}

function metadataParts(metadata: AuditMetadata, labels: ProviderLabels): string[] {
  const parts: string[] = [];
  if (metadata.provider_id) {
    const name = labels[metadata.provider_id] ?? metadata.provider_id;
    parts.push(m.admin_activity_detail_identity_provider({ name }));
  }
  if (metadata.protocol) {
    parts.push(m.admin_activity_detail_protocol({ protocol: metadata.protocol.toUpperCase() }));
  }
  if (metadata.roles) {
    parts.push(m.admin_activity_detail_roles({ roles: rolesLabel(roleList(metadata.roles)) }));
  }
  if (metadata.previous_roles) {
    const roles = rolesLabel(roleList(metadata.previous_roles));
    parts.push(m.admin_activity_detail_previous_roles({ roles }));
  }
  if (metadata.ban_expires_at) {
    const date = formatDateTime(metadata.ban_expires_at);
    parts.push(m.admin_activity_detail_ban_until({ date }));
  }
  if (metadata.fields && metadata.fields.length > 0) {
    parts.push(m.admin_activity_detail_fields({ fields: metadata.fields.join(", ") }));
  }
  if (metadata.attest_pkce !== undefined) {
    parts.push(
      metadata.attest_pkce
        ? m.admin_activity_detail_pkce_attested()
        : m.admin_activity_detail_pkce_not_attested(),
    );
  }
  if (metadata.sessions_ended !== undefined) {
    const count = formatNumber(metadata.sessions_ended);
    parts.push(m.admin_activity_detail_sessions_ended({ count }));
  }
  if (metadata.test_outcome) {
    const result = activityTestOutcomeLabel(metadata.test_outcome);
    parts.push(m.admin_activity_detail_test_outcome({ result }));
  }
  if (metadata.analyser_status) {
    const status = analyserStatusLabel(metadata.analyser_status);
    parts.push(m.admin_activity_detail_analyser_status({ status }));
  }
  parts.push(...classParts(metadata));
  if (metadata.token_expires_at) {
    const date = formatDateTime(metadata.token_expires_at);
    parts.push(m.admin_activity_detail_token_expires({ date }));
  }
  if (metadata.previous_token_valid_until) {
    const date = formatDateTime(metadata.previous_token_valid_until);
    parts.push(m.admin_activity_detail_previous_token_until({ date }));
  }
  if (metadata.refused_count !== undefined) {
    const count = formatNumber(metadata.refused_count);
    parts.push(m.admin_activity_detail_refused_count({ count }));
  }
  const removed = [
    [metadata.removed_audit_events, m.admin_activity_detail_removed_events],
    [metadata.removed_sessions, m.admin_activity_detail_removed_sessions],
    [metadata.removed_invitations, m.admin_activity_detail_removed_invitations],
    [metadata.removed_admin_grants, m.admin_activity_detail_removed_grants],
    [metadata.resealed_providers, m.admin_activity_detail_resealed_providers],
    [metadata.resealed_id_tokens, m.admin_activity_detail_resealed_id_tokens],
  ] as const;
  for (const [value, message] of removed) {
    if (value !== undefined) parts.push(message({ count: formatNumber(value) }));
  }
  return parts;
}

/** What an event's details column shows: the reason, the sign-in method and the metadata. */
export interface ActivityDetailsSource {
  reason: string | null;
  provider: AuditProvider | null;
  metadata: AuditMetadata | "unreadable" | null;
}

/**
 * Returns the details of an event as short translated sentences, in a fixed order. `labels`
 * names the identity providers (ADR 0015); a provider without one shows its id.
 */
export function activityDetails(
  event: ActivityDetailsSource,
  labels: ProviderLabels = {},
): string[] {
  const parts: string[] = [];
  if (event.reason) {
    parts.push(m.admin_activity_detail_reason({ reason: activityReasonLabel(event.reason) }));
  }
  if (event.provider) {
    const provider = signInMethodLabel(event.provider, labels);
    parts.push(m.admin_activity_detail_provider({ provider }));
  }
  if (event.metadata === "unreadable") parts.push(m.admin_activity_detail_unreadable());
  else if (event.metadata) parts.push(...metadataParts(event.metadata, labels));
  return parts;
}
