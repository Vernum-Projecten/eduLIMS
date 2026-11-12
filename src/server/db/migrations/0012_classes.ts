// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Classes and lab groups (#28, B2, D2, ADR 0018): better-auth's organization plugin tables in
// the camelCase form of 0001_auth, with eduLIMS's own fields in snake_case. A class is an
// `organization` whose slug is its id; a lab group is a `team` in a named group set. Ids are
// UUIDv7 text from the one generator of src/server/db/ids.ts.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("organization")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("slug", "text", (col) => col.notNull().unique())
    .addColumn("logo", "text")
    .addColumn("createdAt", "timestamptz", (col) => col.notNull())
    .addColumn("metadata", "text")
    .addColumn("academic_year", "text", (col) => col.notNull())
    .addColumn("archived_at", "timestamptz")
    // NOTE: owner decision on #28; the id is the identity and the slug, never the name.
    .addCheckConstraint("organization_slug_is_id", sql`slug = id`)
    .addCheckConstraint(
      "organization_name",
      sql`length(name) between 1 and 100 and name = btrim(name)`,
    )
    .addCheckConstraint(
      "organization_academic_year",
      sql`academic_year ~ '^[0-9]{4}-[0-9]{4}$' and substr(academic_year, 6, 4)::int = substr(academic_year, 1, 4)::int + 1`,
    )
    .execute();

  await db.schema
    .createTable("member")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("organizationId", "text", (col) =>
      col.notNull().references("organization.id").onDelete("cascade"),
    )
    .addColumn("userId", "text", (col) => col.notNull().references("user.id").onDelete("cascade"))
    .addColumn("role", "text", (col) => col.notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.notNull())
    .addUniqueConstraint("member_organization_user", ["organizationId", "userId"])
    .addCheckConstraint("member_role", sql`role in ('owner', 'teacher', 'student')`)
    .execute();
  await db.schema
    .createIndex("member_organizationId_idx")
    .on("member")
    .column("organizationId")
    .execute();
  await db.schema.createIndex("member_userId_idx").on("member").column("userId").execute();
  // Exactly one owner per class (#28): at most one here, at least one by the class service.
  await db.schema
    .createIndex("member_one_owner")
    .on("member")
    .column("organizationId")
    .unique()
    .where(sql.ref("role"), "=", "owner")
    .execute();

  await db.schema
    .createTable("invitation")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("organizationId", "text", (col) =>
      col.notNull().references("organization.id").onDelete("cascade"),
    )
    .addColumn("email", "text", (col) => col.notNull())
    .addColumn("role", "text", (col) => col.notNull())
    .addColumn("teamId", "text")
    .addColumn("status", "text", (col) => col.notNull().defaultTo("pending"))
    .addColumn("expiresAt", "timestamptz", (col) => col.notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    // NOTE: #37; deleting the inviter (a teacher or an administrator) keeps their invitations.
    .addColumn("inviterId", "text", (col) => col.references("user.id").onDelete("set null"))
    // When the invitation stopped being pending; the 90-day retention counts from here.
    .addColumn("ended_at", "timestamptz")
    .addCheckConstraint("invitation_email", sql`email = lower(btrim(email)) and email like '%_@_%'`)
    .addCheckConstraint("invitation_role", sql`role in ('teacher', 'student')`)
    .addCheckConstraint(
      "invitation_status",
      sql`status in ('pending', 'accepted', 'rejected', 'canceled')`,
    )
    .addCheckConstraint("invitation_ended", sql`(status = 'pending') = (ended_at is null)`)
    .addCheckConstraint("invitation_no_team", sql`"teamId" is null`)
    .execute();
  await db.schema
    .createIndex("invitation_organizationId_idx")
    .on("invitation")
    .column("organizationId")
    .execute();
  await db.schema.createIndex("invitation_email_idx").on("invitation").column("email").execute();
  // One pending invitation per address and class: a second invite resends the first.
  await db.schema
    .createIndex("invitation_one_pending")
    .on("invitation")
    .columns(["organizationId", "email"])
    .unique()
    .where(sql.ref("status"), "=", "pending")
    .execute();

  await db.schema
    .createTable("team")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("organizationId", "text", (col) =>
      col.notNull().references("organization.id").onDelete("cascade"),
    )
    .addColumn("createdAt", "timestamptz", (col) => col.notNull())
    .addColumn("updatedAt", "timestamptz")
    .addColumn("memberCount", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("group_set", "text", (col) => col.notNull())
    .addUniqueConstraint("team_set_name", ["organizationId", "group_set", "name"])
    .addCheckConstraint("team_name", sql`length(name) between 1 and 60 and name = btrim(name)`)
    .addCheckConstraint(
      "team_group_set",
      sql`length(group_set) between 1 and 60 and group_set = btrim(group_set)`,
    )
    .execute();
  await db.schema
    .createIndex("team_organizationId_idx")
    .on("team")
    .column("organizationId")
    .execute();

  await db.schema
    .createTable("teamMember")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("teamId", "text", (col) => col.notNull().references("team.id").onDelete("cascade"))
    .addColumn("userId", "text", (col) => col.notNull().references("user.id").onDelete("cascade"))
    .addColumn("membershipKey", "text", (col) => col.unique())
    .addColumn("createdAt", "timestamptz")
    .addUniqueConstraint("teamMember_team_user", ["teamId", "userId"])
    .execute();
  await db.schema.createIndex("teamMember_teamId_idx").on("teamMember").column("teamId").execute();
  await db.schema.createIndex("teamMember_userId_idx").on("teamMember").column("userId").execute();

  // NOTE: #28; eduLIMS reads the class from the URL, never from these, but the plugin adds them.
  await db.schema
    .alterTable("session")
    .addColumn("activeOrganizationId", "text")
    .addColumn("activeTeamId", "text")
    .execute();
}

// NOTE: no requirement governs this: our own design. Reverting drops every class with its
// members, invitations and lab groups.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("session")
    .dropColumn("activeOrganizationId")
    .dropColumn("activeTeamId")
    .execute();
  await db.schema.dropTable("teamMember").execute();
  await db.schema.dropTable("team").execute();
  await db.schema.dropTable("invitation").execute();
  await db.schema.dropTable("member").execute();
  await db.schema.dropTable("organization").execute();
}
