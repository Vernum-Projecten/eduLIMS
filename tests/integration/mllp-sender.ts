// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// An MLLP sender that plays the Afinion 2 for the integration tests: it frames one HL7 message,
// sends it over plain TCP and reads the framed ACK (Afinion 2 HL7 Connectivity Protocol v4.0,
// §1.4 and §3.4; #159). The analyser has no TLS, so neither has this sender. Test support for
// tests/ only: nothing under src/ imports it (tests/unit/test-support-boundary.test.ts).
import { connect } from "node:net";

/** The start block `<VT>` (0x0B) before every message (protocol §1.4). */
export const MLLP_START = 0x0b;
/** The end block `<FS>` (0x1C) after every message (protocol §1.4). */
export const MLLP_END = 0x1c;
/** The carriage return `<CR>` (0x0D) after the end block (protocol §1.4). */
export const MLLP_CR = 0x0d;

/** Returns `<VT>` message `<FS><CR>` for the message bytes, as the protocol frames them. */
export function frameMllp(message: Uint8Array): Buffer {
  if (message.includes(MLLP_START) || message.includes(MLLP_END)) {
    throw new RangeError("an MLLP payload holds no start or end block byte");
  }
  return Buffer.concat([Buffer.of(MLLP_START), message, Buffer.of(MLLP_END, MLLP_CR)]);
}

/** The state of a receive buffer: a whole frame with what follows it, not yet one, or broken. */
export type DeframeResult =
  | { readonly kind: "frame"; readonly payload: Buffer; readonly rest: Buffer }
  | { readonly kind: "incomplete" }
  | { readonly kind: "malformed"; readonly reason: string };

/** Reads the first MLLP frame from the bytes received so far. */
export function deframeMllp(received: Uint8Array): DeframeResult {
  const bytes = Buffer.from(received.buffer, received.byteOffset, received.byteLength);
  if (bytes.length === 0) return { kind: "incomplete" };
  if (bytes[0] !== MLLP_START) return { kind: "malformed", reason: "no start block" };
  const end = bytes.indexOf(MLLP_END, 1);
  const secondStart = bytes.indexOf(MLLP_START, 1);
  if (secondStart !== -1 && (end === -1 || secondStart < end)) {
    return { kind: "malformed", reason: "a second start block before the end block" };
  }
  if (end === -1 || end + 1 >= bytes.length) return { kind: "incomplete" };
  if (bytes[end + 1] !== MLLP_CR) {
    return { kind: "malformed", reason: "no carriage return after the end block" };
  }
  return {
    kind: "frame",
    payload: Buffer.from(bytes.subarray(1, end)),
    rest: Buffer.from(bytes.subarray(end + 2)),
  };
}

/** MSA-1 codes the Afinion 2 accepts as an acknowledgement (protocol §3.4). */
export type AcceptedAckCode = "AA" | "CA";
/** MSA-1 codes of HL7 v2.4 that refuse a message; the analyser logs them (protocol §3.4). */
export type RefusedAckCode = "AE" | "AR" | "CE" | "CR";

/** What became of one send. */
export type MllpSendResult =
  | { readonly kind: "acknowledged"; readonly code: AcceptedAckCode; readonly ack: string }
  | { readonly kind: "refused"; readonly code: RefusedAckCode; readonly ack: string }
  | { readonly kind: "timeout"; readonly afterMs: number }
  | { readonly kind: "connection-error"; readonly reason: string; readonly cause?: Error }
  | { readonly kind: "malformed"; readonly reason: string };

/** The ACK read from a de-framed payload: its MSA-1 code, or why it is no ACK. */
export type AckReading =
  | { readonly kind: "acknowledged"; readonly code: AcceptedAckCode }
  | { readonly kind: "refused"; readonly code: RefusedAckCode }
  | { readonly kind: "malformed"; readonly reason: string };

const ACCEPTED: ReadonlySet<string> = new Set<AcceptedAckCode>(["AA", "CA"]);
const REFUSED: ReadonlySet<string> = new Set<RefusedAckCode>(["AE", "AR", "CE", "CR"]);

function isAccepted(code: string): code is AcceptedAckCode {
  return ACCEPTED.has(code);
}

function isRefused(code: string): code is RefusedAckCode {
  return REFUSED.has(code);
}

/** Reads MSA-1 of an ACK: MSH first, then an MSA segment (protocol §2.3, §3.4). */
export function readAck(ack: string): AckReading {
  const segments = ack.split("\r").filter((line) => line !== "");
  if (!segments[0]?.startsWith("MSH|")) return { kind: "malformed", reason: "no MSH segment" };
  const msa = segments.find((line) => line.startsWith("MSA|"));
  if (msa === undefined) return { kind: "malformed", reason: "no MSA segment" };
  const code = msa.split("|")[1] ?? "";
  if (isAccepted(code)) return { kind: "acknowledged", code };
  if (isRefused(code)) return { kind: "refused", code };
  return { kind: "malformed", reason: "MSA-1 holds no HL7 acknowledgement code" };
}

/** Where and how to send one message. */
export interface MllpSendOptions {
  readonly host: string;
  readonly port: number;
  /** The message bytes, sent as they are; never a string re-encoded on the way. */
  readonly message: Uint8Array;
  /** How long to wait for the connection and the whole ACK together. */
  readonly timeoutMs: number;
}

/**
 * Sends one HL7 message over MLLP and waits for its framed ACK.
 *
 * Bytes after the first complete frame are ignored. The result is a value, never a rejection.
 */
export function sendMllp(options: MllpSendOptions): Promise<MllpSendResult> {
  const framed = frameMllp(options.message);
  return new Promise((resolve) => {
    let received: Buffer = Buffer.alloc(0);
    let settled = false;
    const socket = connect({ host: options.host, port: options.port });
    const finish = (result: MllpSendResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ kind: "timeout", afterMs: options.timeoutMs }),
      options.timeoutMs,
    );

    socket.on("connect", () => socket.write(framed));
    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      const result = deframeMllp(received);
      switch (result.kind) {
        case "incomplete":
          return;
        case "malformed":
          finish({ kind: "malformed", reason: result.reason });
          return;
        case "frame": {
          const ack = result.payload.toString("latin1");
          const reading = readAck(ack);
          finish(reading.kind === "malformed" ? reading : { ...reading, ack });
          return;
        }
        default: {
          const unreachable: never = result;
          return unreachable;
        }
      }
    });
    socket.on("error", (cause: Error) =>
      finish({ kind: "connection-error", reason: cause.message, cause }),
    );
    socket.on("close", () =>
      finish({ kind: "connection-error", reason: "the connection closed before a whole ACK" }),
    );
  });
}
