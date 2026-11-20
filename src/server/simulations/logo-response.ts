// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The HTTP answer of `GET /api/labs/$labId/logo` (#292): the logo to a member of the lab and a
// teacher of its simulation, with its stored type, `nosniff`, an inline disposition with a name
// the server makes, a sandboxing CSP, a private cache that revalidates and an ETag (ASVS 5.0
// V3.2.1, V5.4.1, V5.4.2). Everyone else, an administrator and a signed-out caller included, gets
// the same empty 404 as a lab without a logo, and a refused read goes to the security stream.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import type { LogoMediaType } from "../../lib/lab-logo.ts";
import type { SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { PRIVATE_REVALIDATE } from "../security-headers.ts";
import { logSecurityEvent } from "../security-log.ts";
import { readLabLogo, type StoredLogo } from "./logo.ts";

/** Resolves the session user of a request; the route passes the app's resolver. */
export type SessionReader = (headers: Headers) => Promise<SessionUser | null>;

const EXTENSIONS: Record<LogoMediaType, string> = { "image/png": "png", "image/jpeg": "jpg" };

/** The answer to everyone who may not read the logo, and for a lab without one. */
function notFound(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

/** Returns whether an `If-None-Match` value names `etag` (RFC 9110 §13.1.2, weak comparison). */
export function matchesEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) return false;
  if (ifNoneMatch.trim() === "*") return true;
  return ifNoneMatch
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .includes(etag);
}

/** Returns the headers every answer with the logo carries, the 304 included. */
function logoHeaders(logo: StoredLogo, etag: string): Headers {
  return new Headers({
    "Cache-Control": PRIVATE_REVALIDATE,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Disposition": `inline; filename="lab-logo.${EXTENSIONS[logo.mediaType]}"`,
  });
}

/**
 * Returns the answer to a read of a lab's logo by the session user of `request`: 200 with the
 * image, 304 when the browser holds the same one, or an empty 404.
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
  const etag = `"${read.logo.sha256}"`;
  const headers = logoHeaders(read.logo, etag);
  if (matchesEtag(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  headers.set("Content-Type", read.logo.mediaType);
  headers.set("Content-Length", String(read.logo.byteSize));
  return new Response(new Uint8Array(read.logo.content), { status: 200, headers });
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
