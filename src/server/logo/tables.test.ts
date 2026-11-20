// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The segments and chunks the filter keeps carry their own data and nothing else (the security
// review of #346): a JPEG DQT, DHT or DRI must consume its segment exactly (T.81 B.2.4), a PNG
// palette fits its bit depth (§11.2.3), and a truecolour image's suggested palette is dropped.
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { checkLogo } from "./image.ts";
import { concat } from "./png.ts";
import {
  ascii,
  contains,
  exifWithPosition,
  idat,
  ihdr,
  jpeg,
  jpegSegment,
  pngChunk,
  pngOf,
  XMP_WITH_POSITION,
} from "./test-images.ts";

const bytes = (...parts: Uint8Array[]) => concat(parts);

/** One Huffman table of class and id `kind` with the single code `0`. */
const huffman = (kind: number) =>
  bytes(Uint8Array.of(kind, 1), new Uint8Array(15), Uint8Array.of(0));

describe("a kept JPEG table carries nothing else (N1)", () => {
  const exif = bytes(ascii("Exif\0\0"), exifWithPosition());
  const quant = (extra: Uint8Array = new Uint8Array()) =>
    jpegSegment(0xdb, bytes(Uint8Array.of(0), new Uint8Array(64).fill(1), extra));

  it.each<[string, Uint8Array]>([
    ["EXIF appended to a DQT", quant(exif)],
    ["XMP in a DRI", jpegSegment(0xdd, bytes(Uint8Array.of(0, 0), XMP_WITH_POSITION))],
    ["XMP in place of a DHT", jpegSegment(0xc4, XMP_WITH_POSITION)],
    [
      "a DHT with a byte after its counted values",
      jpegSegment(0xc4, bytes(huffman(0x00), Uint8Array.of(7))),
    ],
    [
      "a DHT with no code at all",
      jpegSegment(0xc4, bytes(Uint8Array.of(0x00), new Uint8Array(16))),
    ],
    ["a DHT of table class 2", jpegSegment(0xc4, huffman(0x20))],
    ["a DHT for table 4", jpegSegment(0xc4, huffman(0x04))],
    [
      "a DQT of 16-bit values",
      jpegSegment(0xdb, bytes(Uint8Array.of(0x10), new Uint8Array(128).fill(1))),
    ],
    [
      "a DQT for table 4",
      jpegSegment(0xdb, bytes(Uint8Array.of(0x04), new Uint8Array(64).fill(1))),
    ],
    ["an empty DQT", jpegSegment(0xdb)],
    ["a DRI of 3 bytes", jpegSegment(0xdd, Uint8Array.of(0))],
    ["a DRI of 5 bytes", jpegSegment(0xdd, Uint8Array.of(0, 1, 2))],
  ])("refuses %s", (_name, carrier) => {
    expect(checkLogo(jpeg(8, 8, { before: [carrier] }))).toEqual({
      ok: false,
      fault: { kind: "logo_malformed", at: "jpeg_table" },
    });
  });

  it("accepts a DQT and a DHT that each hold two tables exactly", () => {
    const twoQuant = jpegSegment(
      0xdb,
      bytes(
        Uint8Array.of(0x00),
        new Uint8Array(64).fill(1),
        Uint8Array.of(0x01),
        new Uint8Array(64).fill(2),
      ),
    );
    const twoHuffman = jpegSegment(0xc4, bytes(huffman(0x01), huffman(0x11)));
    expect(checkLogo(jpeg(8, 8, { before: [twoQuant, twoHuffman] })).ok).toBe(true);
  });
});

describe("a PNG palette (N2)", () => {
  it.each([2, 6])(
    "drops the suggested palette of colour type %i, text in it included",
    (colourType) => {
      const text = ascii("GPSLatitude=12,34.9N;");
      const plte = pngChunk("PLTE", bytes(text, new Uint8Array(3 - (text.length % 3))));
      const clean = pngOf([ihdr(2, 2, { colourType }), idat(2, 2), pngChunk("IEND")]);
      const input = pngOf([ihdr(2, 2, { colourType }), plte, idat(2, 2), pngChunk("IEND")]);
      const result = checkLogo(input);
      if (!result.ok) throw new Error(JSON.stringify(result.fault));
      expect(contains(result.image.bytes, ascii("GPSLatitude"))).toBe(false);
      expect(result.image.bytes).toEqual(clean);
    },
  );

  it("still refuses a second palette in a truecolour image", () => {
    const plte = pngChunk("PLTE", Uint8Array.of(1, 2, 3));
    const input = pngOf([ihdr(2, 2, { colourType: 2 }), plte, plte, idat(2, 2), pngChunk("IEND")]);
    expect(checkLogo(input)).toEqual({
      ok: false,
      fault: { kind: "logo_malformed", at: "png_order" },
    });
  });

  it.each<[number, number, boolean]>([
    [1, 2, true],
    [1, 3, false],
    [2, 4, true],
    [2, 5, false],
    [4, 16, true],
    [4, 17, false],
    [8, 256, true],
  ])("at bit depth %i takes %i entries: %s", (bitDepth, entries, accepted) => {
    const input = pngOf([
      ihdr(1, 1, { colourType: 3, bitDepth }),
      pngChunk("PLTE", new Uint8Array(entries * 3)),
      pngChunk("IDAT", deflateSync(Uint8Array.of(0, 0))),
      pngChunk("IEND"),
    ]);
    const result = checkLogo(input);
    if (accepted) expect(result.ok).toBe(true);
    else expect(result).toEqual({ ok: false, fault: { kind: "logo_malformed", at: "png_plte" } });
  });
});
