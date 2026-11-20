// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A raw HTTP/1.1 POST on a socket, for the request size limits (ASVS 5.0 V5.2.1, V15.2.2; #292,
// #347, #350): it can declare one `Content-Length` and send another number of bytes, or send a
// chunked body without a length, which an HTTP client does not let a test control, and it
// reports whether the server closed the socket before the body was all written.
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

/** How the body is framed: a declared `Content-Length`, or `chunked` without a length. */
type Framing = { readonly declared: number } | "chunked";

const CHUNK = 64 * 1024;

function send(
  path: string,
  headers: Readonly<Record<string, string>>,
  framing: Framing,
  size: number,
): Promise<RawResult> {
  const url = new URL(path, appUrl());
  const head = [
    `POST ${url.pathname} HTTP/1.1`,
    `Host: ${url.host}`,
    `Origin: ${url.origin}`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    framing === "chunked" ? "Transfer-Encoding: chunked" : `Content-Length: ${framing.declared}`,
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
        closedEarly: written < size,
      });
    };
    socket.on("data", (chunk: Buffer) => {
      answer += chunk.toString("latin1");
    });
    socket.on("close", finish);
    socket.on("error", finish);
    const data = Buffer.alloc(CHUNK, 0x61);
    const frame = (part: Buffer): Buffer =>
      framing === "chunked"
        ? Buffer.concat([Buffer.from(`${part.length.toString(16)}\r\n`), part, Buffer.from("\r\n")])
        : part;
    const pump = () => {
      while (!closed && written < size) {
        const part = data.subarray(0, Math.min(CHUNK, size - written));
        written += part.length;
        if (!socket.write(frame(part))) {
          socket.once("drain", pump);
          return;
        }
      }
      if (closed) return;
      if (framing === "chunked") socket.write("0\r\n\r\n");
      setTimeout(() => socket.end(), 2_000);
    };
    socket.write(head, pump);
  });
}

/**
 * POSTs to `path` on the app with `headers` and a `Content-Length` of `declared`, then writes
 * `size` body bytes in 64 KiB writes until the server closes the socket. After the whole body it
 * waits 2 s for the answer, then ends the socket.
 */
export function rawPost(
  path: string,
  headers: Readonly<Record<string, string>>,
  declared: number,
  size: number = declared,
): Promise<RawResult> {
  return send(path, headers, { declared }, size);
}

/**
 * POSTs to `path` on the app with `headers` and a chunked body of `size` bytes in 64 KiB chunks,
 * without a `Content-Length`, as {@link rawPost} does otherwise.
 */
export function rawChunkedPost(
  path: string,
  headers: Readonly<Record<string, string>>,
  size: number,
): Promise<RawResult> {
  return send(path, headers, "chunked", size);
}
