// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The size limit of a JSON body sent to a server function (ASVS 5.0 V5.2.1, V15.2.2, #347): the
// declared length at, under and over the limit, a request without a length, a streamed body that
// lies about its length, cut off at the limit without being read whole, and a failing stream.
import { describe, expect, it } from "vitest";
import { setBodyRefusalLogDeps } from "./body-refusal-log.ts";
import { carriesJson, JSON_BODY_MAX, jsonBodyRefusal, refuseJsonBody } from "./json-body-limit.ts";
import { RefusalDeduper } from "./refusal-deduper.ts";
import { setSecurityLogWriter } from "./security-log.ts";

const URL = "http://edulims.test/_serverFn/abc";
const PROXY = "10.0.0.1";
const CLIENT_A = "203.0.113.1";
const CLIENT_B = "203.0.113.2";
const JSON_TYPE = "application/json";

/** A POST whose body is `size` bytes of a JSON string, declared with its true length. */
function jsonPost(size: number, headers: Record<string, string> = {}): Request {
  const body = `"${"a".repeat(size - 2)}"`;
  return new Request(URL, {
    method: "POST",
    headers: { "content-type": JSON_TYPE, "content-length": String(size), ...headers },
    body,
  });
}

/** A stream of `chunk`-byte chunks without end that counts the bytes it hands out. */
function endlessStream(chunk: number) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulled += chunk;
        controller.enqueue(new Uint8Array(chunk).fill(0x20));
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
}

function streamedPost(stream: ReadableStream<Uint8Array>, headers: Record<string, string>) {
  // NOTE: Fetch standard, RequestInit `duplex`; a stream body needs it, and the DOM types lack it.
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers,
    body: stream,
    duplex: "half",
  };
  return new Request(URL, init);
}

describe("carriesJson", () => {
  it("takes a POST with a JSON content type, in any case and with parameters", () => {
    expect(carriesJson(jsonPost(2))).toBe(true);
    const upper = new Request(URL, {
      method: "POST",
      headers: { "content-type": "Application/JSON; charset=utf-8" },
      body: "{}",
    });
    expect(carriesJson(upper)).toBe(true);
  });

  it("leaves a GET, a HEAD, a form and a request without a content type alone", () => {
    expect(carriesJson(new Request(URL, { headers: { "content-type": JSON_TYPE } }))).toBe(false);
    expect(
      carriesJson(new Request(URL, { method: "HEAD", headers: { "content-type": JSON_TYPE } })),
    ).toBe(false);
    const form = new Request(URL, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: "x",
    });
    expect(carriesJson(form)).toBe(false);
    expect(carriesJson(new Request(URL, { method: "POST", body: "{}" }))).toBe(false);
  });

  it.each(["text/plain; profile=application/json", "application/json-patch+json"])(
    "takes %j, which names application/json inside another type, as Start does",
    (type) => {
      const request = new Request(URL, {
        method: "POST",
        headers: { "content-type": type },
        body: "{}",
      });
      expect(carriesJson(request)).toBe(true);
    },
  );
});

