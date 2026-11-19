// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Builds Gen5-style workbooks from invented values for the parser tests (S4, Q-PRIV-4): a
// deterministic zip writer (PKWARE APPNOTE.TXT §4.3) and the cells of the export layout of
// docs/gen5-export.md. Every option exists to make one bad file; the defaults make a good one.
import { crc32, deflateRawSync } from "node:zlib";

/** One entry to write, with optional lies in its headers for the archive tests. */
export interface ZipPart {
  readonly name: string;
  readonly data: Uint8Array | string;
  /** 0 stores the entry, 8 deflates it (the default). */
  readonly method?: 0 | 8 | 12;
  /** Overrides the unpacked size written in both headers. */
  readonly declaredSize?: number;
  /** Overrides the CRC-32 written in both headers. */
  readonly declaredCrc?: number;
  /** General purpose flags (APPNOTE §4.4.4). */
  readonly flags?: number;
}

/** A DOS date of 1 January 1980, so the same parts always give the same bytes. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/** Writes `parts` as a zip archive. */
export function buildZip(parts: readonly ZipPart[]): Uint8Array {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const part of parts) {
    const content = typeof part.data === "string" ? Buffer.from(part.data, "utf8") : part.data;
    const method = part.method ?? 8;
    const packed = method === 8 ? deflateRawSync(content) : Buffer.from(content);
    const name = Buffer.from(part.name, "utf8");
    const size = part.declaredSize ?? content.length;
    const crc = part.declaredCrc ?? crc32(content);
    const flags = part.flags ?? 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(flags, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(packed.length, 20);
    header.writeUInt32LE(size, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);

    chunks.push(local, name, packed);
    central.push(header, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, directory, end]));
}

/** A cell value: a shared string, a number, the exact text of a numeric `v`, or another form. */
export type CellSpec =
  | string
  | number
  | { readonly raw: string }
  | { readonly inline: string }
  | { readonly formula: string; readonly value: number }
  | { readonly error: string };

/** The cells of one sheet by reference (`B7`); a reference mapped to `null` is left out. */
export type Cells = Map<string, CellSpec | null>;

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const OFFICE_RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_RELS = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function cellOrder(ref: string): [number, number] {
  const match = /^([A-Z]+)([0-9]+)$/.exec(ref);
  const letters = match?.[1] ?? "";
  let column = 0;
  for (const letter of letters) column = column * 26 + (letter.charCodeAt(0) - 64);
  return [Number(match?.[2] ?? 0), column];
}

