// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The request size limits on the built server (ASVS 5.0 V5.2.1, V15.2.2, #347): a JSON body over
// the limit is 413 and closes the connection unread, a chunked body without a length is 411, a
// body at the limit reaches Start, and a GET payload over Node's header limit is 431.
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
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

/** Opens a raw connection and resolves with the response head to a POST that declares `length`. */
function declareBody(url: URL, length: number) {
  const socket = connect(Number(url.port), url.hostname);
  const state = { closed: false };
  socket.on("close", () => {
    state.closed = true;
  });
  const head = new Promise<string>((resolve, reject) => {
    let received = "";
    socket.on("data", (data: Buffer) => {
      received += data.toString("latin1");
      if (received.includes("\r\n\r\n")) resolve(received);
    });
    socket.once("error", reject);
  });
  socket.write(
    `POST ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\nOrigin: ${appUrl()}\r\n` +
      `Content-Type: application/json\r\nContent-Length: ${length}\r\n\r\n`,
  );
  return { socket, state, head };
}

test("closes the connection after a 413 instead of draining the refused body (V15.2.2)", async () => {
  const declared = 100 * 1024 * 1024;
  const { socket, state, head } = declareBody(new URL(PATH, appUrl()), declared);
  const response = await head;
  expect(response.split("\r\n")[0]).toMatch(/^HTTP\/1\.1 413\b/);
  expect(response).toMatch(/\r\nconnection: close\r\n/i);

  // Write the declared body after the refusal; the server closes the socket long before its end.
  socket.on("error", () => undefined);
  const chunk = Buffer.alloc(1024 * 1024, 0x20);
  let written = 0;
  const started = Date.now();
  while (!state.closed && written < declared && Date.now() - started < 10_000) {
    if (!socket.write(chunk)) {
      await new Promise((resolve) => {
        socket.once("drain", resolve);
        socket.once("close", resolve);
      });
    }
    written += chunk.length;
  }
  socket.destroy();
  expect(state.closed).toBe(true);
  expect(written).toBeLessThan(declared);
});

test("refuses a GET payload over Node's 16 KiB header limit with 431 (V5.2.1)", async ({
  request,
}) => {
  const response = await request.get(`${PATH}?payload=${"a".repeat(20 * 1024)}`, {
    headers: { Origin: appUrl() },
  });
  expect(response.status()).toBe(431);
});
