// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A raw HTTP/1.1 request on a socket, for the request size limits (ASVS 5.0 V5.2.1, V15.2.2;
// #292, #347, #350): it can declare one `Content-Length` and send another number of bytes, or
// send a chunked body without a length, which an HTTP client does not let a test control, and it
// reports whether the server closed the socket before the body was all written.
import { connect } from "node:net";
import { appUrl } from "./run-env";

/** What came back from {@link rawRequest}. */
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
export type Framing = { readonly declared: number } | "chunked";

/**
 * How long {@link rawRequest} waits after the headers for an answer before it writes the body. A
 * server that refuses on the headers answers here, and no body byte is then in flight.
 */
const EARLY_ANSWER_MS = 1_000;

const CHUNK = 64 * 1024;

/**
 * Sends `method` to `path` on the app with `headers` and `send` body bytes framed as `framing`,
 * in 64 KiB writes, until the server closes the socket. It pauses up to {@link EARLY_ANSWER_MS}
 * after the headers and, with a declared length, again after `declared` bytes, so an answer at
 * either point is read before more bytes are in flight. After the whole body it waits 2 s for the
 * answer, then ends the socket.
 *
 * A server that closes with unread bytes in its socket sends a reset, and the reset can discard
 * an answer the client has not read yet (#358): up to the declared length (the whole of a chunked
 * body), writing stops at the first answer byte; the overrun past it is still sent.
 */
export function rawRequest(
  method: string,
  path: string,
  headers: Readonly<Record<string, string>>,
  framing: Framing,
  send: number,
): Promise<RawResult> {
  const url = new URL(path, appUrl());
  const chunked = framing === "chunked";
  const declared = chunked ? send : framing.declared;
  const head = [
    `${method} ${url.pathname} HTTP/1.1`,
    `Host: ${url.host}`,
    `Origin: ${url.origin}`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    chunked ? "Transfer-Encoding: chunked" : `Content-Length: ${declared}`,
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
    let answered = false;
    let ending = false;
    const endSoon = () => {
      if (ending || closed) return;
      ending = true;
      setTimeout(() => socket.end(), 2_000);
    };
    socket.on("data", (data: Buffer) => {
      answer += data.toString("latin1");
      answered = true;
      endSoon();
    });
    socket.on("close", finish);
    socket.on("error", finish);
    const data = Buffer.alloc(CHUNK, 0x61);
    const frame = (part: Buffer): Buffer =>
      chunked
        ? Buffer.concat([Buffer.from(`${part.length.toString(16)}\r\n`), part, Buffer.from("\r\n")])
        : part;
    let pausedAtDeclared = false;
    const pump = () => {
      // Up to the declared length, an answer means the server will read no more of it; past it,
      // the bytes are the overrun under test and go out whatever the answer said.
      while (!closed && written < send && !(answered && written < declared)) {
        if (written === declared && !pausedAtDeclared) {
          pausedAtDeclared = true;
          setTimeout(pump, EARLY_ANSWER_MS);
          return;
        }
        const limit = written < declared ? declared : send;
        const part = data.subarray(0, Math.min(CHUNK, limit - written));
        written += part.length;
        if (!socket.write(frame(part))) {
          socket.once("drain", pump);
          return;
        }
      }
      if (chunked && !closed && !answered && written === send) socket.write("0\r\n\r\n");
      endSoon();
    };
    socket.write(head, () => {
      setTimeout(() => {
        if (!closed && !answered) pump();
      }, EARLY_ANSWER_MS);
    });
  });
}

/**
 * POSTs to `path` with a `Content-Length` of `declared` and `send` body bytes, as
 * {@link rawRequest} does.
 */
export function rawPost(
  path: string,
  headers: Readonly<Record<string, string>>,
  declared: number,
  send: number = declared,
): Promise<RawResult> {
  return rawRequest("POST", path, headers, { declared }, send);
}

/** POSTs to `path` a chunked body of `size` bytes without a length, as {@link rawRequest} does. */
export function rawChunkedPost(
  path: string,
  headers: Readonly<Record<string, string>>,
  size: number,
): Promise<RawResult> {
  return rawRequest("POST", path, headers, "chunked", size);
}
