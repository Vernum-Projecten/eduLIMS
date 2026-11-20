// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The log of refused request bodies (ASVS V16.2.5, #350): one line per client and reason in a
// minute, carrying how many refusals it stands for, for the JSON, form and route limits alike.
import { describe, expect, it } from "vitest";
import { logBodyRefusal, setBodyRefusalLogDeps } from "./body-refusal-log.ts";
import { refuseFormBody } from "./form-body-limit.ts";
import { refuseJsonBody } from "./json-body-limit.ts";
import { RefusalDeduper } from "./refusal-deduper.ts";
import { refuseRouteBody } from "./route-body-limit.ts";
import { setSecurityLogWriter } from "./security-log.ts";

const PROXY = "10.0.0.1";

function fromClient(path: string, client: string, headers: Record<string, string> = {}) {
  return new Request(`http://edulims.test${path}`, {
    method: "POST",
    headers: { "x-forwarded-for": client, ...headers },
  });
}

/** Runs `body` with a fresh window behind {@link PROXY}, and returns the parsed log lines. */
async function logged(body: () => Promise<void> | void): Promise<unknown[]> {
  const lines: string[] = [];
  const restoreWriter = setSecurityLogWriter((line) => lines.push(line));
  const restoreLog = setBodyRefusalLogDeps({
    trustedProxies: () => [PROXY],
    deduper: new RefusalDeduper(),
  });
  try {
    await body();
  } finally {
    restoreLog();
    restoreWriter();
  }
  return lines.map((line): unknown => JSON.parse(line));
}

describe("logBodyRefusal", () => {
  it("writes one line per minute window for 1,000 refusals from one address", async () => {
    const start = 1_000_000;
    const parsed = await logged(() => {
      for (let i = 0; i < 1_000; i += 1) {
        const request = fromClient("/api/health", "203.0.113.7");
        logBodyRefusal(request, { reason: "route_body_too_large", status: 413 }, start + i);
      }
      const next = fromClient("/api/health", "203.0.113.7");
      logBodyRefusal(next, { reason: "route_body_too_large", status: 413 }, start + 60_000);
    });
    expect(parsed).toEqual([
      expect.objectContaining({ reason: "route_body_too_large", refused_count: 1 }),
      expect.objectContaining({ reason: "route_body_too_large", refused_count: 1_000 }),
    ]);
  });

  it("keeps a line for each client and for each reason", async () => {
    const parsed = await logged(() => {
      const refusal = { reason: "json_too_large", status: 413 } as const;
      logBodyRefusal(fromClient("/", "203.0.113.1"), refusal);
      logBodyRefusal(fromClient("/", "203.0.113.2"), refusal);
      logBodyRefusal(fromClient("/", "203.0.113.1"), {
        reason: "json_length_missing",
        status: 411,
      });
    });
    expect(parsed).toHaveLength(3);
  });

  it("puts every client without a trusted proxy in one window", async () => {
    const lines: string[] = [];
    const restore = setSecurityLogWriter((line) => lines.push(line));
    try {
      logBodyRefusal(fromClient("/", "203.0.113.1"), { reason: "form_too_large", status: 413 });
      logBodyRefusal(fromClient("/", "203.0.113.2"), { reason: "form_too_large", status: 413 });
    } finally {
      restore();
    }
    expect(lines).toHaveLength(1);
  });

  it("deduplicates the JSON, form and route refusals", async () => {
    const parsed = await logged(async () => {
      for (let i = 0; i < 3; i += 1) {
        const json = fromClient("/_serverFn/abc", "203.0.113.9", {
          "content-type": "application/json",
        });
        await refuseJsonBody(json);
        refuseFormBody(
          fromClient("/_serverFn/abc", "203.0.113.9", { "content-type": "multipart/form-data" }),
        );
        await refuseRouteBody(fromClient("/student", "203.0.113.9", { "content-length": "1" }));
      }
    });
    expect(parsed).toEqual([
      expect.objectContaining({ reason: "json_length_missing", refused_count: 1 }),
      expect.objectContaining({ reason: "form_length_missing", refused_count: 1 }),
      expect.objectContaining({ reason: "route_body_too_large", kind: "none", refused_count: 1 }),
    ]);
  });
});
