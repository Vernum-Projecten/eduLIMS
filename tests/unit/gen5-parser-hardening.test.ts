// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The findings of the security review of #297 through a full upload: the XML and per-part caps
// (ASVS 5.0 V5.2.1, V15.2.2), bounded error text (V16.5.1), header text and raw characters
// (V2.2.1), numbers that would be rounded or underflow, and elements in a foreign namespace.
import { describe, expect, it } from "vitest";
import { type Gen5ParseResult, parseGen5Export } from "../../src/server/upload/gen5.ts";
import {
  MAX_ERROR_TEXT,
  MAX_PART_BYTES,
  MAX_XML_ATTRIBUTES,
  MAX_XML_DEPTH,
  MAX_XML_ELEMENTS,
  MAX_XML_NAMESPACES,
} from "../../src/server/upload/limits.ts";
import {
  buildGen5Workbook,
  buildZip,
  type Cells,
  gen5Cells,
  workbookParts,
  type ZipPart,
} from "../fixtures/gen5/xlsx-builder.ts";

const SHEET = "xl/worksheets/sheet1.xml";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function parse(bytes: Uint8Array): Gen5ParseResult {
  return parseGen5Export({ fileName: "plate.xlsx", bytes });
}

function errorsOf(result: Gen5ParseResult) {
  if (result.ok) throw new Error("expected the file to be refused");
  return result.errors;
}

/** A good workbook whose sheet XML is changed by `change`. */
function withSheet(change: (xml: string) => string | Uint8Array): Uint8Array {
  const parts: ZipPart[] = workbookParts({ sheets: [gen5Cells()] }).map((part) =>
    part.name === SHEET && typeof part.data === "string"
      ? { ...part, data: change(part.data) }
      : part,
  );
  return buildZip(parts);
}

function beforeSheetData(insert: string): Uint8Array {
  return withSheet((xml) => xml.replace("<sheetData>", `${insert}<sheetData>`));
}

function parseCells(change: (cells: Cells) => void): Gen5ParseResult {
  const cells = gen5Cells();
  change(cells);
  return parse(buildGen5Workbook(cells));
}

const char = (code: number) => String.fromCodePoint(code);
const BIDI_OVERRIDE = char(0x202e);
/** DEL is an XML Char, so it reaches the header check; a C0 control stops at the XML reader. */
const DELETE = char(0x7f);

describe("the XML caps through an upload (B1)", () => {
  const goodSheet = workbookParts({ sheets: [gen5Cells()] }).find((part) => part.name === SHEET);
  const sheetText = typeof goodSheet?.data === "string" ? goodSheet.data : "";
  const elementsInSheet = (sheetText.match(/<[A-Za-z]/g) ?? []).length;

  it("refuses two million empty elements in a small upload at the part cap, before inflating", () => {
    const bytes = beforeSheetData("<x/>".repeat(2_000_000));
    expect(bytes.length).toBeLessThan(64 * 1024);
    expect(errorsOf(parse(bytes))).toEqual([
      { kind: "part_too_large", part: SHEET, size: expect.any(Number), limit: MAX_PART_BYTES },
    ]);
  });

  it("refuses a flood of elements that fits under the part cap at the element cap", () => {
    const bytes = beforeSheetData("<x/>".repeat(250_000));
    expect(errorsOf(parse(bytes))).toEqual([
      { kind: "xml_too_large", part: SHEET, cap: "elements" },
    ]);
  });

  it("reads a sheet of exactly the element cap and refuses one element more", () => {
    const room = MAX_XML_ELEMENTS - elementsInSheet;
    expect(parse(beforeSheetData("<x/>".repeat(room))).ok).toBe(true);
    expect(errorsOf(parse(beforeSheetData("<x/>".repeat(room + 1))))).toEqual([
      { kind: "xml_too_large", part: SHEET, cap: "elements" },
    ]);
  });

  it("reads nesting of exactly the depth cap and refuses one level deeper", () => {
    const nest = (levels: number) => `${"<x>".repeat(levels)}${"</x>".repeat(levels)}`;
    expect(parse(beforeSheetData(nest(MAX_XML_DEPTH - 1))).ok).toBe(true);
    expect(errorsOf(parse(beforeSheetData(nest(MAX_XML_DEPTH))))).toEqual([
      { kind: "xml_too_large", part: SHEET, cap: "depth" },
    ]);
  });

  it("reads exactly the attribute cap on one element and refuses one more", () => {
    const element = (count: number) =>
      `<x ${Array.from({ length: count }, (_, index) => `a${index}=""`).join(" ")}/>`;
    expect(parse(beforeSheetData(element(MAX_XML_ATTRIBUTES))).ok).toBe(true);
    expect(errorsOf(parse(beforeSheetData(element(MAX_XML_ATTRIBUTES + 1))))).toEqual([
      { kind: "xml_too_large", part: SHEET, cap: "attributes" },
    ]);
  });

  it("reads a sheet of exactly the part cap and refuses one byte more, before inflating", () => {
    const padded = (size: number) =>
      withSheet((xml) =>
        xml.replace("</worksheet>", `${" ".repeat(size - xml.length)}</worksheet>`),
      );
    expect(parse(padded(MAX_PART_BYTES)).ok).toBe(true);
    expect(errorsOf(parse(padded(MAX_PART_BYTES + 1)))).toEqual([
      { kind: "part_too_large", part: SHEET, size: MAX_PART_BYTES + 1, limit: MAX_PART_BYTES },
    ]);
  });
});