/** Writes the worksheet and shared strings XML for `cells`. */
export function sheetXml(cells: Cells): { sheet: string; strings: string } {
  const strings: string[] = [];
  const rows = new Map<number, string[]>();
  const refs = [...cells.keys()].sort((a, b) => {
    const [rowA, colA] = cellOrder(a);
    const [rowB, colB] = cellOrder(b);
    return rowA - rowB || colA - colB;
  });
  for (const ref of refs) {
    const spec = cells.get(ref);
    if (spec === undefined || spec === null) continue;
    let xml: string;
    if (typeof spec === "string") {
      strings.push(spec);
      xml = `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
    } else if (typeof spec === "number") {
      xml = `<c r="${ref}"><v>${spec.toPrecision(17)}</v></c>`;
    } else if ("raw" in spec) {
      xml = `<c r="${ref}"><v>${escapeXml(spec.raw)}</v></c>`;
    } else if ("inline" in spec) {
      xml = `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(spec.inline)}</t></is></c>`;
    } else if ("formula" in spec) {
      xml = `<c r="${ref}"><f>${escapeXml(spec.formula)}</f><v>${spec.value}</v></c>`;
    } else {
      xml = `<c r="${ref}" t="e"><v>${escapeXml(spec.error)}</v></c>`;
    }
    const [row] = cellOrder(ref);
    rows.set(row, [...(rows.get(row) ?? []), xml]);
  }
  const rowXml = [...rows].map(([row, xml]) => `<row r="${row}">${xml.join("")}</row>`).join("");
  return {
    sheet: `${XML_DECLARATION}<worksheet xmlns="${MAIN}" xmlns:r="${OFFICE_RELS}"><sheetData>${rowXml}</sheetData></worksheet>`,
    strings: `${XML_DECLARATION}<sst xmlns="${MAIN}" count="${strings.length}" uniqueCount="${strings.length}">${strings
      .map((text) => `<si><t>${escapeXml(text)}</t></si>`)
      .join("")}</sst>`,
  };
}

/** Options for {@link workbookParts}; each changes one thing a bad file needs. */
export interface WorkbookOptions {
  /** The sheets of the workbook; the default is one sheet. */
  readonly sheets?: readonly Cells[];
  /** The content type of the workbook part. */
  readonly workbookContentType?: string;
  /** Parts to add after the workbook parts. */
  readonly extraParts?: readonly ZipPart[];
  /** Parts of the workbook to leave out, by name. */
  readonly omit?: readonly string[];
  /** Replaces a part's content by name. */
  readonly replace?: ReadonlyMap<string, string>;
  /** The compression of every part. */
  readonly method?: 0 | 8;
}

/** The content type of a SpreadsheetML workbook. */
export const WORKBOOK_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";

/** Returns the zip parts of a workbook with the given sheets. */
export function workbookParts(options: WorkbookOptions = {}): ZipPart[] {
  const sheets = options.sheets ?? [];
  const sheetFiles = sheets.map((cells) => sheetXml(cells));
  const overrides = [
    `<Override PartName="/xl/workbook.xml" ContentType="${options.workbookContentType ?? WORKBOOK_TYPE}"/>`,
    ...sheets.map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    ),
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`,
  ].join("");
  const contentTypes = `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`;
  const rootRels = `${XML_DECLARATION}<Relationships xmlns="${PACKAGE_RELS}"><Relationship Id="rId1" Type="${OFFICE_RELS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `${XML_DECLARATION}<workbook xmlns="${MAIN}" xmlns:r="${OFFICE_RELS}"><sheets>${sheets
    .map(
      (_, index) =>
        `<sheet name="Plate ${index + 1} - Sheet1" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("")}</sheets></workbook>`;
  const workbookRels = `${XML_DECLARATION}<Relationships xmlns="${PACKAGE_RELS}">${sheets
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="${OFFICE_RELS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join(
      "",
    )}<Relationship Id="rIdStrings" Type="${OFFICE_RELS}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
  // NOTE: one shared strings part serves every sheet in Excel; the first sheet's strings suffice here.
  const strings = sheetFiles[0]?.strings ?? sheetXml(new Map()).strings;
  const parts: ZipPart[] = [
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRels },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRels },
    ...sheetFiles.map((file, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: file.sheet,
    })),
    { name: "xl/sharedStrings.xml", data: strings },
  ];
  const method = options.method ?? 8;
  return [
    ...parts
      .filter((part) => !(options.omit ?? []).includes(part.name))
      .map((part) => ({ ...part, data: options.replace?.get(part.name) ?? part.data, method })),
    ...(options.extraParts ?? []),
  ];
}

/** The invented header and plate of a Gen5 export, in the units the export writes. */
export interface Gen5Spec {
  readonly softwareVersion: string;
  readonly experimentFilePath: string;
  readonly protocolFilePath: string;
  readonly plateNumber: string;
  /** The date as a serial day number of the 1900 date system. */
  readonly dateSerial: number;
  /** The time as a fraction of a day. */
  readonly timeFraction: number;
  readonly readerType: string;
  readonly readerSerialNumber: string;
  readonly plateType: string;
  readonly readType: string;
  readonly wavelengthNm: number;
  readonly temperatureCelsius: number;
  /** Eight rows of twelve absorbances; a `CellSpec` or `null` replaces one well. */
  readonly wells: readonly (readonly (CellSpec | null)[])[];
}

const ROWS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
const WELL_COLUMNS = ["C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"] as const;

/** An invented plate of a 450 nm read whose absorbance rises across and down the plate. */
export function gradientWells(): number[][] {
  return ROWS.map((_, row) =>
    WELL_COLUMNS.map((_, column) => Math.round((0.05 + 0.03 * row + 0.17 * column) * 1000) / 1000),
  );
}

/** The invented spec of a good export; every value is made up (Q-PRIV-4). */
export function defaultSpec(): Gen5Spec {
  return {
    softwareVersion: "3.11.19",
    experimentFilePath: "C:\\Users\\Public\\Documents\\Experiments\\Example.xpt",
    protocolFilePath: "C:\\Users\\Public\\Documents\\Protocols\\Example.prt",
    plateNumber: "Plate 1",
    dateSerial: 46346,
    timeFraction: 0.4375,
    readerType: "Epoch 2",
    readerSerialNumber: "EX000001",
    plateType: "96 WELL PLATE",
    readType: "Absorbance Endpoint",
    wavelengthNm: 450,
    temperatureCelsius: 21.3,
    wells: gradientWells(),
  };
}

/** Returns the cells of the Gen5 export layout for `spec`. */
export function gen5Cells(spec: Gen5Spec = defaultSpec()): Cells {
  const cells: Cells = new Map<string, CellSpec | null>([
    ["A2", "Software Version"],
    ["B2", spec.softwareVersion],
    ["A4", "Experiment File Path:"],
    ["B4", spec.experimentFilePath],
    ["A5", "Protocol File Path:"],
    ["B5", spec.protocolFilePath],
    ["A6", "Plate Number"],
    ["B6", spec.plateNumber],
    ["A7", "Date"],
    ["B7", spec.dateSerial],
    ["A8", "Time"],
    ["B8", spec.timeFraction],
    ["A9", "Reader Type:"],
    ["B9", spec.readerType],
    ["A10", "Reader Serial Number:"],
    ["B10", spec.readerSerialNumber],
    ["A11", "Reading Type"],
    ["B11", "Reader"],
    ["A13", "Procedure Details"],
    ["A14", "Plate Type"],
    ["B14", spec.plateType],
    ["A15", "Eject plate on completion"],
    ["A16", "Read"],
    ["B16", spec.readType],
    ["B17", "Full Plate"],
    ["B18", `Wavelengths:  ${spec.wavelengthNm}`],
    ["B19", "Read Speed: Normal,  Delay: 100 msec,  Measurements/Data Point: 8"],
    ["A21", "Results"],
    ["A22", "Actual Temperature:"],
    ["B22", spec.temperatureCelsius],
  ]);
  WELL_COLUMNS.forEach((column, index) => {
    cells.set(`${column}24`, index + 1);
  });
  ROWS.forEach((row, rowIndex) => {
    const sheetRow = 25 + rowIndex;
    cells.set(`B${sheetRow}`, row);
    WELL_COLUMNS.forEach((column, columnIndex) => {
      cells.set(`${column}${sheetRow}`, spec.wells[rowIndex]?.[columnIndex] ?? null);
    });
    cells.set(`O${sheetRow}`, spec.wavelengthNm);
  });
  return cells;
}

/** Builds a Gen5 workbook from `cells` (the good layout by default). */
export function buildGen5Workbook(
  cells: Cells = gen5Cells(),
  options: Omit<WorkbookOptions, "sheets"> = {},
): Uint8Array {
  return buildZip(workbookParts({ ...options, sheets: [cells] }));
}

/** The invented gradient plate committed as `epoch2-endpoint-450nm-gradient.xlsx`. */
export function gradientFixture(): Uint8Array {
  // NOTE: stored, not deflated, so the bytes do not depend on the zlib build of the Node runtime.
  return buildGen5Workbook(gen5Cells(), { method: 0 });
}
