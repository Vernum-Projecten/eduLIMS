// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Opens an Office Open XML workbook (ECMA-376 Part 1 SpreadsheetML, Part 2 Open Packaging
// Conventions) far enough to return the cells of its one sheet. Only six parts are unpacked: the
// content types, the package and workbook relationships, the workbook, the shared strings and the
// sheet; every other entry (styles, theme, printer settings, properties) is never inflated.
import {
  type ArchiveError,
  boundText,
  type LayoutError,
  type Step,
  stepFail,
  stepOk,
} from "./errors.ts";
import {
  MAX_PART_BYTES,
  MAX_XML_ATTRIBUTES,
  MAX_XML_DEPTH,
  MAX_XML_ELEMENTS,
  MAX_XML_NAMESPACES,
} from "./limits.ts";
import { attributeIn, childElements, directText, parseXml, type XmlElement } from "./xml.ts";
import { readZipEntry, type ZipDirectory } from "./zip.ts";

const NS_CONTENT_TYPES = "http://schemas.openxmlformats.org/package/2006/content-types";
const NS_PACKAGE_RELATIONSHIPS = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_OFFICE_RELATIONSHIPS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_OFFICE_DOCUMENT = `${NS_OFFICE_RELATIONSHIPS}/officeDocument`;
const REL_WORKSHEET = `${NS_OFFICE_RELATIONSHIPS}/worksheet`;
const REL_SHARED_STRINGS = `${NS_OFFICE_RELATIONSHIPS}/sharedStrings`;
const TYPE_WORKBOOK = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const TYPE_WORKSHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const TYPE_SHARED_STRINGS =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml";
const CONTENT_TYPES_PART = "[Content_Types].xml";
const ROOT_RELATIONSHIPS_PART = "_rels/.rels";
const CELL_REFERENCE = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/;

/** The content of one cell as the layout check needs it. */
export type Cell =
  | { readonly kind: "empty" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "number"; readonly raw: string }
  | { readonly kind: "other" };

/** The cells of the one sheet, keyed by reference (`B7`), and the workbook's date system. */
export interface SheetCells {
  readonly cells: ReadonlyMap<string, Cell>;
  readonly date1904: boolean;
}

/** The result of {@link readWorkbook}: the sheet, or the first archive or sheet-count error. */
export type WorkbookResult =
  | { readonly ok: true; readonly sheet: SheetCells }
  | { readonly ok: false; readonly error: ArchiveError | LayoutError };

/** Splits a cell reference into its column number (A = 1) and row number. */
export function splitCellReference(ref: string): { column: number; row: number } | undefined {
  const match = CELL_REFERENCE.exec(ref);
  if (match === null) return undefined;
  const [, letters = "", digits = ""] = match;
  let column = 0;
  for (const letter of letters) column = column * 26 + (letter.charCodeAt(0) - 64);
  return { column, row: Number(digits) };
}

function notWorkbook<T>(part: string): Step<T> {
  return stepFail({ kind: "not_a_workbook", part: boundText(part) });
}

const XML_LIMITS = {
  maxElements: MAX_XML_ELEMENTS,
  maxDepth: MAX_XML_DEPTH,
  maxAttributes: MAX_XML_ATTRIBUTES,
  maxNamespaces: MAX_XML_NAMESPACES,
};

const textDecoder = new TextDecoder("utf-8", { fatal: true });

