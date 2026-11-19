// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The MLLP test sender of #159: the framing of the Afinion 2 HL7 Connectivity Protocol v4.0
// (§1.4: `<VT>` message `<FS><CR>`), the ACK codes of §3.4, and a loopback send against an
// in-process TCP server (S5, P-02). No FerroBRIDGE and no Compose stack.
import { readFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deframeMllp,
  frameMllp,
  MLLP_CR,
  MLLP_END,
  MLLP_START,
  readAck,
  sendMllp,
} from "../integration/mllp-sender.ts";

const DIR = join(import.meta.dirname, "..", "fixtures", "hl7");
const fixture = (name: string): Buffer => readFileSync(join(DIR, name));
const ORU = fixture("crp-patient-pid3.hl7");
const ACK_AA = fixture("ack-aa.hl7");
const ACK_CA = fixture("ack-ca.hl7");
const ACK_AE = Buffer.from(ACK_AA.toString("latin1").replace("MSA|AA|", "MSA|AE|"), "latin1");

describe("frameMllp (protocol §1.4)", () => {
  it("wraps the message bytes in <VT> and <FS><CR>", () => {
    const framed = frameMllp(Buffer.from("MSH|x\r", "latin1"));
    expect([...framed]).toEqual([0x0b, ...Buffer.from("MSH|x\r", "latin1"), 0x1c, 0x0d]);
  });

  it("leaves the payload byte for byte as given", () => {
    expect(frameMllp(ORU).subarray(1, -2).equals(ORU)).toBe(true);
  });

  it("refuses a payload that holds a start or an end block byte", () => {
    expect(() => frameMllp(Buffer.of(0x41, MLLP_START))).toThrow(RangeError);
    expect(() => frameMllp(Buffer.of(0x41, MLLP_END))).toThrow(RangeError);
  });
});

describe("deframeMllp", () => {
  it("returns the payload of a whole frame", () => {
    const result = deframeMllp(frameMllp(ACK_AA));
    if (result.kind !== "frame") expect.fail(`got ${result.kind}`);
    expect(result.payload.equals(ACK_AA)).toBe(true);
    expect(result.rest).toHaveLength(0);
  });

  it("returns the bytes after the frame as the rest", () => {
    const trailing = Buffer.from("tail", "latin1");
    const result = deframeMllp(Buffer.concat([frameMllp(ACK_AA), trailing]));
    if (result.kind !== "frame") expect.fail(`got ${result.kind}`);
    expect(result.payload.equals(ACK_AA)).toBe(true);
    expect(result.rest.equals(trailing)).toBe(true);
  });

  it("waits for more bytes until <FS><CR> has arrived, chunk by chunk", () => {
    const framed = frameMllp(ACK_AA);
    for (let cut = 0; cut < framed.length; cut += 1) {
      expect(deframeMllp(framed.subarray(0, cut))).toEqual({ kind: "incomplete" });
    }
    expect(deframeMllp(framed).kind).toBe("frame");
  });

  it("refuses bytes that do not start with <VT>", () => {
    expect(deframeMllp(Buffer.from("MSH|", "latin1"))).toEqual({
      kind: "malformed",
      reason: "no start block",
    });
  });

  it("refuses an end block without a carriage return after it", () => {
    expect(deframeMllp(Buffer.of(MLLP_START, 0x41, MLLP_END, 0x41)).kind).toBe("malformed");
  });

  it("refuses a second start block inside a frame", () => {
    expect(deframeMllp(Buffer.of(MLLP_START, 0x41, MLLP_START)).kind).toBe("malformed");
    const nested = Buffer.of(MLLP_START, 0x41, MLLP_START, 0x41, MLLP_END, MLLP_CR);
    expect(deframeMllp(nested).kind).toBe("malformed");
  });
});