describe("error text is bounded (S1, ASVS 5.0 V16.5.1)", () => {
  function withRootTarget(target: string): Uint8Array {
    const rels = `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${OFFICE}/officeDocument" Target="${target}"/></Relationships>`;
    return buildGen5Workbook(gen5Cells(), { replace: new Map([["_rels/.rels", rels]]) });
  }

  it("cuts a long relationship target to 128 characters in the error", () => {
    const [error] = errorsOf(parse(withRootTarget("x".repeat(100_000))));
    expect(error).toEqual({ kind: "not_a_workbook", part: "x".repeat(MAX_ERROR_TEXT) });
  });

  it("refuses a four-million-character target at the part cap, naming only the fixed part", () => {
    expect(errorsOf(parse(withRootTarget("x".repeat(4_000_000))))).toEqual([
      {
        kind: "part_too_large",
        part: "_rels/.rels",
        size: expect.any(Number),
        limit: MAX_PART_BYTES,
      },
    ]);
  });

  it("names no entry when an arbitrary entry is refused", () => {
    const bytes = buildZip([{ name: "n".repeat(65_000), data: "<a/>", method: 12 }]);
    expect(errorsOf(parse(bytes))).toEqual([
      { kind: "archive_unsupported", reason: "compression_method" },
    ]);
  });
});

describe("header text (S2, ASVS 5.0 V2.2.1)", () => {
  type TextField = "softwareVersion" | "readerType" | "readerSerialNumber";
  const cases: readonly (readonly [TextField, string, string, string, string])[] = [
    ["softwareVersion", "B2", "3.11", "1".repeat(32), "1".repeat(33)],
    ["readerType", "B9", "Epoch 2", "E".repeat(64), "E".repeat(65)],
    ["readerSerialNumber", "B10", "EX01", "A1".repeat(16), `${"A1".repeat(16)}Z`],
  ];

  for (const [field, cell, valid, atLimit, overLimit] of cases) {
    it(`reads ${field} at its longest`, () => {
      const result = parseCells((cells) => cells.set(cell, atLimit));
      expect(result.ok && result.plate.header[field]).toBe(atLimit);
    });

    it(`refuses ${field} one character too long`, () => {
      expect(errorsOf(parseCells((cells) => cells.set(cell, overLimit)))).toEqual([
        { kind: "header_invalid", field, cell },
      ]);
    });

    it.each([
      ["a control character", DELETE],
      ["a bidi override", BIDI_OVERRIDE],
    ])(`refuses ${field} with %s`, (_, bad) => {
      expect(errorsOf(parseCells((cells) => cells.set(cell, `${valid}${bad}`)))).toEqual([
        { kind: "header_invalid", field, cell },
      ]);
    });
  }

  it("refuses a software version with a letter", () => {
    expect(errorsOf(parseCells((cells) => cells.set("B2", "3.11b")))).toEqual([
      { kind: "header_invalid", field: "softwareVersion", cell: "B2" },
    ]);
  });

  it("refuses a serial number with a dash", () => {
    expect(errorsOf(parseCells((cells) => cells.set("B10", "EX-01")))).toEqual([
      { kind: "header_invalid", field: "readerSerialNumber", cell: "B10" },
    ]);
  });
});

describe("raw characters and encodings (S2)", () => {
  it("refuses a raw NUL in a shared string", () => {
    const bytes = buildGen5Workbook(gen5Cells(), {
      replace: new Map([
        [
          "xl/sharedStrings.xml",
          `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>a${char(0)}</t></si></sst>`,
        ],
      ]),
    });
    expect(errorsOf(parse(bytes))[0]).toMatchObject({
      kind: "xml_malformed",
      part: "xl/sharedStrings.xml",
    });
  });

  it("reads a sheet that starts with a UTF-8 byte order mark before its XML declaration", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const bytes = withSheet((xml) => new Uint8Array([...bom, ...new TextEncoder().encode(xml)]));
    expect(parse(bytes).ok).toBe(true);
  });

  it("refuses a sheet in UTF-16LE without a byte order mark", () => {
    const bytes = withSheet((xml) => new Uint8Array(Buffer.from(xml, "utf16le")));
    expect(errorsOf(parse(bytes))).toEqual([{ kind: "xml_malformed", part: SHEET, offset: 1 }]);
  });
});

