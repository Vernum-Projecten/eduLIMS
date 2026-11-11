// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Display names for the values the Users screen (#34) shows: role sources, sign-in methods,
// statuses, activity-log codes and the refusals of the admin actions.
import { m } from "@/i18n/messages";
import { getLocale } from "@/i18n/runtime";
import { LOCAL_ROLE_SOURCE, type RoleSource } from "@/lib/role-source";
import { CREDENTIAL_SIGN_IN, type SignInMethod } from "@/lib/sign-in-method";

/** Provider ids with their display names, as the Users screen's server functions return them. */
export type ProviderLabels = Readonly<Record<string, string>>;

/** Returns where a role set comes from: an identity provider's label, or eduLIMS itself. */
export function roleSourceLabel(source: RoleSource | null, labels: ProviderLabels = {}): string {
  if (source === null) return m.role_source_unknown();
  if (source === LOCAL_ROLE_SOURCE) return m.role_source_local();
  return labels[source] ?? source;
}

/** Returns the name of a sign-in method: an identity provider's label, or the test account. */
export function signInMethodLabel(method: SignInMethod, labels: ProviderLabels = {}): string {
  if (method === CREDENTIAL_SIGN_IN) return m.sign_in_method_credential();
  return labels[method] ?? method;
}

/** The user statuses the table shows. */
export type UserStatusValue = "active" | "blocked" | "never";

/** Returns the name of a user status. */
export function userStatusLabel(status: UserStatusValue): string {
  switch (status) {
    case "active":
      return m.admin_users_status_active();
    case "blocked":
      return m.admin_users_status_blocked();
    case "never":
      return m.admin_users_status_never();
    default: {
      const unknown: never = status;
      return unknown;
    }
  }
}

const ACTION_LABELS: Readonly<Record<string, () => string>> = {
  authn_login_success: m.audit_action_login_success,
  authn_login_fail: m.audit_action_login_fail,
  authn_logout: m.audit_action_logout,
  authz_role_change: m.audit_action_role_change,
  session_revoked: m.audit_action_session_revoked,
  session_expired: m.audit_action_session_expired,
  user_created: m.audit_action_user_created,
  user_deleted: m.audit_action_user_deleted,
  user_banned: m.audit_action_user_banned,
  user_unbanned: m.audit_action_user_unbanned,
  idp_created: m.audit_action_idp_created,
  idp_updated: m.audit_action_idp_updated,
  idp_enabled: m.audit_action_idp_enabled,
  idp_disabled: m.audit_action_idp_disabled,
  idp_deleted: m.audit_action_idp_deleted,
  idp_secret_rotated: m.audit_action_idp_secret_rotated,
  idp_metadata_refreshed: m.audit_action_idp_metadata_refreshed,
  idp_tested: m.audit_action_idp_tested,
  admin_grant_created: m.audit_action_admin_grant_created,
  admin_grant_applied: m.audit_action_admin_grant_applied,
  admin_grant_revoked: m.audit_action_admin_grant_revoked,
  sys_retention_prune: m.audit_action_retention_prune,
  user_deprovisioned: m.audit_action_user_deprovisioned,
  user_reprovisioned: m.audit_action_user_reprovisioned,
  scim_token_created: m.audit_action_scim_token_created,
  scim_token_rotated: m.audit_action_scim_token_rotated,
  scim_token_revoked: m.audit_action_scim_token_revoked,
  scim_token_refused: m.audit_action_scim_token_refused,
  scim_user_created: m.audit_action_scim_user_created,
  scim_user_updated: m.audit_action_scim_user_updated,
  scim_user_deleted: m.audit_action_scim_user_deleted,
  scim_group_created: m.audit_action_scim_group_created,
  scim_group_updated: m.audit_action_scim_group_updated,
  scim_group_deleted: m.audit_action_scim_group_deleted,
};

/** Returns the name of an activity-log action; an action the screen does not know is "Other". */
export function auditActionLabel(action: string): string {
  return Object.hasOwn(ACTION_LABELS, action)
    ? (ACTION_LABELS[action]?.() ?? m.audit_action_other())
    : m.audit_action_other();
}

/** Returns the name of an activity-log outcome. */
export function auditOutcomeLabel(outcome: string): string {
  if (outcome === "success") return m.audit_outcome_success();
  if (outcome === "refused") return m.audit_outcome_refused();
  return m.audit_outcome_failure();
}

/** Returns who acted on an activity-log event, as the user detail sheet says it. */
export function auditActorLabel(actor: "self" | "user" | "system" | "anonymous"): string {
  switch (actor) {
    case "self":
      return m.audit_actor_self();
    case "user":
      return m.audit_actor_user();
    case "system":
      return m.audit_actor_system();
    case "anonymous":
      return m.audit_actor_anonymous();
    default: {
      const unknown: never = actor;
      return unknown;
    }
  }
}

/** Returns the refusal message of an admin action from its error code. */
export function adminActionErrorMessage(code: string): string {
  switch (code) {
    case "not_found":
      return m.admin_users_error_not_found();
    case "session_not_found":
      return m.admin_users_error_session_not_found();
    case "cannot_block_self":
      return m.admin_users_error_block_self();
    case "cannot_end_current_session":
      return m.admin_users_error_current_session();
    case "cannot_change_own_roles":
      return m.role_error_own_roles();
    case "roles_not_local":
      return m.admin_users_error_roles_not_local();
    case "role_set_not_allowed":
      return m.role_error_not_allowed();
    default:
      return m.admin_users_error_failed();
  }
}

/** Returns the name of a language in the active locale ("Dutch", "Nederlands"). */
export function languageLabel(locale: string): string {
  try {
    return new Intl.DisplayNames([getLocale()], { type: "language" }).of(locale) ?? locale;
  } catch {
    return locale;
  }
}
