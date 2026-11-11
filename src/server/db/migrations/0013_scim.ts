// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// SCIM 2.0 provisioning (#45, ADR 0017): the scim plugin's own tables in the camelCase form of
// 0001_auth (one connection per identity provider, its id the provider id), eduLIMS's bearer
// tokens per provider (stored as SHA-256 digests only), the claim that carries the directory's
// `externalId` at sign-in, and who provisioned a user and when the directory deactivated them.
import { type Kysely, type SchemaModule, sql } from "kysely";

type Column = [name: string, type: "text" | "integer" | "boolean" | "timestamptz", flags?: string];

/**
 * Creates one plugin table: `req` is NOT NULL, `uniq` UNIQUE, `idx` an index, `user` and
 * `scimUser`/`scimGroup` a cascading foreign key, `zero`/`active` a default.
 */
async function pluginTable(schema: SchemaModule, table: string, columns: readonly Column[]) {
  let builder = schema.createTable(table).addColumn("id", "text", (col) => col.primaryKey());
  for (const [name, type, flags = ""] of columns) {
    const has = (flag: string) => flags.split(" ").includes(flag);
    builder = builder.addColumn(name, type, (col) => {
      let c = col;
      if (has("req")) c = c.notNull();
      if (has("uniq")) c = c.unique();
      if (has("zero")) c = c.defaultTo(0);
      if (has("active")) c = c.defaultTo("active");
      if (has("user")) c = c.references("user.id").onDelete("cascade");
      if (has("scimUser")) c = c.references("scimUser.id").onDelete("cascade");
      if (has("scimGroup")) c = c.references("scimGroup.id").onDelete("cascade");
      return c;
    });
  }
  await builder.execute();
  for (const [name, , flags = ""] of columns) {
    if (!flags.split(" ").includes("idx")) continue;
    await schema.createIndex(`${table}_${name}_idx`).on(table).column(name).execute();
  }
}

const SCOPE: readonly Column[] = [
  ["connectionId", "text", "req idx"],
  ["provisioningDomainId", "text", "req idx"],
];

