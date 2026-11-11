// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Runtime identity providers (#46, ADR 0015): the sso plugin's `ssoProvider` table in the
// camelCase form of 0001_auth (its config JSON holds secrets only as AES-256-GCM envelopes,
// src/server/idp/crypto.ts), eduLIMS's own settings per provider, their email domains, and the
// pending admin grants of `pnpm admin:grant` (#48). The provider id becomes the role source and
// the sign-in method, so those checks and the activity log's take the slug instead of a list.
import { type Kysely, sql } from "kysely";

const SLUG = "^[a-z][a-z0-9-]{1,39}$";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("ssoProvider")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("issuer", "text", (col) => col.notNull())
    .addColumn("oidcConfig", "text")
    .addColumn("samlConfig", "text")
    // NOTE: #46; providers outlive the administrator who added them, and the CLI adds them with
    // no user at all, so the creator is optional and never deletes the row.
    .addColumn("userId", "text", (col) => col.references("user.id").onDelete("set null"))
    .addColumn("providerId", "text", (col) => col.notNull().unique())
    .addColumn("organizationId", "text")
    .addColumn("domain", "text", (col) => col.notNull())
    .addCheckConstraint("ssoProvider_providerId_slug", sql`"providerId" ~ ${sql.lit(SLUG)}`)
    .addCheckConstraint("ssoProvider_no_organization", sql`"organizationId" is null`)
    .addCheckConstraint(
      "ssoProvider_one_protocol",
      sql`("oidcConfig" is null) <> ("samlConfig" is null)`,
    )
    .execute();

  // TODO(#45): the SCIM connection id, the external-id claim and the role source per provider
  // (claims or SCIM groups) join this table.
  await db.schema
    .createTable("identity_provider")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("provider_id", "text", (col) =>
      col.notNull().unique().references("ssoProvider.providerId").onDelete("cascade"),
    )
    .addColumn("protocol", "text", (col) => col.notNull())
    .addColumn("enabled", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("label_en", "text", (col) => col.notNull())
    .addColumn("label_nl", "text", (col) => col.notNull())
    .addColumn("icon", "text", (col) => col.notNull().defaultTo("key-round"))
    .addColumn("sort_order", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("role_claim", "text", (col) => col.notNull())
    .addColumn("role_map", "jsonb", (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn("default_role", "text")
    .addColumn("email_authoritative", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("end_session_endpoint", "text")
    .addColumn("metadata_url", "text")
    .addColumn("created_by", "text")
    .addColumn("updated_by", "text")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      "identity_provider_reserved_id",
      sql`provider_id not in ('local', 'credential')`,
    )
    .addCheckConstraint("identity_provider_protocol", sql`protocol in ('oidc', 'saml')`)
    .addCheckConstraint(
      "identity_provider_labels",
      sql`length(label_en) between 1 and 60 and length(label_nl) between 1 and 60`,
    )
    .addCheckConstraint(
      "identity_provider_icon",
      sql`icon in ('key-round', 'building', 'school', 'shield', 'globe')`,
    )
    .addCheckConstraint("identity_provider_role_claim", sql`length(role_claim) between 1 and 200`)
    .addCheckConstraint(
      "identity_provider_role_map",
      sql`jsonb_typeof(role_map) = 'object' and not jsonb_path_exists(role_map, '$.* ? (@ != "student" && @ != "teacher" && @ != "admin")')`,
    )
    .addCheckConstraint(
      "identity_provider_default_role",
      sql`default_role is null or default_role in ('student', 'teacher', 'admin')`,
    )
    .addCheckConstraint(
      "identity_provider_end_session",
      sql`end_session_endpoint is null or (protocol = 'oidc' and end_session_endpoint ~ '^https?://')`,
    )
    .addCheckConstraint(
      "identity_provider_metadata_url",
      sql`metadata_url is null or (protocol = 'saml' and metadata_url ~ '^https?://')`,
    )
    .execute();

  await db.schema
    .createTable("identity_provider_domain")
    .addColumn("domain", "text", (col) => col.primaryKey())
    .addColumn("provider_id", "text", (col) =>
      col.notNull().references("identity_provider.provider_id").onDelete("cascade"),
    )
    .addCheckConstraint(
      "identity_provider_domain_form",
      sql`domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'`,
    )
    .execute();
  await db.schema
    .createIndex("identity_provider_domain_provider_id_idx")
    .on("identity_provider_domain")
    .column("provider_id")
    .execute();

  await db.schema
    .createTable("pending_admin_grant")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("email", "text", (col) => col.notNull().unique())
    .addColumn("provider_id", "text", (col) =>
      col.notNull().references("identity_provider.provider_id").onDelete("cascade"),
    )
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .addCheckConstraint("pending_admin_grant_email", sql`email = lower(email) and email like '%@%'`)
    .addCheckConstraint("pending_admin_grant_expiry", sql`expires_at > created_at`)
    .execute();

  await db.schema.alterTable("user").dropConstraint("user_role_source_check").execute();
  await db.schema.alterTable("user").dropConstraint("user_last_login_method_check").execute();
  await db.schema
    .alterTable("user")
    .addCheckConstraint(
      "user_role_source_check",
      sql`role_source = 'local' or (role_source ~ ${sql.lit(SLUG)} and role_source <> 'credential')`,
    )
    .execute();
  await db.schema
    .alterTable("user")
    .addCheckConstraint(
      "user_last_login_method_check",
      sql`last_login_method is null or (last_login_method ~ ${sql.lit(SLUG)} and last_login_method <> 'local')`,
    )
    .execute();
  await db.schema.alterTable("audit_event").dropConstraint("audit_event_provider").execute();
  await db.schema
    .alterTable("audit_event")
    .addCheckConstraint(
      "audit_event_provider",
      sql`provider is null or (provider ~ ${sql.lit(SLUG)} and provider <> 'local')`,
    )
    .execute();
}

// NOTE: no requirement governs this: our own design. Reverting drops every identity provider,
// its domains and the pending admin grants, and fails while rows name a provider outside the
// old fixed list.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("audit_event").dropConstraint("audit_event_provider").execute();
  await db.schema
    .alterTable("audit_event")
    .addCheckConstraint(
      "audit_event_provider",
      sql`provider is null or provider in ('microsoft', 'keycloak', 'credential')`,
    )
    .execute();
  await db.schema.alterTable("user").dropConstraint("user_last_login_method_check").execute();
  await db.schema.alterTable("user").dropConstraint("user_role_source_check").execute();
  await db.schema
    .alterTable("user")
    .addCheckConstraint(
      "user_role_source_check",
      sql`"role_source" in ('local', 'microsoft', 'keycloak')`,
    )
    .execute();
  await db.schema
    .alterTable("user")
    .addCheckConstraint(
      "user_last_login_method_check",
      sql`"last_login_method" in ('microsoft', 'keycloak', 'credential')`,
    )
    .execute();
  await db.schema.dropTable("pending_admin_grant").execute();
  await db.schema.dropTable("identity_provider_domain").execute();
  await db.schema.dropTable("identity_provider").execute();
  await db.schema.dropTable("ssoProvider").execute();
}
