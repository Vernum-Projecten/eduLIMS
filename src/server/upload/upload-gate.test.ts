// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The gate in front of the Gen5 upload (security review of #400, S1; ASVS V5.2.1, V15.2.2): an
// anonymous caller keeps the small form limit and its body is never read, a signed-in caller gets
// the upload's limit, and a third upload of one user, or a fifth in the process, is refused 429.
import { describe, expect, it } from "vitest";
import { FORM_BODY_MAX, GEN5_FORM_BODY_MAX } from "../form-body-limit.ts";
import { setSecurityLogWriter } from "../security-log.ts";
import {
  gateGen5Upload,
  isGen5UploadCall,
  UPLOADS_IN_FLIGHT,
  UPLOADS_PER_USER,
  UploadSlots,
} from "./upload-gate.ts";

const GEN5 = "/_serverFn/gen5-upload";
const MULTIPART = "multipart/form-data; boundary=----x";

/** A form POST declaring `length`, whose body throws when anything reads it. */
function form(length: number): { request: Request; read: () => boolean } {
  let read = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull() {
        read = true;
        throw new Error("the body was read");
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request(`http://edulims.test${GEN5}`, {
    method: "POST",
    headers: { "content-type": MULTIPART, "content-length": String(length) },
    body,
    duplex: "half",
  } as RequestInit);
  return { request, read: () => read || request.bodyUsed };
}

const anonymous = async () => null;
const signedIn = (id: string) => async () => id;

/** Runs `work` with the security stream captured and returns its parsed lines. */
async function logged(work: () => Promise<unknown>): Promise<Record<string, unknown>[]> {
  const lines: string[] = [];
  const restore = setSecurityLogWriter((line) => lines.push(line));
  try {
    await work();
  } finally {
    restore();
  }
  return lines.map((line): Record<string, unknown> => JSON.parse(line));
}

describe("which call is the upload's", () => {
  it("is the upload function's own path, and nothing else", () => {
    expect(isGen5UploadCall(GEN5, GEN5)).toBe(true);
    expect(isGen5UploadCall("/_serverFn/abc", GEN5)).toBe(false);
    expect(isGen5UploadCall(`${GEN5}x`, GEN5)).toBe(false);
    expect(isGen5UploadCall(GEN5, undefined)).toBe(false);
  });
});

describe("an anonymous caller (S1)", () => {
  it("is refused 413 at the upload's limit, with the body unread and the connection closed", async () => {
    const { request, read } = form(GEN5_FORM_BODY_MAX);
    const gate = await gateGen5Upload(request, anonymous, new UploadSlots());
    expect(gate.kind).toBe("refused");
    if (gate.kind !== "refused") return;
    expect(gate.response.status).toBe(413);
    expect(gate.response.headers.get("connection")).toBe("close");
    expect(read()).toBe(false);
  });

  it("keeps the form limit of every other function, and takes no slot", async () => {
    const slots = new UploadSlots();
    const at = await gateGen5Upload(form(FORM_BODY_MAX).request, anonymous, slots);
    expect(at.kind).toBe("pass");
    expect(slots.inUse).toBe(0);
    const over = await gateGen5Upload(form(FORM_BODY_MAX + 1).request, anonymous, slots);
    expect(over.kind === "refused" && over.response.status).toBe(413);
  });
});

describe("a signed-in caller (S1)", () => {
  it("may send the upload's form, and one byte more is refused 413", async () => {
    const slots = new UploadSlots();
    const at = await gateGen5Upload(form(GEN5_FORM_BODY_MAX).request, signedIn("u1"), slots);
    expect(at.kind).toBe("pass");
    const over = await gateGen5Upload(form(GEN5_FORM_BODY_MAX + 1).request, signedIn("u1"), slots);
    expect(over.kind === "refused" && over.response.status).toBe(413);
  });

  it("refuses a third concurrent upload of one user with 429 before the body is read, logged", async () => {
    const slots = new UploadSlots();
    const held = [];
    for (let n = 0; n < UPLOADS_PER_USER; n += 1) {
      held.push(await gateGen5Upload(form(1024).request, signedIn("u1"), slots));
    }
    expect(held.map((gate) => gate.kind)).toEqual(["pass", "pass"]);
    const third = form(1024);
    let gate: Awaited<ReturnType<typeof gateGen5Upload>> | undefined;
    const lines = await logged(async () => {
      gate = await gateGen5Upload(third.request, signedIn("u1"), slots);
    });
    expect(gate?.kind === "refused" && gate.response.status).toBe(429);
    expect(gate?.kind === "refused" && gate.response.headers.get("connection")).toBe("close");
    expect(third.read()).toBe(false);
    expect(lines).toEqual([
      expect.objectContaining({
        event: "input_validation_fail",
        reason: "upload_busy",
        status: 429,
      }),
    ]);
  });

  it("frees the slot once an upload ends, once only", async () => {
    const slots = new UploadSlots();
    const first = await gateGen5Upload(form(1024).request, signedIn("u1"), slots);
    await gateGen5Upload(form(1024).request, signedIn("u1"), slots);
    if (first.kind !== "pass") throw new Error("expected a pass");
    first.release();
    first.release();
    expect(slots.inUse).toBe(1);
    expect((await gateGen5Upload(form(1024).request, signedIn("u1"), slots)).kind).toBe("pass");
  });

  it("refuses a fifth upload in the process, whoever sends it", async () => {
    const slots = new UploadSlots();
    for (let n = 0; n < UPLOADS_IN_FLIGHT; n += 1) {
      const gate = await gateGen5Upload(form(1024).request, signedIn(`u${n}`), slots);
      expect(gate.kind).toBe("pass");
    }
    const fifth = await gateGen5Upload(form(1024).request, signedIn("u9"), slots);
    expect(fifth.kind === "refused" && fifth.response.status).toBe(429);
  });
});
