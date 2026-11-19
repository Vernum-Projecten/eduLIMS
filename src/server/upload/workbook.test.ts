// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  buildZip,
  type Cells,
  gen5Cells,
  type WorkbookOptions,
  workbookParts,
  type ZipPart,
} from "../../../tests/fixtures/gen5/xlsx-builder.ts";
import { readWorkbook, splitCellReference } from "./workbook.ts";
import { readZipDirectory } from "./zip.ts";

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";

function open(parts: readonly ZipPart[]) {
  const zip = readZipDirectory(buildZip(parts), { maxEntries: 50, maxUnpackedBytes: 1 << 23 });
  if (!zip.ok) throw new Error(JSON.stringify(zip.error));
  return readWorkbook(zip.value);
}

function openWith(options: WorkbookOptions, cells: Cells = gen5Cells()) {
  return open(workbookParts({ sheets: [cells], ...options }));
}

function errorOf(result: ReturnType<typeof open>) {
  if (result.ok) throw new Error("expected a refusal");
  return result.error;
}

const sheet = (body: string) =>
  `<worksheet xmlns="${MAIN}"><sheetData><row r="1">${body}</row></sheetData></worksheet>`;

function replaced(name: string, content: string) {
  return { replace: new Map([[name, content]]) };
}

describe("readWorkbook", () => {
  it("reads the cells of the one sheet", () => {
    const result = openWith({});
    expect(result.ok && result.sheet.cells.get("A2")).toEqual({
      kind: "text",
      text: "Software Version",
    });
    expect(result.ok && result.sheet.cells.get("B7")).toEqual({
      kind: "number",
      raw: "46346.000000000000",
    });
    expect(result.ok && result.sheet.date1904).toBe(false);
  });

  it("refuses a missing content types part", () => {
    expect(errorOf(openWith({ omit: ["[Content_Types].xml"] }))).toEqual({
      kind: "not_a_workbook",
      part: "[Content_Types].xml",
    });
  });

  it("refuses a part whose root is not the expected element", () => {
    expect(errorOf(openWith(replaced("_rels/.rels", `<Types xmlns="${PKG}"/>`)))).toEqual({
      kind: "not_a_workbook",
      part: "_rels/.rels",
    });
  });

  it("refuses a package without an office document relationship", () => {
    expect(errorOf(openWith(replaced("_rels/.rels", `<Relationships xmlns="${PKG}"/>`)))).toEqual({
      kind: "not_a_workbook",
      part: "_rels/.rels",
    });
  });

  it("refuses a relationship without a target", () => {
    const rels = `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument"/></Relationships>`;
    expect(errorOf(openWith(replaced("_rels/.rels", rels)))).toEqual({
      kind: "not_a_workbook",
      part: "_rels/.rels",
    });
  });

  it("refuses a target that climbs out of the package", () => {
    const rels = `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="../workbook.xml"/></Relationships>`;
    expect(errorOf(openWith(replaced("_rels/.rels", rels)))).toMatchObject({ part: "_rels/.rels" });
  });

  it("ignores an external relationship and reads an absolute target", () => {
    const rels = `<Relationships xmlns="${PKG}"><Relationship Id="rId2" Type="${REL}/hyperlink" Target="https://example.test/" TargetMode="External"/><Relationship Id="rId1" Type="${REL}/officeDocument" Target="/xl/./workbook.xml"/></Relationships>`;
    expect(openWith(replaced("_rels/.rels", rels)).ok).toBe(true);
  });

  it("refuses a workbook with no sheet", () => {
    expect(errorOf(open(workbookParts({ sheets: [] })))).toEqual({ kind: "sheet_count", count: 0 });
  });

  it("refuses a sheet relationship of another type", () => {
    const rels = `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/chartsheet" Target="worksheets/sheet1.xml"/></Relationships>`;
    expect(errorOf(openWith(replaced("xl/_rels/workbook.xml.rels", rels)))).toEqual({
      kind: "not_a_workbook",
      part: "xl/_rels/workbook.xml.rels",
    });
  });

  it("refuses two shared strings parts", () => {
    const rels = `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="s1" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="s2" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
    expect(errorOf(openWith(replaced("xl/_rels/workbook.xml.rels", rels)))).toMatchObject({
      part: "xl/_rels/workbook.xml.rels",
    });
  });

  it("reads a sheet without shared strings when it uses none", () => {
    const rels = `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
    const result = openWith({
      replace: new Map([
        ["xl/_rels/workbook.xml.rels", rels],
        ["xl/worksheets/sheet1.xml", sheet('<c r="A1"><v>1</v></c>')],
      ]),
    });
    expect(result.ok && result.sheet.cells.get("A1")).toEqual({ kind: "number", raw: "1" });
  });

  it("refuses a shared string index that does not exist", () => {
    const result = openWith(
      replaced("xl/worksheets/sheet1.xml", sheet('<c r="A1" t="s"><v>999</v></c>')),
    );
    expect(errorOf(result)).toEqual({ kind: "not_a_workbook", part: "xl/worksheets/sheet1.xml" });
  });

  it("refuses a cell without a reference", () => {
    const result = openWith(replaced("xl/worksheets/sheet1.xml", sheet("<c><v>1</v></c>")));
    expect(errorOf(result)).toMatchObject({ part: "xl/worksheets/sheet1.xml" });
  });

  it("refuses a cell given twice", () => {
    const body = '<c r="A1"><v>1</v></c><c r="A1"><v>2</v></c>';
    const result = openWith(replaced("xl/worksheets/sheet1.xml", sheet(body)));
    expect(errorOf(result)).toMatchObject({ part: "xl/worksheets/sheet1.xml" });
  });

  it("refuses a cell with two values", () => {
    const result = openWith(
      replaced("xl/worksheets/sheet1.xml", sheet('<c r="A1"><v>1</v><v>2</v></c>')),
    );
    expect(errorOf(result)).toMatchObject({ part: "xl/worksheets/sheet1.xml" });
  });

  it("refuses a sheet without its sheet data", () => {
    const result = openWith(replaced("xl/worksheets/sheet1.xml", `<worksheet xmlns="${MAIN}"/>`));
    expect(errorOf(result)).toMatchObject({ part: "xl/worksheets/sheet1.xml" });
  });

  it("reads a rich text string and a boolean as other", () => {
    const strings = `<sst xmlns="${MAIN}"><si><r><t>Ab</t></r><r><t>c</t></r><rPh><t>x</t></rPh></si></sst>`;
    const body =
      '<c r="A1" t="s"><v>0</v></c><c r="A2" t="b"><v>1</v></c><c r="A3" t="inlineStr"/>';
    const result = openWith({
      replace: new Map([
        ["xl/sharedStrings.xml", strings],
        ["xl/worksheets/sheet1.xml", sheet(body)],
      ]),
    });
    expect(result.ok && result.sheet.cells.get("A1")).toEqual({ kind: "text", text: "Abc" });
    expect(result.ok && result.sheet.cells.get("A2")).toEqual({ kind: "other" });
    expect(result.ok && result.sheet.cells.get("A3")).toEqual({ kind: "empty" });
  });

  it("refuses a part that is not UTF-8", () => {
    const parts = workbookParts({ sheets: [gen5Cells()] }).map((part) =>
      part.name === "xl/workbook.xml"
        ? { ...part, data: new Uint8Array([0xff, 0xfe, 0x3c]) }
        : part,
    );
    expect(errorOf(open(parts))).toEqual({
      kind: "archive_corrupt",
      reason: "text_encoding",
      part: "xl/workbook.xml",
    });
  });

  it("refuses malformed XML in a part, naming the part", () => {
    expect(errorOf(openWith(replaced("xl/workbook.xml", "<workbook>")))).toMatchObject({
      kind: "xml_malformed",
      part: "xl/workbook.xml",
    });
  });

  it("refuses a worksheet part with another content type", () => {
    const parts = workbookParts({ sheets: [gen5Cells()] }).map((part) =>
      part.name === "[Content_Types].xml" && typeof part.data === "string"
        ? { ...part, data: part.data.replace("worksheet+xml", "chartsheet+xml") }
        : part,
    );
    expect(errorOf(open(parts))).toEqual({
      kind: "not_a_workbook",
      part: "xl/worksheets/sheet1.xml",
    });
  });
});

