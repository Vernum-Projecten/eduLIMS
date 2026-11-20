// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The logo of a lab (D10, ADR 0021, #292). A teacher of the lab's simulation sets, replaces or
// removes it; the members of the lab and the teachers of its simulation read it, and nobody else,
// an administrator included (#280). The upload is checked by its content and its metadata is
// removed before it is stored (`src/server/logo/`); a refused upload leaves an activity-log row
// with its refusal code and nothing of its content.
import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import type { LogoMediaType, LogoRefusal } from "../../lib/lab-logo.ts";
import { parseLabId } from "../../lib/simulations.ts";
import { recordAudit } from "../audit/record.ts";
import { hasRole } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { checkLogo } from "../logo/image.ts";
import {
  done,
  type SimulationActionError,
  type SimulationActor,
  type SimulationResult,
  withLab,
} from "./access.ts";
import { studentLabsQuery } from "./student-access.ts";

/** What the teacher's screen learns of a stored logo: never its bytes. */
export interface LabLogoInfo {
  mediaType: LogoMediaType;
  width: number;
  height: number;
  byteSize: number;
}

/** The outcome of an upload: stored, or refused for its access or its content. */
export type LogoResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SimulationActionError | LogoRefusal };

type Stored = { stored: true; info: LabLogoInfo } | { stored: false; refusal: LogoRefusal };

/**
 * Checks `bytes` and stores them as the logo of a lab whose simulation the actor teaches,
 * replacing the logo it had. The type, width and height come from the content; the file name is
 * never read (ASVS 5.0 V5.2.2, V5.3.2). Both outcomes leave a `lab_logo_changed` row.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export async function setLabLogo(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { labId: string; bytes: Uint8Array },
  now: Date,
): Promise<LogoResult<LabLogoInfo>> {
  const result: SimulationResult<Stored> = await withLab(
    db,
    actor,
    input.labId,
    async (trx, lab) => {
      const event = {
        action: "lab_logo_changed",
        actor: { type: "user", id: actor.id },
        target: { type: "lab", id: lab.labId },
      } as const;
      const check = checkLogo(input.bytes);
      if (!check.ok) {
        await recordAudit(trx, {
          ...event,
          outcome: "refused",
          reason: check.fault.kind,
          metadata: { simulation_id: lab.simulationId },
        });
        return done<Stored>({ stored: false, refusal: check.fault.kind });
      }
      const { mediaType, width, height, bytes } = check.image;
      const content = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const row = {
        content,
        media_type: mediaType,
        byte_size: bytes.length,
        width,
        height,
        sha256: createHash("sha256").update(content).digest(),
        updated_by: actor.id,
        updated_at: now,
      };
      const previous = await trx
        .selectFrom("lab_logos")
        .select("lab_id")
        .where("lab_id", "=", lab.labId)
        .executeTakeFirst();
      await trx
        .insertInto("lab_logos")
        .values({ lab_id: lab.labId, ...row })
        .onConflict((conflict) => conflict.column("lab_id").doUpdateSet(row))
        .execute();
      await recordAudit(trx, {
        ...event,
        outcome: "success",
        metadata: {
          simulation_id: lab.simulationId,
          logo_change: previous ? "replaced" : "added",
        },
      });
      return done<Stored>({
        stored: true,
        info: { mediaType, width, height, byteSize: bytes.length },
      });
    },
  );
  if (!result.ok) return result;
  return result.value.stored
    ? { ok: true, value: result.value.info }
    : { ok: false, error: result.value.refusal };
}

/**
 * Removes the logo of a lab whose simulation the actor teaches. A lab without a logo is left as
 * it is, with no activity-log row, since nothing changed.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export function removeLabLogo(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { labId: string },
): Promise<SimulationResult> {
  return withLab(db, actor, input.labId, async (trx, lab) => {
    const removed = await trx
      .deleteFrom("lab_logos")
      .where("lab_id", "=", lab.labId)
      .returning("lab_id")
      .executeTakeFirst();
    if (removed) {
      await recordAudit(trx, {
        action: "lab_logo_changed",
        actor: { type: "user", id: actor.id },
        outcome: "success",
        target: { type: "lab", id: lab.labId },
        metadata: { simulation_id: lab.simulationId, logo_change: "removed" },
      });
    }
    return done(null);
  });
}

/** A stored logo as the server route serves it. */
export interface StoredLogo {
  content: Buffer;
  mediaType: LogoMediaType;
  byteSize: number;
}

/**
 * What a reader may see of a lab's logo: no access when the lab is unknown or the reader is
 * neither a member of it nor a teacher of its simulation, else the logo or `null` for none.
 */
export type LogoRead = { access: false } | { access: true; logo: StoredLogo | null };

function isLogoMediaType(value: string): value is LogoMediaType {
  return value === "image/png" || value === "image/jpeg";
}

/**
 * Reads the logo of `labId` for the session user (S10, D10, D11): a student through their own
 * place in the lab ({@link studentLabsQuery}), a teacher through a teacher row of the lab's
 * simulation, both in the one query that reads the logo. Any other role, the administrator
 * included, reads nothing (#280).
 */
export async function readLabLogo(
  db: Kysely<DB>,
  reader: SimulationActor,
  labId: string,
): Promise<LogoRead> {
  const id = parseLabId(labId);
  if (id === null) return { access: false };
  const columns = [
    "labs.id as lab_id",
    "lab_logos.content",
    "lab_logos.media_type",
    "lab_logos.byte_size",
  ] as const;
  let row:
    | { content: Buffer | null; media_type: string | null; byte_size: number | null }
    | undefined;
  if (hasRole(reader, "student")) {
    row = await studentLabsQuery(db, reader.id)
      .leftJoin("lab_logos", "lab_logos.lab_id", "labs.id")
      .select(columns)
      .where("labs.id", "=", id)
      .executeTakeFirst();
  } else if (hasRole(reader, "teacher")) {
    row = await db
      .selectFrom("labs")
      .innerJoin("simulation_teachers", "simulation_teachers.simulation_id", "labs.simulation_id")
      .leftJoin("lab_logos", "lab_logos.lab_id", "labs.id")
      .select(columns)
      .where("labs.id", "=", id)
      .where("simulation_teachers.user_id", "=", reader.id)
      .executeTakeFirst();
  }
  if (row === undefined) return { access: false };
  const { content, media_type, byte_size } = row;
  if (content === null || media_type === null || byte_size === null) {
    return { access: true, logo: null };
  }
  if (!isLogoMediaType(media_type)) throw new Error("lab_logos.media_type is not a logo type");
  return { access: true, logo: { content, mediaType: media_type, byteSize: byte_size } };
}