describe("numbers that would be rounded or underflow (N1)", () => {
  it.each([
    ["1e-400", "underflows to zero"],
    ["-1e-400", "underflows to negative zero"],
    ["0.123456789012345678", "has 18 significant digits"],
  ])("refuses a well of %s, which %s", (raw) => {
    expect(errorsOf(parseCells((cells) => cells.set("C25", { raw })))).toEqual([
      { kind: "well_not_a_number", well: "A1", cell: "C25" },
    ]);
  });
});

describe("elements in a foreign namespace are not read (N2)", () => {
  it("does not read a value in a foreign namespace", () => {
    const bytes = withSheet((xml) =>
      xml.replace(
        /<c r="C25"><v>[^<]*<\/v><\/c>/,
        '<c r="C25"><evil:v xmlns:evil="urn:x">9.99</evil:v></c>',
      ),
    );
    expect(errorsOf(parse(bytes))).toEqual([{ kind: "well_empty", well: "A1", cell: "C25" }]);
  });

  it("does not read a cell in a foreign namespace", () => {
    const bytes = withSheet((xml) =>
      xml.replace(
        /<c r="C25"><v>([^<]*)<\/v><\/c>/,
        '<evil:c xmlns:evil="urn:x" r="C25"><v>$1</v></evil:c>',
      ),
    );
    expect(errorsOf(parse(bytes))).toEqual([{ kind: "well_empty", well: "A1", cell: "C25" }]);
  });

  it("does not read a row in a foreign namespace", () => {
    const bytes = withSheet((xml) =>
      xml.replace(/<row r="25">(.*?)<\/row>/, '<evil:row xmlns:evil="urn:x" r="25">$1</evil:row>'),
    );
    expect(errorsOf(parse(bytes))).toEqual([{ kind: "grid_shape", cell: "B25" }]);
  });
});

/** The root start tag of each of the six parts the reader opens. */
const ROOT_START = /<(Types|Relationships|workbook|worksheet|sst)\b[^>]*>/;

/** A good workbook with `insert(partText)` placed right after the root start tag of each part. */
function floodEveryPart(insert: (partText: string) => string): Uint8Array {
  const parts = workbookParts({ sheets: [gen5Cells()] }).map((part) => {
    if (typeof part.data !== "string") return part;
    const match = ROOT_START.exec(part.data);
    if (match === null) throw new Error(`no root start tag in ${part.name}`);
    const at = match.index + match[0].length;
    return { ...part, data: `${part.data.slice(0, at)}${insert(part.data)}${part.data.slice(at)}` };
  });
  expect(parts.filter((part) => typeof part.data === "string")).toHaveLength(6);
  return buildZip(parts);
}

const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

describe("namespace declarations through an upload (the second review of #297)", () => {
  it("refuses the six-part chain of 31 prefixes a level at the namespace cap", () => {
    let open = "";
    let close = "";
    for (let depth = 2; depth <= 31; depth += 1) {
      const declarations = Array.from(
        { length: 31 },
        (_, index) => ` xmlns:p${depth}_${index}="u"`,
      ).join("");
      open += `<e${declarations}>`;
      close = `</e>${close}`;
    }
    const bytes = floodEveryPart(() => `${open}${'<l xmlns:q="u"/>'.repeat(4_000)}${close}`);
    expect(bytes.length).toBeLessThan(64 * 1024);
    expect(errorsOf(parse(bytes))).toEqual([
      { kind: "xml_too_large", part: "[Content_Types].xml", cap: "namespaces" },
    ]);
  });

  it("reads every opened part flooded up to each XML cap at once, within the budget", () => {
    const attributes = (total: number) =>
      Array.from({ length: total }, (_, index) => ` a${index}=""`).join("");
    const bytes = floodEveryPart((partText) => {
      const chainLength = MAX_XML_DEPTH - 2;
      let namespaceRoom = MAX_XML_NAMESPACES - count(partText, /xmlns(:[A-Za-z0-9_]+)?=/g);
      let open = "";
      let close = "";
      for (let level = 0; level < chainLength; level += 1) {
        const here = Math.min(namespaceRoom, MAX_XML_ATTRIBUTES);
        namespaceRoom -= here;
        const declarations = Array.from(
          { length: here },
          (_, index) => ` xmlns:n${level}_${index}="urn:n"`,
        ).join("");
        open += `<e${declarations}>`;
        close = `</e>${close}`;
      }
      const leaves = MAX_XML_ELEMENTS - count(partText, /<[A-Za-z]/g) - chainLength;
      const widest = `<x${attributes(MAX_XML_ATTRIBUTES)}/>`;
      return `${open}${widest}${`<x${attributes(16)}/>`.repeat(leaves - 1)}${close}`;
    });
    const started = performance.now();
    const result = parse(bytes);
    const elapsed = performance.now() - started;
    expect(result.ok).toBe(true);
    expect(elapsed).toBeLessThan(10_000);
  });
});
