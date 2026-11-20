// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A raw HTTP/1.1 POST on a socket, for the request size limits (ASVS 5.0 V5.2.1, V15.2.2; #292,
// #347): it can declare one `Content-Length` and send another number of bytes, which an HTTP
// client refuses to do, and it reports whether the server closed the socket before the body was
// all written.
import { connect } from "node:net";
import { appUrl } from "./run-env";

/** What came back from {@link rawPost}. */
export interface RawResult {
  /** The status line of the first response, or `""` when none came. */
  readonly status: string;
  /** Everything the server sent, as Latin-1 text. */
  readonly answer: string;
  /** How many body bytes the client wrote before the socket closed or the body ended. */
  readonly written: number;
  /** Whether the server closed the socket before the client had written `send` bytes. */
  readonly closedEarly: boolean;
}

/**
 * POSTs to `path` on the app with `headers` and a `Content-Length` of `declared`, then writes
 * `send` body bytes in 64 KiB writes until the server closes the socket. After the whole body it
 * waits 2 s for the answer, then ends the socket.
 */
export function rawPost(
  path: string,
  headers: Readonly<Record<string, string>>,
  declared: number,
  send: number = declared,
): Promise<RawResult> {
  const url = new URL(path, appUrl());
  const head = [
    `POST ${url.pathname} HTTP/1.1`,
    `Host: ${url.host}`,
    `Origin: ${url.origin}`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    `Content-Length: ${declared}`,
    "",
    "",
  ].join("\r\n");
  return new Promise((resolve) => {
    const socket = connect({ host: url.hostname, port: Number(url.port) });
    let answer = "";
    let written = 0;
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      resolve({
        status: answer.split("\r\n")[0] ?? "",
        answer,
        written,
        closedEarly: written < send,
      });
    };
    socket.on("data", (chunk: Buffer) => {
      answer += chunk.toString("latin1");
    });
    socket.on("close", finish);
    socket.on("error", finish);
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    const pump = () => {
      while (!closed && written < send) {
        const size = Math.min(chunk.length, send - written);
        written += size;
        if (!socket.write(chunk.subarray(0, size))) {
          socket.once("drain", pump);
          return;
        }
      }
      if (!closed) setTimeout(() => socket.end(), 2_000);
    };
    socket.write(head, pump);
  });
}