describe("jsonBodyRefusal (V5.2.1)", () => {
  it("lets a body of exactly the limit through, and Start can still read it", async () => {
    const request = jsonPost(JSON_BODY_MAX);
    expect(await jsonBodyRefusal(request)).toBeNull();
    const parsed: unknown = await request.json();
    expect(typeof parsed === "string" && parsed.length).toBe(JSON_BODY_MAX - 2);
  });

  it("lets a body one byte under the limit through", async () => {
    expect(await jsonBodyRefusal(jsonPost(JSON_BODY_MAX - 1))).toBeNull();
  });

  it("refuses a declared length one byte over the limit with 413 before reading the body", async () => {
    const { stream, state } = endlessStream(1024);
    const request = streamedPost(stream, {
      "content-type": JSON_TYPE,
      "content-length": String(JSON_BODY_MAX + 1),
    });
    expect(await jsonBodyRefusal(request)).toBe(413);
    expect(state.pulled).toBe(0);
  });

  it("refuses a body without a length (a chunked body) with 411 before reading it", async () => {
    const { stream, state } = endlessStream(1024);
    expect(await jsonBodyRefusal(streamedPost(stream, { "content-type": JSON_TYPE }))).toBe(411);
    expect(state.pulled).toBe(0);
  });

  it("reads a declared length with leading zeros as its number", async () => {
    const { stream, state } = endlessStream(1024);
    const over = streamedPost(stream, {
      "content-type": JSON_TYPE,
      "content-length": `000${JSON_BODY_MAX + 1}`,
    });
    expect(await jsonBodyRefusal(over)).toBe(413);
    expect(state.pulled).toBe(0);
    expect(await jsonBodyRefusal(jsonPost(100, { "content-length": "000100" }))).toBeNull();
  });

  it("rejects, never lets through, a body whose stream fails while it is read", async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(16).fill(0x20));
        controller.error(new Error("connection reset"));
      },
    });
    const request = streamedPost(failing, { "content-type": JSON_TYPE, "content-length": "64" });
    await expect(jsonBodyRefusal(request)).rejects.toThrow("connection reset");
  });

  it.each(["", "abc", "-1", "1e3", "12 34", "9".repeat(16)])(
    "refuses the length %j with 411",
    async (length) => {
      const request = new Request(URL, {
        method: "POST",
        headers: { "content-type": JSON_TYPE, "content-length": length },
        body: "{}",
      });
      expect(await jsonBodyRefusal(request)).toBe(411);
    },
  );

  it("cuts off a body that streams past the limit under a smaller declared length", async () => {
    const chunk = 64 * 1024;
    const { stream, state } = endlessStream(chunk);
    const request = streamedPost(stream, { "content-type": JSON_TYPE, "content-length": "2" });
    expect(await jsonBodyRefusal(request)).toBe(413);
    expect(state.pulled).toBeGreaterThan(JSON_BODY_MAX);
    // The chunk that passes the limit, plus the one the clone's tee reads ahead.
    expect(state.pulled).toBeLessThanOrEqual(JSON_BODY_MAX + 2 * chunk);
    expect(state.cancelled).toBe(true);
  });

  it("holds a lower limit when one is given", async () => {
    expect(await jsonBodyRefusal(jsonPost(100), 100)).toBeNull();
    expect(await jsonBodyRefusal(jsonPost(101), 100)).toBe(413);
  });

  it("leaves a request without JSON unread", async () => {
    const { stream, state } = endlessStream(1024);
    const form = streamedPost(stream, { "content-type": "multipart/form-data; boundary=x" });
    expect(await jsonBodyRefusal(form)).toBeNull();
    expect(state.pulled).toBe(0);
    expect(form.bodyUsed).toBe(false);
  });
});

describe("refuseJsonBody", () => {
  it("answers the refusal with an empty response and logs its code only", async () => {
    const lines: string[] = [];
    const restore = setSecurityLogWriter((line) => lines.push(line));
    let tooLarge: Response | null;
    let missing: Response | null;
    try {
      tooLarge = await refuseJsonBody(jsonPost(101), 100);
      missing = await refuseJsonBody(
        new Request(URL, { method: "POST", headers: { "content-type": JSON_TYPE } }),
      );
    } finally {
      restore();
    }
    expect(tooLarge?.status).toBe(413);
    expect(tooLarge?.headers.get("cache-control")).toBe("no-store");
    expect(tooLarge?.headers.get("connection")).toBe("close");
    expect(await tooLarge?.text()).toBe("");
    expect(missing?.status).toBe(411);
    expect(missing?.headers.get("connection")).toBe("close");
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        event: "input_validation_fail",
        outcome: "refused",
        reason: "json_too_large",
        status: 413,
      }),
      expect.objectContaining({ reason: "json_length_missing", status: 411 }),
    ]);
  });

  it("logs the request id the reverse proxy set, and leaves out a malformed one (#357)", async () => {
    const lines: string[] = [];
    const restore = setSecurityLogWriter((line) => lines.push(line));
    // Two clients, so the per-client window of the refusal log (#350) keeps both lines.
    const restoreLog = setBodyRefusalLogDeps({
      trustedProxies: () => [PROXY],
      deduper: new RefusalDeduper(),
    });
    try {
      await refuseJsonBody(
        jsonPost(101, { "x-request-id": "req-357", "x-forwarded-for": CLIENT_A }),
        100,
      );
      await refuseJsonBody(
        jsonPost(101, { "x-request-id": "not an id", "x-forwarded-for": CLIENT_B }),
        100,
      );
    } finally {
      restoreLog();
      restore();
    }
    const parsed: unknown[] = lines.map((line): unknown => JSON.parse(line));
    expect(parsed).toEqual([
      expect.objectContaining({ request_id: "req-357" }),
      expect.not.objectContaining({ request_id: expect.anything() as unknown }),
    ]);
  });

  it("lets a body within the limit through without a log line", async () => {
    const lines: string[] = [];
    const restore = setSecurityLogWriter((line) => lines.push(line));
    try {
      expect(await refuseJsonBody(jsonPost(100), 100)).toBeNull();
    } finally {
      restore();
    }
    expect(lines).toEqual([]);
  });
});
