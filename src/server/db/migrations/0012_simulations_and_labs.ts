// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Simulations and their labs (D10, S10, ADR 0021): a simulation with its teachers, its labs, the
// students in each lab, the email addresses that wait for a student to sign in, and the students
// a teacher removed. A student is in at most one lab of a simulation, and an address waits in at
// most one lab of it: both are primary keys. Every foreign key to a simulation or a lab cascades.
import { type Kysely, sql } from "kysely";

/** The most characters a simulation name and a lab name take (our own design, #280). */
const SIMULATION_NAME_MAX = 100;
const LAB_NAME_MAX = 60;

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("simulations")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("name", "text", (c) => c.notNull())
    // NOTE: #280; deleting the teacher who created it keeps the simulation for its other teachers.
    .addColumn("created_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      "simulations_name",
      sql`name = btrim(name) and char_length(name) between 1 and ${sql.lit(SIMULATION_NAME_MAX)}`,
    )
    .execute();

  await db.schema
    .createTable("simulation_teachers")
    .addColumn("simulation_id", "uuid", (c) =>
      c.notNull().references("simulations.id").onDelete("cascade"),
    )
    .addColumn("user_id", "text", (c) => c.notNull().references("user.id").onDelete("cascade"))
    .addColumn("added_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("added_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint("simulation_teachers_pk", ["simulation_id", "user_id"])
    .execute();
  await db.schema
    .createIndex("simulation_teachers_user_id_idx")
    .on("simulation_teachers")
    .column("user_id")
    .execute();
  // NOTE: D10 (#300 review, #311); a simulation keeps a teacher row whose user holds the role
  // teacher (the stored sets of `user_role_allowed_set`), checked at commit with the user rows
  // locked, so a delete of the whole simulation, whose cascade removes every row, still passes.
  await sql`
    create function simulation_teachers_keep_one() returns trigger language plpgsql as $$
    begin
      if not exists (select 1 from simulations where id = old.simulation_id) then
        return null;
      end if;
      perform 1
        from simulation_teachers st
        join "user" u on u.id = st.user_id
        where st.simulation_id = old.simulation_id
          and u.role in ('teacher', 'teacher,admin')
        for share of u;
      if not found then
        raise exception 'a simulation keeps at least one teacher'
          using errcode = '23514', constraint = 'simulation_teachers_last_teacher';
      end if;
      return null;
    end $$`.execute(db);
  await sql`
    create constraint trigger simulation_teachers_last_teacher
    after delete on simulation_teachers
    deferrable initially deferred
    for each row execute function simulation_teachers_keep_one()`.execute(db);

  await db.schema
    .createTable("labs")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("simulation_id", "uuid", (c) =>
      c.notNull().references("simulations.id").onDelete("cascade"),
    )
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      "labs_name",
      sql`name = btrim(name) and char_length(name) between 1 and ${sql.lit(LAB_NAME_MAX)}`,
    )
    // The target of the composite foreign keys below: a lab of this simulation, never another.
    .addUniqueConstraint("labs_id_simulation_id_key", ["id", "simulation_id"])
    .execute();
  // NOTE: #280; lab names are unique within a simulation, case-insensitively.
  await db.schema
    .createIndex("labs_simulation_id_name_key")
    .on("labs")
    .unique()
    .expression(sql`simulation_id, lower(name)`)
    .execute();

  await db.schema
    .createTable("lab_members")
    .addColumn("simulation_id", "uuid", (c) => c.notNull())
    .addColumn("lab_id", "uuid", (c) => c.notNull())
    .addColumn("user_id", "text", (c) => c.notNull().references("user.id").onDelete("cascade"))
    .addColumn("joined_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("joined_via", "text", (c) => c.notNull())
    .addCheckConstraint("lab_members_joined_via", sql`joined_via in ('email', 'code')`)
    // S10: a student is in at most one lab of a simulation.
    .addPrimaryKeyConstraint("lab_members_pk", ["simulation_id", "user_id"])
    .addForeignKeyConstraint(
      "lab_members_lab_fk",
      ["lab_id", "simulation_id"],
      "labs",
      ["id", "simulation_id"],
      (c) => c.onDelete("cascade"),
    )
    .execute();
  await db.schema
    .createIndex("lab_members_lab_id_idx")
    .on("lab_members")
    .column("lab_id")
    .execute();
  await db.schema
    .createIndex("lab_members_user_id_idx")
    .on("lab_members")
    .column("user_id")
    .execute();

  await db.schema
    .createTable("lab_member_emails")
    .addColumn("simulation_id", "uuid", (c) => c.notNull())
    .addColumn("lab_id", "uuid", (c) => c.notNull())
    .addColumn("email", "text", (c) => c.notNull())
    .addColumn("added_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("added_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      "lab_member_emails_email",
      sql`email = lower(btrim(email)) and char_length(email) <= 320 and email like '%_@_%'`,
    )
    // NOTE: #280; an address waits in at most one lab of a simulation.
    .addPrimaryKeyConstraint("lab_member_emails_pk", ["simulation_id", "email"])
    .addForeignKeyConstraint(
      "lab_member_emails_lab_fk",
      ["lab_id", "simulation_id"],
      "labs",
      ["id", "simulation_id"],
      (c) => c.onDelete("cascade"),
    )
    .execute();
  await db.schema
    .createIndex("lab_member_emails_lab_id_idx")
    .on("lab_member_emails")
    .column("lab_id")
    .execute();
  await db.schema
    .createIndex("lab_member_emails_email_idx")
    .on("lab_member_emails")
    .column("email")
    .execute();
  // NOTE: #311; the prune of waiting addresses finds its rows by age.
  await db.schema
    .createIndex("lab_member_emails_added_at_idx")
    .on("lab_member_emails")
    .column("added_at")
    .execute();

  // The students a teacher removed: a removed student cannot rejoin with a lab's code (#288).
  await db.schema
    .createTable("simulation_removals")
    .addColumn("simulation_id", "uuid", (c) =>
      c.notNull().references("simulations.id").onDelete("cascade"),
    )
    .addColumn("user_id", "text", (c) => c.notNull().references("user.id").onDelete("cascade"))
    .addColumn("removed_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("removed_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint("simulation_removals_pk", ["simulation_id", "user_id"])
    .execute();
  await db.schema
    .createIndex("simulation_removals_user_id_idx")
    .on("simulation_removals")
    .column("user_id")
    .execute();
}

// NOTE: no requirement governs this: our own design. Reverting drops every simulation with its
// teachers, labs, members, waiting addresses and removal records.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("simulation_removals").execute();
  await db.schema.dropTable("lab_member_emails").execute();
  await db.schema.dropTable("lab_members").execute();
  await db.schema.dropTable("labs").execute();
  await db.schema.dropTable("simulation_teachers").execute();
  await sql`drop function simulation_teachers_keep_one()`.execute(db);
  await db.schema.dropTable("simulations").execute();
}
