// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The size limit of a form sent to a server function (ASVS 5.0 V5.2.1, #292): checked on the
// declared length, at and one over the limit, before the body is read.
import { describe, expect, it } from "vitest";
import { LOGO_MAX_BYTES } from "../lib/lab-logo.ts";
import { setBodyRefusalLogDeps } from "./body-refusal-log.ts";
import { FORM_BODY_MAX, formBodyRefusal, refuseFormBody } from "./form-body-limit.ts";
import { RefusalDeduper } from "./refusal-deduper.ts";
import { setSecurityLogWriter } from "./security-log.ts";

function post(headers: Record<string, string>): Request {
  return new Request("http://edulims.test/_serverFn/abc", { method: "POST", headers });
}

const MULTIPART = "multipart/form-data; boundary=----x";

describe("formBodyRefusal (V5.2.1)", () => {
  it("leaves room for one logo of the full size and its form fields", () => {
    expect(FORM_BODY_MAX).toBeGreaterThan(LOGO_MAX_BYTES);
    expect(FORM_BODY_MAX - LOGO_MAX_BYTES).toBe(16 * 1024);
  });

  it("lets a form of exactly the limit through", () => {
    const request = post({ "content-type": MULTIPART, "content-length": String(FORM_BODY_MAX) });
    expect(formBodyRefusal(request)).toBeNull();
  });

  it("refuses a form one byte over the limit with 413", () => {
    const length = String(FORM_BODY_MAX + 1);
    expect(formBodyRefusal(post({ "content-type": MULTIPART, "content-length": length }))).toBe(
      413,
    );
  });

  it("refuses a URL-encoded form over the limit too", () => {
    const request = post({
      "content-type": "application/x-www-form-urlencoded",
      "content-length": String(FORM_BODY_MAX + 1),
    });
    expect(formBodyRefusal(request)).toBe(413);
  });

  it.each(["", "abc", "-1", "1e9", "12 34", "9".repeat(16)])(
    "refuses a form with the length %j with 411",
    (length) => {
      expect(formBodyRefusal(post({ "content-type": MULTIPART, "content-length": length }))).toBe(
        411,
      );
    },
  );

  it("refuses a form without a length (a chunked body) with 411", () => {
    expect(formBodyRefusal(post({ "content-type": MULTIPART }))).toBe(411);
  });

  it("leaves a JSON call alone", () => {
    expect(formBodyRefusal(post({ "content-type": "application/json" }))).toBeNull();
    expect(formBodyRefusal(post({}))).toBeNull();
  });

  it("answers the refusal with an empty response and logs its code only", async () => {
    const lines: string[] = [];
    const restore = setSecurityLogWriter((line) => lines.push(line));
    let response: Response | null;
    try {
      response = refuseFormBody(
        post({ "content-type": MULTIPART, "content-length": String(FORM_BODY_MAX + 1) }),
      );
    } finally {
      restore();
    }
    expect(response?.status).toBe(413);
    expect(response?.headers.get("connection")).toBe("close");
    expect(await response?.text()).toBe("");
    const missing = refuseFormBody(post({ "content-type": MULTIPART }));
    expect(missing?.status).toBe(411);
    expect(missing?.headers.get("connection")).toBe("close");
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        event: "input_validation_fail",
        reason: "form_too_large",
        status: 413,
      }),
    ]);
    expect(refuseFormBody(post({ "content-type": "application/json" }))).toBeNull();
  });

  it("logs the request id the reverse proxy set, and leaves out a malformed one (#357)", () => {
    const lines: string[] = [];
    const restore = setSecurityLogWriter((line) => lines.push(line));
    // Two clients, so the per-client window of the refusal log (#350) keeps both lines.
    const restoreLog = setBodyRefusalLogDeps({
      trustedProxies: () => ["10.0.0.1"],
      deduper: new RefusalDeduper(),
    });
    try {
      refuseFormBody(
        post({
          "content-type": MULTIPART,
          "x-request-id": "req-357",
          "x-forwarded-for": "203.0.113.1",
        }),
      );
      refuseFormBody(
        post({
          "content-type": MULTIPART,
          "x-request-id": "not an id",
          "x-forwarded-for": "203.0.113.2",
        }),
      );
    } finally {
      restoreLog();
      restore();
    }
    const parsed: unknown[] = lines.map((line): unknown => JSON.parse(line));
    expect(parsed).toEqual([
      expect.objectContaining({ reason: "form_length_missing", request_id: "req-357" }),
      expect.not.objectContaining({ request_id: expect.anything() as unknown }),
    ]);
  });
});
