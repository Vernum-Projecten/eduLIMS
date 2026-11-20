// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The request size limits on the built server (ASVS 5.0 V5.2.1, V15.2.2, #347): a JSON body over
// the limit is 413 and closes the connection unread, a chunked body without a length is 411, a
// body at the limit reaches Start, and a GET payload over Node's header limit is 431.
import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";
import { JSON_BODY_MAX } from "../../src/server/json-body-limit";
import { rawPost } from "./raw-http";
import { appUrl } from "./run-env";

const PATH = "/_serverFn/any";

test("refuses a JSON body over the limit with 413 (V5.2.1)", async () => {
  // A raw socket reads the 413 even when the server closes before the body is all written; an
  // HTTP client can fail on that close with a reset (#358).
  const result = await rawPost(PATH, { "Content-Type": "application/json" }, JSON_BODY_MAX + 1);
  expect(result.status).toMatch(/^HTTP\/1\.1 413\b/);
  expect(result.answer).toMatch(/\r\nconnection: close\r\n/i);
  // The body is empty: nothing after the headers, or only the last chunk of a chunked answer.
  const end = result.answer.indexOf("\r\n\r\n");
  const headers = result.answer.slice(0, end);
  const body = result.answer.slice(end + 4);
  expect(body).toBe(/\r\ntransfer-encoding: chunked(\r\n|$)/i.test(headers) ? "0\r\n\r\n" : "");
});

test("lets a JSON body of exactly the limit past the check (V5.2.1)", async ({ request }) => {
  const response = await request.post(PATH, {
    headers: { Origin: appUrl(), "Content-Type": "application/json" },
    data: Buffer.alloc(JSON_BODY_MAX, 0x20),
  });
  expect([411, 413]).not.toContain(response.status());
});

test("refuses a chunked JSON body without a length with 411 (V5.2.1)", async () => {
  const url = new URL(PATH, appUrl());
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const outgoing = httpRequest(url, {
      method: "POST",
      headers: {
        Origin: appUrl(),
        "Content-Type": "application/json",
        "Transfer-Encoding": "chunked",
      },
    });
    outgoing.on("response", (incoming) => {
      incoming.resume();
      resolve(incoming.statusCode);
    });
    outgoing.on("error", reject);
    outgoing.write('{"data":');
    outgoing.end("1}");
  });
  expect(status).toBe(411);
});

test("closes the connection after a 413 instead of draining the refused body (V15.2.2)", async () => {
  const declared = 100 * 1024 * 1024;
  const result = await rawPost(PATH, { "Content-Type": "application/json" }, declared);
  expect(result.status).toMatch(/^HTTP\/1\.1 413\b/);
  expect(result.answer).toMatch(/\r\nconnection: close\r\n/i);
  expect(result.closedEarly).toBe(true);
  expect(result.written).toBeLessThan(declared);
});

test("refuses a GET payload over Node's 16 KiB header limit with 431 (V5.2.1)", async ({
  request,
}) => {
  const response = await request.get(`${PATH}?payload=${"a".repeat(20 * 1024)}`, {
    headers: { Origin: appUrl() },
  });
  expect(response.status()).toBe(431);
});