export async function up(db: Kysely<unknown>): Promise<void> {
  await pluginTable(db.schema, "scimConnectionBinding", [
    ["connectionId", "text", "req idx"],
    ["connectionKey", "text", "req uniq"],
    ["provisioningDomainId", "text", "req"],
    ["createdAt", "timestamptz", "req"],
    ["decommissionedAt", "timestamptz"],
    ["decommissionStatus", "text", "req active"],
    ["decommissionCursorUserId", "text"],
    ["decommissionReconciledUserCount", "integer", "req zero"],
    ["decommissionBatchCount", "integer", "req zero"],
    ["decommissionRevision", "integer", "req zero"],
    ["decommissionCompletedAt", "timestamptz"],
    ["decommissionLeaseId", "text"],
    ["decommissionLeaseExpiresAt", "timestamptz"],
  ]);
  await pluginTable(db.schema, "scimIdentityTombstone", [
    ...SCOPE,
    ["externalId", "text", "req"],
    ["externalIdKey", "text", "req uniq"],
    ["userId", "text", "req idx user"],
    ["profile", "text", "req"],
    ["deletedAt", "timestamptz", "req"],
  ]);
  await pluginTable(db.schema, "scimSubject", [
    ["userId", "text", "req uniq user"],
    ["profileSourceId", "text", "idx"],
    ["revision", "integer", "req"],
    ["createdAt", "timestamptz", "req"],
    ["updatedAt", "timestamptz", "req"],
  ]);
  await pluginTable(db.schema, "scimUser", [
    ...SCOPE,
    ["userId", "text", "req idx user"],
    ["connectionUserKey", "text", "req uniq"],
    ["userName", "text", "req"],
    ["userNameKey", "text", "req uniq"],
    ["primaryEmail", "text", "req"],
    ["workEmailValueIndex", "text", "req"],
    ["emailValueIndex", "text", "req"],
    ["displayName", "text", "req"],
    ["formattedName", "text", "req"],
    ["givenName", "text"],
    ["familyName", "text"],
    ["serializedEmails", "text", "req"],
    ["serializedAttributes", "text"],
    ["externalId", "text"],
    ["externalIdKey", "text", "uniq"],
    ["active", "boolean", "req"],
    ["orderKey", "text", "req uniq"],
    ["createdAt", "timestamptz", "req"],
    ["updatedAt", "timestamptz", "req"],
  ]);
  await pluginTable(db.schema, "scimProjectionGrant", [
    ...SCOPE,
    ["scimUserId", "text", "req idx scimUser"],
    ["userId", "text", "req idx user"],
    ["sourceKind", "text", "req"],
    ["sourceId", "text", "req"],
    ["sourceValue", "text"],
    ["role", "text", "req"],
    ["grantKey", "text", "req uniq"],
    ["createdAt", "timestamptz", "req"],
    ["updatedAt", "timestamptz", "req"],
  ]);
  await pluginTable(db.schema, "scimGroup", [
    ...SCOPE,
    ["revision", "integer", "req zero"],
    ["displayName", "text", "req"],
    ["displayNameKey", "text", "req uniq"],
    ["externalId", "text"],
    ["externalIdKey", "text", "uniq"],
    ["orderKey", "text", "req uniq"],
    ["createdAt", "timestamptz", "req"],
    ["updatedAt", "timestamptz", "req"],
  ]);
  await pluginTable(db.schema, "scimGroupMember", [
    ["connectionId", "text", "req idx"],
    ["groupId", "text", "req idx scimGroup"],
    ["scimUserId", "text", "req idx scimUser"],
    ["membershipKey", "text", "req uniq"],
    ["createdAt", "timestamptz", "req"],
  ]);

  // NOTE: ASVS V6.4.1 and V13.3.1; a token is 256 random bits, so a SHA-256 digest is enough
  // at rest and the plaintext exists only in the response that shows it once.
  await db.schema
    .createTable("scim_token")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("provider_id", "text", (col) =>
      col.notNull().references("identity_provider.provider_id").onDelete("cascade"),
    )
    .addColumn("token_hash", "text", (col) => col.notNull().unique())
    .addColumn("created_by", "text", (col) => col.references("user.id").onDelete("set null"))
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("last_used_at", "timestamptz")
    // Set when a rotation replaced the token; it then works until its (shortened) expiry.
    .addColumn("superseded_at", "timestamptz")
    .addColumn("revoked_at", "timestamptz")
    .addColumn("revoked_by", "text", (col) => col.references("user.id").onDelete("set null"))
    .addCheckConstraint("scim_token_hash_form", sql`token_hash ~ '^[0-9a-f]{64}$'`)
    .addCheckConstraint("scim_token_expires_after_created", sql`expires_at > created_at`)
    .addCheckConstraint(
      "scim_token_revoked_after_created",
      sql`revoked_at is null or revoked_at >= created_at`,
    )
    .addCheckConstraint(
      "scim_token_superseded_after_created",
      sql`superseded_at is null or superseded_at >= created_at`,
    )
    .execute();
  // One current token per provider; a superseded one may overlap it until it expires.
  await db.schema
    .createIndex("scim_token_one_current_idx")
    .on("scim_token")
    .column("provider_id")
    .unique()
    .where(sql<boolean>`revoked_at is null and superseded_at is null`)
    .execute();

  // Where the directory's `externalId` sits in a sign-in: an ID-token claim (OIDC) or an
  // assertion attribute (SAML); null means the account key itself (`sub` or the NameID).
  await db.schema
    .alterTable("identity_provider")
    .addColumn("scim_external_id_claim", "text", (col) =>
      col.check(
        sql`scim_external_id_claim is null or scim_external_id_claim in ('oid', 'sub', 'objectGUID')`,
      ),
    )
    .execute();

  await db.schema
    .alterTable("user")
    .addColumn("provisioned_by", "text", (col) =>
      col.references("identity_provider.provider_id").onDelete("set null"),
    )
    .addColumn("deprovisioned_at", "timestamptz")
    // Which channel wrote the role set (B1, V8.2.1): an ID-token claim, SCIM, or eduLIMS. Only
    // `scim` survives a sign-in without a mapped claim; a local set is always `local`.
    .addColumn("role_channel", "text", (col) =>
      col.notNull().defaultTo("local").check(sql`role_channel in ('claim', 'scim', 'local')`),
    )
    .execute();
  // A set a provider wrote before the channel existed came from its ID-token claim.
  await sql`update "user" set role_channel = 'claim' where role_source <> 'local'`.execute(db);
  await db.schema
    .alterTable("user")
    .addCheckConstraint(
      "user_role_channel_source",
      sql`role_source <> 'local' or role_channel = 'local'`,
    )
    .execute();

  // The directory id a sign-in carried (the provider's configured external-id claim, else the
  // account key), so SCIM links an existing user on it instead of creating a second one.
  await db.schema.alterTable("account").addColumn("directory_id", "text").execute();
  await db.schema
    .createIndex("account_provider_directory_id_idx")
    .on("account")
    .columns(["providerId", "directory_id"])
    .unique()
    .where(sql.ref("directory_id"), "is not", null)
    .execute();
}

// NOTE: no requirement governs this: our own design. Reverting drops every provisioned
// directory record, every SCIM token and the deactivation state of every user.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("account_provider_directory_id_idx").execute();
  await db.schema.alterTable("account").dropColumn("directory_id").execute();
  await db.schema.alterTable("user").dropConstraint("user_role_channel_source").execute();
  await db.schema
    .alterTable("user")
    .dropColumn("role_channel")
    .dropColumn("deprovisioned_at")
    .dropColumn("provisioned_by")
    .execute();
  await db.schema.alterTable("identity_provider").dropColumn("scim_external_id_claim").execute();
  await db.schema.dropTable("scim_token").execute();
  for (const table of [
    "scimGroupMember",
    "scimGroup",
    "scimProjectionGrant",
    "scimUser",
    "scimSubject",
    "scimIdentityTombstone",
    "scimConnectionBinding",
  ]) {
    await db.schema.dropTable(table).execute();
  }
}
