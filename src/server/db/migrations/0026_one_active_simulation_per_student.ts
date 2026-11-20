// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// One simulation at a time per student (S10, D10, owner 2026-11-20 on #379): a student is in at
// most one lab whose simulation is not finished. The services refuse a second place with
// `in_other_simulation`; this trigger is the last line, so no path writes one. A simulation only
// moves forward (prepared, running, finished), so no change of state can break the rule.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // NOTE: #379; the student's user row is locked first, so two writes for one student into two
  // simulations run one after the other and the second sees the first's committed place.
  await sql`
    create function lab_members_one_active_simulation() returns trigger language plpgsql as $$
    begin
      perform 1 from "user" where id = new.user_id for no key update;
      if exists (select 1 from simulations where id = new.simulation_id and state <> 'finished')
        and exists (
          select 1
            from lab_members m
            join simulations s on s.id = m.simulation_id
            where m.user_id = new.user_id
              and m.simulation_id <> new.simulation_id
              and s.state <> 'finished'
        ) then
        raise exception 'a student is in one simulation at a time that is not finished'
          using errcode = '23514', constraint = 'lab_members_one_active_simulation';
      end if;
      return new;
    end $$`.execute(db);
  await sql`
    create trigger lab_members_one_active_simulation
    before insert or update of user_id, simulation_id on lab_members
    for each row execute function lab_members_one_active_simulation()`.execute(db);
}

// NOTE: no requirement governs this: our own design. Reverting drops the trigger only.
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop trigger lab_members_one_active_simulation on lab_members`.execute(db);
  await sql`drop function lab_members_one_active_simulation()`.execute(db);
}