describe("readWorkbook content types", () => {
  function withTypes(change: (types: string) => string) {
    return workbookParts({ sheets: [gen5Cells()] }).map((part) =>
      part.name === "[Content_Types].xml" && typeof part.data === "string"
        ? { ...part, data: change(part.data) }
        : part,
    );
  }

  it("falls back to the default type of the extension, which is no worksheet", () => {
    const parts = withTypes((types) =>
      types.replace(/<Override PartName="\/xl\/worksheets\/sheet1.xml"[^>]*\/>/, ""),
    );
    expect(errorOf(open(parts))).toEqual({
      kind: "not_a_workbook",
      part: "xl/worksheets/sheet1.xml",
    });
  });

  it("refuses a shared strings part with another content type", () => {
    const parts = withTypes((types) => types.replace("sharedStrings+xml", "styles+xml"));
    expect(errorOf(open(parts))).toEqual({ kind: "not_a_workbook", part: "xl/sharedStrings.xml" });
  });

  it("refuses a sheet whose relationship id has no bound prefix", () => {
    const workbook = `<workbook xmlns="${MAIN}"><sheets><sheet name="S" sheetId="1" id="rId1"/></sheets></workbook>`;
    expect(errorOf(openWith(replaced("xl/workbook.xml", workbook)))).toEqual({
      kind: "not_a_workbook",
      part: "xl/_rels/workbook.xml.rels",
    });
  });
});

describe("readWorkbook namespaces (N2)", () => {
  it("does not read a relationship in a foreign namespace", () => {
    const rels = `<Relationships xmlns="${PKG}"><x:Relationship xmlns:x="urn:x" Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    expect(errorOf(openWith(replaced("_rels/.rels", rels)))).toEqual({
      kind: "not_a_workbook",
      part: "_rels/.rels",
    });
  });

  it("does not read a content type override in a foreign namespace", () => {
    const parts = workbookParts({ sheets: [gen5Cells()] }).map((part) =>
      part.name === "[Content_Types].xml" && typeof part.data === "string"
        ? {
            ...part,
            data: part.data.replace(
              '<Override PartName="/xl/workbook.xml"',
              '<x:Override xmlns:x="urn:x" PartName="/xl/workbook.xml"',
            ),
          }
        : part,
    );
    expect(errorOf(open(parts))).toEqual({ kind: "not_a_workbook", part: "xl/workbook.xml" });
  });

  it("refuses a relationships part whose root is in another namespace", () => {
    const rels = `<Relationships xmlns="urn:x"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    expect(errorOf(openWith(replaced("_rels/.rels", rels)))).toEqual({
      kind: "not_a_workbook",
      part: "_rels/.rels",
    });
  });
});

describe("splitCellReference", () => {
  it.each([
    ["A1", { column: 1, row: 1 }],
    ["O32", { column: 15, row: 32 }],
    ["AA10", { column: 27, row: 10 }],
  ])("splits %s", (ref, expected) => {
    expect(splitCellReference(ref)).toEqual(expected);
  });

  it.each(["a1", "A0", "1A", "A", "ABCD1"])("refuses %s", (ref) => {
    expect(splitCellReference(ref)).toBeUndefined();
  });
});