describe("readAck (protocol §3.4)", () => {
  it("accepts AA and CA", () => {
    expect(readAck(ACK_AA.toString("latin1"))).toEqual({ kind: "acknowledged", code: "AA" });
    expect(readAck(ACK_CA.toString("latin1"))).toEqual({ kind: "acknowledged", code: "CA" });
  });

  it("reads AE as a refusal", () => {
    expect(readAck(ACK_AE.toString("latin1"))).toEqual({ kind: "refused", code: "AE" });
  });

  it("refuses an answer without MSH, without MSA or with an unknown code", () => {
    expect(readAck("MSA|AA|1000\r").kind).toBe("malformed");
    expect(readAck("MSH|^~\\&|X\r").kind).toBe("malformed");
    expect(readAck("MSH|^~\\&|X\rMSA|OK|1000\r").kind).toBe("malformed");
  });
});

type Answer = (socket: Socket, received: Buffer) => void;

let server: Server | undefined;
const sockets = new Set<Socket>();

/** Starts a loopback TCP server that calls `answer` once a whole frame has arrived. */
async function listen(answer: Answer): Promise<{ port: number; received: () => Buffer }> {
  let received: Buffer = Buffer.alloc(0);
  const started = createServer((socket) => {
    sockets.add(socket);
    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      if (deframeMllp(received).kind === "frame") answer(socket, received);
    });
  });
  server = started;
  await new Promise<void>((resolve) => started.listen(0, "127.0.0.1", resolve));
  const address = started.address();
  if (address === null || typeof address === "string") throw new Error("no TCP address");
  return { port: address.port, received: () => received };
}

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  const running = server;
  server = undefined;
  if (running === undefined) return;
  await new Promise<void>((resolve) => running.close(() => resolve()));
});

const send = (port: number, timeoutMs = 2000) =>
  sendMllp({ host: "127.0.0.1", port, message: ORU, timeoutMs });

describe("sendMllp over loopback", () => {
  it("sends the framed message bytes and returns an AA acknowledgement", async () => {
    const peer = await listen((socket) => socket.write(frameMllp(ACK_AA)));
    const result = await send(peer.port);
    expect(result).toEqual({
      kind: "acknowledged",
      code: "AA",
      ack: ACK_AA.toString("latin1"),
    });
    expect(peer.received().equals(frameMllp(ORU))).toBe(true);
  });

  it("reads an ACK split over several TCP chunks with bytes after it", async () => {
    const peer = await listen((socket) => {
      const framed = Buffer.concat([frameMllp(ACK_CA), Buffer.from("junk", "latin1")]);
      socket.write(framed.subarray(0, 1));
      setTimeout(() => socket.write(framed.subarray(1, 20)), 10);
      setTimeout(() => socket.write(framed.subarray(20, -5)), 20);
      setTimeout(() => socket.write(framed.subarray(-5)), 30);
    });
    expect(await send(peer.port)).toMatchObject({ kind: "acknowledged", code: "CA" });
  });

  it("returns a refusal for an AE answer", async () => {
    const peer = await listen((socket) => socket.write(frameMllp(ACK_AE)));
    expect(await send(peer.port)).toMatchObject({ kind: "refused", code: "AE" });
  });

  it("times out when the receiver never answers", async () => {
    const peer = await listen(() => undefined);
    expect(await send(peer.port, 150)).toEqual({ kind: "timeout", afterMs: 150 });
  });

  it("returns malformed for an answer that is no MLLP frame", async () => {
    const peer = await listen((socket) => socket.write("garbage\r\n"));
    expect(await send(peer.port)).toEqual({ kind: "malformed", reason: "no start block" });
  });

  it("returns malformed for a framed answer that is no ACK", async () => {
    const peer = await listen((socket) => socket.write(frameMllp(Buffer.from("hello\r"))));
    expect(await send(peer.port)).toEqual({ kind: "malformed", reason: "no MSH segment" });
  });

  it("returns a connection error when the receiver closes without an ACK", async () => {
    const peer = await listen((socket) => socket.end());
    expect(await send(peer.port)).toMatchObject({ kind: "connection-error" });
  });

  it("returns a connection error when nothing listens on the port", async () => {
    const peer = await listen(() => undefined);
    const closed = server;
    server = undefined;
    await new Promise<void>((resolve) => closed?.close(() => resolve()));
    expect(await send(peer.port)).toMatchObject({ kind: "connection-error" });
  });
});