function xmlFailure(error: ParsedFailure, part: string): ArchiveError {
  switch (error.kind) {
    case "xml_dtd_refused":
      return { kind: "xml_dtd_refused", part };
    case "xml_too_large":
      return { kind: "xml_too_large", part, cap: error.cap };
    case "xml_malformed":
      return { kind: "xml_malformed", part, offset: error.offset };
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}

type ParsedFailure = Extract<ReturnType<typeof parseXml>, { ok: false }>["error"];

function readPart(zip: ZipDirectory, part: string, rootName: string, ns: string): Step<XmlElement> {
  const entry = zip.entries.get(part);
  if (entry === undefined) return notWorkbook(part);
  const bytes = readZipEntry(zip, entry, MAX_PART_BYTES);
  if (!bytes.ok) return bytes;
  let text: string;
  try {
    // NOTE: a UTF-8 byte order mark is dropped here; the XML reader never sees it.
    text = textDecoder.decode(bytes.value);
  } catch {
    // NOTE: ECMA-376 Part 2 allows UTF-16 parts too; Excel and Gen5 write UTF-8, so only it is read.
    return stepFail({ kind: "archive_corrupt", reason: "text_encoding", part: boundText(part) });
  }
  const parsed = parseXml(text, XML_LIMITS);
  if (!parsed.ok) return stepFail(xmlFailure(parsed.error, boundText(part)));
  if (parsed.root.localName !== rootName || parsed.root.namespace !== ns) {
    return notWorkbook(part);
  }
  return stepOk(parsed.root);
}

/** Resolves a relationship target against the folder of its source part, inside the package. */
function resolveTarget(sourcePart: string, target: string): string | undefined {
  const segments = target.startsWith("/") ? [] : sourcePart.split("/").slice(0, -1);
  for (const segment of target.replace(/^\//, "").split("/")) {
    if (segment === "..") {
      if (segments.pop() === undefined) return undefined;
    } else if (segment !== "." && segment !== "") {
      segments.push(segment);
    }
  }
  return segments.length > 0 ? segments.join("/") : undefined;
}

function relationshipsPartOf(part: string): string {
  const slash = part.lastIndexOf("/");
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

interface Relationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
}

function readRelationships(zip: ZipDirectory, part: string, source: string): Step<Relationship[]> {
  const root = readPart(zip, part, "Relationships", NS_PACKAGE_RELATIONSHIPS);
  if (!root.ok) return root;
  const relationships: Relationship[] = [];
  for (const element of childElements(root.value, NS_PACKAGE_RELATIONSHIPS, "Relationship")) {
    const id = element.attributes.get("Id");
    const type = element.attributes.get("Type");
    const targetAttribute = element.attributes.get("Target");
    if (element.attributes.get("TargetMode") === "External") continue;
    const target =
      targetAttribute === undefined ? undefined : resolveTarget(source, targetAttribute);
    if (id === undefined || type === undefined || target === undefined) return notWorkbook(part);
    relationships.push({ id, type, target });
  }
  return stepOk(relationships);
}

function contentTypeOf(types: XmlElement, part: string): string | undefined {
  for (const override of childElements(types, NS_CONTENT_TYPES, "Override")) {
    if (override.attributes.get("PartName") === `/${part}`) {
      return override.attributes.get("ContentType");
    }
  }
  const extension = part.slice(part.lastIndexOf(".") + 1).toLowerCase();
  for (const fallback of childElements(types, NS_CONTENT_TYPES, "Default")) {
    if (fallback.attributes.get("Extension")?.toLowerCase() === extension) {
      return fallback.attributes.get("ContentType");
    }
  }
  return undefined;
}

/** The text of a string item (`si`) or an inline string (`is`): its `t`, or its runs' `t`s. */
function richText(item: XmlElement): string {
  const plain = childElements(item, NS_MAIN, "t");
  const runs = childElements(item, NS_MAIN, "r").flatMap((run) => childElements(run, NS_MAIN, "t"));
  return [...plain, ...runs].map(directText).join("");
}

function sharedStrings(root: XmlElement): string[] {
  return childElements(root, NS_MAIN, "si").map(richText);
}

function readCell(element: XmlElement, strings: readonly string[] | undefined): Cell | undefined {
  if (childElements(element, NS_MAIN, "f").length > 0) return { kind: "other" };
  const type = element.attributes.get("t") ?? "n";
  const values = childElements(element, NS_MAIN, "v");
  const value = values[0];
  if (values.length > 1) return undefined;
  if (type === "inlineStr") {
    const inline = childElements(element, NS_MAIN, "is")[0];
    return inline === undefined ? { kind: "empty" } : { kind: "text", text: richText(inline) };
  }
  if (value === undefined) return { kind: "empty" };
  const raw = directText(value);
  if (type === "n") return { kind: "number", raw };
  if (type === "s") {
    const index = /^[0-9]+$/.test(raw) ? Number(raw) : Number.NaN;
    const text = strings?.[index];
    return text === undefined ? undefined : { kind: "text", text };
  }
  return { kind: "other" };
}

function readCells(
  sheet: XmlElement,
  strings: readonly string[] | undefined,
  part: string,
): Step<Map<string, Cell>> {
  const data = childElements(sheet, NS_MAIN, "sheetData");
  const sheetData = data[0];
  if (sheetData === undefined || data.length > 1) return notWorkbook(part);
  const cells = new Map<string, Cell>();
  for (const row of childElements(sheetData, NS_MAIN, "row")) {
    for (const element of childElements(row, NS_MAIN, "c")) {
      const ref = element.attributes.get("r");
      if (ref === undefined || splitCellReference(ref) === undefined || cells.has(ref)) {
        return notWorkbook(part);
      }
      const cell = readCell(element, strings);
      if (cell === undefined) return notWorkbook(part);
      cells.set(ref, cell);
    }
  }
  return stepOk(cells);
}

/**
 * Reads the cells of the workbook's one sheet from a checked zip directory.
 *
 * The workbook part must have the SpreadsheetML workbook content type (so a macro-enabled
 * workbook or a template is refused, ASVS 5.0 V5.2.2), and the workbook must hold exactly one
 * sheet (`sheet_count`).
 */
export function readWorkbook(zip: ZipDirectory): WorkbookResult {
  const result = openWorkbook(zip);
  return result.ok ? { ok: true, sheet: result.value } : { ok: false, error: result.error };
}

function openWorkbook(zip: ZipDirectory): Step<SheetCells> | { ok: false; error: LayoutError } {
  const types = readPart(zip, CONTENT_TYPES_PART, "Types", NS_CONTENT_TYPES);
  if (!types.ok) return types;
  const rootRelationships = readRelationships(zip, ROOT_RELATIONSHIPS_PART, "");
  if (!rootRelationships.ok) return rootRelationships;
  const documents = rootRelationships.value.filter((rel) => rel.type === REL_OFFICE_DOCUMENT);
  const workbookPart = documents[0]?.target;
  if (workbookPart === undefined || documents.length > 1) {
    return notWorkbook(ROOT_RELATIONSHIPS_PART);
  }
  if (contentTypeOf(types.value, workbookPart) !== TYPE_WORKBOOK) return notWorkbook(workbookPart);

  const workbook = readPart(zip, workbookPart, "workbook", NS_MAIN);
  if (!workbook.ok) return workbook;
  const sheets = childElements(workbook.value, NS_MAIN, "sheets").flatMap((list) =>
    childElements(list, NS_MAIN, "sheet"),
  );
  if (sheets.length !== 1)
    return { ok: false, error: { kind: "sheet_count", count: sheets.length } };
  const sheet = sheets[0];
  const sheetId =
    sheet === undefined ? undefined : attributeIn(sheet, NS_OFFICE_RELATIONSHIPS, "id");
  const date1904Flag = childElements(workbook.value, NS_MAIN, "workbookPr")[0]?.attributes.get(
    "date1904",
  );
  const date1904 = date1904Flag === "1" || date1904Flag === "true";

  const workbookRelationshipsPart = relationshipsPartOf(workbookPart);
  const relationships = readRelationships(zip, workbookRelationshipsPart, workbookPart);
  if (!relationships.ok) return relationships;
  const sheetRelationship = relationships.value.find((rel) => rel.id === sheetId);
  if (sheetRelationship === undefined || sheetRelationship.type !== REL_WORKSHEET) {
    return notWorkbook(workbookRelationshipsPart);
  }
  const sheetPart = sheetRelationship.target;
  if (contentTypeOf(types.value, sheetPart) !== TYPE_WORKSHEET) return notWorkbook(sheetPart);

  const stringRelationships = relationships.value.filter((rel) => rel.type === REL_SHARED_STRINGS);
  if (stringRelationships.length > 1) return notWorkbook(workbookRelationshipsPart);
  let strings: string[] | undefined;
  const stringsPart = stringRelationships[0]?.target;
  if (stringsPart !== undefined) {
    if (contentTypeOf(types.value, stringsPart) !== TYPE_SHARED_STRINGS) {
      return notWorkbook(stringsPart);
    }
    const root = readPart(zip, stringsPart, "sst", NS_MAIN);
    if (!root.ok) return root;
    strings = sharedStrings(root.value);
  }

  const worksheet = readPart(zip, sheetPart, "worksheet", NS_MAIN);
  if (!worksheet.ok) return worksheet;
  const cells = readCells(worksheet.value, strings, sheetPart);
  if (!cells.ok) return cells;
  return stepOk({ cells: cells.value, date1904 });
}
