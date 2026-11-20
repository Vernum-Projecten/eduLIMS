// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The server route that serves a lab's logo (S10, D10, D11, Q-SEC-2, #292): the image with its
// headers to the lab's members and its simulation's teachers, and the same empty 404 to everyone
// else, an administrator and a signed-out caller included, with the refusal logged.
import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { jpeg, png } from "../logo/test-images.ts";
import { setLabLogo } from "./logo.ts";
import { labLogoResponse, matchesEtag, type SessionReader } from "./logo-response.ts";
import { NOW, type Person, securityLines, type World, world } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

const LOGO = png(6, 3);
const ETAG = `"${createHash("sha256").update(LOGO).digest("hex")}"`;

async function withLogo(bytes: Uint8Array = LOGO): Promise<{ database: Kysely<DB>; w: World }> {
  const database = await createTestDb();
  db = database;
  const w = await world(database);
  const result = await setLabLogo(database, w.teacher, { labId: w.labId, bytes }, NOW);
  if (!result.ok) throw new Error(result.error);
  return { database, w };
}

/** A session reader that answers `who` (or nobody) whatever the request carries. */
function as(who: Person | null): SessionReader {
  return async () => {
    if (who === null) return null;
    const user: SessionUser = {
      id: who.id,
      name: "Test",
      email: who.email,
      roles: [...who.roles],
      lastPortal: null,
    };
    return user;
  };
}

function get(labId: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://edulims.test/api/labs/${labId}/logo`, { headers });
}

describe("GET /api/labs/$labId/logo (#292)", () => {
  it("serves the logo to a student of the lab with every header the issue lists", async () => {
    const { database, w } = await withLogo();
    const response = await labLogoResponse(database, get(w.labId), w.labId, as(w.student));
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toEqual({
      "cache-control": "private, no-cache",
      "content-disposition": 'inline; filename="lab-logo.png"',
      "content-length": String(LOGO.length),
      "content-security-policy": "default-src 'none'; sandbox",
      "content-type": "image/png",
      "cross-origin-resource-policy": "same-origin",
      etag: ETAG,
      "x-content-type-options": "nosniff",
    });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(LOGO);
  });

  it("serves a JPEG with its own type and a .jpg name", async () => {
    const { database, w } = await withLogo(jpeg());
    const response = await labLogoResponse(database, get(w.labId), w.labId, as(w.coTeacher));
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="lab-logo.jpg"');
  });

  it("serves the logo to a teacher of the simulation", async () => {
    const { database, w } = await withLogo();
    const response = await labLogoResponse(database, get(w.labId), w.labId, as(w.teacher));
    expect(response.status).toBe(200);
  });

  it("answers 304 to a browser that holds the same logo, after the access check", async () => {
    const { database, w } = await withLogo();
    const cached = get(w.labId, { "if-none-match": ETAG });
    const response = await labLogoResponse(database, cached, w.labId, as(w.student));
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(ETAG);
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(await response.text()).toBe("");
    const outsider = await labLogoResponse(database, cached, w.labId, as(w.outsideStudent));
    expect(outsider.status).toBe(404);
  });

  it("serves the new logo after a replacement: the ETag follows the content", async () => {
    const { database, w } = await withLogo();
    const second = png(9, 9);
    await setLabLogo(database, w.teacher, { labId: w.labId, bytes: second }, NOW);
    const response = await labLogoResponse(
      database,
      get(w.labId, { "if-none-match": ETAG }),
      w.labId,
      as(w.student),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).not.toBe(ETAG);
  });

  const refused: [string, (w: World) => Person][] = [
    ["a student of another lab", (w) => w.otherLabStudent],
    ["a student outside the simulation", (w) => w.outsideStudent],
    ["a student in no lab", (w) => w.stranger],
    ["a teacher of another simulation", (w) => w.outsiderTeacher],
    ["an administrator", (w) => w.admin],
  ];
  it.each(refused)("answers an empty 404 to %s and logs it (D11, B5)", async (_name, whoOf) => {
    const { database, w } = await withLogo();
    const who = whoOf(w);
    let response: Response | undefined;
    const lines = await securityLines(async () => {
      response = await labLogoResponse(database, get(w.labId), w.labId, as(who));
    });
    expect(response?.status).toBe(404);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("etag")).toBeNull();
    expect(await response?.text()).toBe("");
    expect(lines).toEqual([
      expect.objectContaining({
        event: "authz_fail",
        actor_id: who.id,
        target_type: "lab",
        target_id: w.labId,
        reason: "not_lab_reader",
        status: 404,
      }),
    ]);
  });

  it("answers an empty 404 to a signed-out caller and logs it", async () => {
    const { database, w } = await withLogo();
    let response: Response | undefined;
    const lines = await securityLines(async () => {
      response = await labLogoResponse(database, get(w.labId), w.labId, as(null));
    });
    expect(response?.status).toBe(404);
    expect(lines).toEqual([
      expect.objectContaining({
        event: "authz_fail",
        actor_type: "anonymous",
        reason: "not_signed_in",
        target_id: w.labId,
      }),
    ]);
  });

  it("answers the same 404 for a lab without a logo, without a log line", async () => {
    const { database, w } = await withLogo();
    let response: Response | undefined;
    const lines = await securityLines(async () => {
      response = await labLogoResponse(database, get(w.otherLabId), w.otherLabId, as(w.teacher));
    });
    expect(response?.status).toBe(404);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(lines).toEqual([]);
  });

  it("answers 404 to a malformed lab id and logs it as redacted", async () => {
    const { database, w } = await withLogo();
    let response: Response | undefined;
    const lines = await securityLines(async () => {
      response = await labLogoResponse(database, get("x"), "<script>", as(w.teacher));
    });
    expect(response?.status).toBe(404);
    expect(lines).toEqual([expect.objectContaining({ target_id: "redacted" })]);
  });
});

describe("matchesEtag (RFC 9110 §13.1.2)", () => {
  it.each<[string | null, boolean]>([
    [null, false],
    ['"abc"', true],
    ['W/"abc"', true],
    ['"x", "abc"', true],
    ["*", true],
    ['"abd"', false],
    ["abc", false],
  ])("reads %j as %s", (header, expected) => {
    expect(matchesEtag(header, '"abc"')).toBe(expected);
  });
});
