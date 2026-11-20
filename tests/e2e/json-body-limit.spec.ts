// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The size limit of a JSON body to a server function on the built server (ASVS 5.0 V5.2.1,
// #347): over the limit is 413, a chunked body without a length is 411, and a body at the limit
// passes the check and reaches Start.
import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";
import { JSON_BODY_MAX } from "../../src/server/json-body-limit";
import { appUrl } from "./run-env";

const PATH = "/_serverFn/any";

test("refuses a JSON body over the limit with 413 (V5.2.1)", async ({ request }) => {
  const response = await request.post(PATH, {
    headers: { Origin: appUrl(), "Content-Type": "application/json" },
    data: Buffer.alloc(JSON_BODY_MAX + 1, 0x20),
  });
  expect(response.status()).toBe(413);
  expect(await response.body()).toHaveLength(0);
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
