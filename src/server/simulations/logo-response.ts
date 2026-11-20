// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The HTTP answer of `GET /api/labs/$labId/logo` (#292): the logo to a member of the lab and a
// teacher of its simulation, with its stored type, `nosniff`, an inline disposition with a name
// the server makes, a sandboxing CSP and `no-store` like every other response (#41; ASVS 5.0
// V3.2.1, V5.4.1, V5.4.2). Everyone else, an administrator and a signed-out caller included, gets
// the same empty 404 as a lab without a logo, and a refused read goes to the security stream.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import type { LogoMediaType } from "../../lib/lab-logo.ts";
import type { SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { logSecurityEvent } from "../security-log.ts";
import { readLabLogo } from "./logo.ts";

/** Resolves the session user of a request; the route passes the app's resolver. */
export type SessionReader = (headers: Headers) => Promise<SessionUser | null>;

const EXTENSIONS: Record<LogoMediaType, string> = { "image/png": "png", "image/jpeg": "jpg" };

/** The answer to everyone who may not read the logo, and for a lab without one. */
function notFound(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

/**
 * Returns the answer to a read of a lab's logo by the session user of `request`: 200 with the
 * image, or an empty 404.
 */
export async function labLogoResponse(
  db: Kysely<DB>,
  request: Request,
  labId: string,
  readSession: SessionReader,
): Promise<Response> {
  const user = await readSession(request.headers);
  if (!user) {
    logRefused(undefined, labId, "not_signed_in");
    return notFound();
  }
  const read = await readLabLogo(db, user, labId);
  if (!read.access) {
    logRefused(user.id, labId, "not_lab_reader");
    return notFound();
  }
  if (read.logo === null) return notFound();
  const { content, mediaType, byteSize } = read.logo;
  return new Response(new Uint8Array(content), {
    status: 200,
    headers: {
      "Content-Type": mediaType,
      "Content-Length": String(byteSize),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Disposition": `inline; filename="lab-logo.${EXTENSIONS[mediaType]}"`,
    },
  });
}

/** Writes a refused read to the security stream as `authz_fail` (ASVS V16.3.2): ids only. */
function logRefused(userId: string | undefined, labId: string, reason: string): void {
  logSecurityEvent("warn", "authz_fail", {
    outcome: "refused",
    actor_type: userId ? "user" : "anonymous",
    actor_id: userId,
    target_type: "lab",
    target_id: labId,
    reason,
    status: 404,
  });
}
