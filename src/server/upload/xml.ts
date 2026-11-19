// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A small, strict reader for the machine-written XML parts of one workbook contract (XML 1.0,
// Fifth Edition, https://www.w3.org/TR/xml/; Namespaces in XML 1.0). It refuses any document type
// declaration, so no entity can be declared, expanded or fetched (ASVS 5.0 V1.5.1); it knows only
// the five predefined entities and character references (§4.6, §4.1), checks every raw character
// against the Char production (§2.2), and stops at its element, depth and attribute caps while
// it reads. Names are ASCII, which every SpreadsheetML, relationship and content type name is.

/** An element with its resolved namespace, its attributes as written and its children. */
export interface XmlElement {
  readonly name: string;
  readonly localName: string;
  /** The namespace URI the element's prefix (or the default namespace) is bound to in scope. */
  readonly namespace: string | undefined;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: readonly XmlNode[];
  /** The namespace prefixes in scope at the element, `""` for the default namespace. */
  readonly scope: ReadonlyMap<string, string>;
}

/** A child of an element: an element, or a run of character data. */
export type XmlNode = XmlElement | string;

/** The caps {@link parseXml} enforces while it reads. */
export interface XmlLimits {
  readonly maxElements: number;
  readonly maxDepth: number;
  readonly maxAttributes: number;
}

/** The result of {@link parseXml}. */
export type XmlResult =
  | { readonly ok: true; readonly root: XmlElement }
  | { readonly ok: false; readonly error: XmlError };

/** Which cap of {@link XmlLimits} a document passed. */
export type XmlCap = "elements" | "depth" | "attributes";

/** Why a document was refused: not well formed at `offset`, a DTD, or over a cap. */
export type XmlError =
  | { readonly kind: "xml_malformed"; readonly offset: number }
  | { readonly kind: "xml_dtd_refused" }
  | { readonly kind: "xml_too_large"; readonly cap: XmlCap };

interface OpenElement {
  name: string;
  localName: string;
  namespace: string | undefined;
  attributes: Map<string, string>;
  children: XmlNode[];
  scope: ReadonlyMap<string, string>;
}

const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const NAME = /[A-Za-z_:][-A-Za-z0-9_.:]*/y;
const SPACE = /[ \t\r\n]+/y;
const REFERENCE = /&(?:(lt|gt|amp|quot|apos)|#([0-9]{1,7})|#x([0-9A-Fa-f]{1,6}));/y;
/** A character outside the Char production of XML 1.0 §2.2, a lone surrogate included. */
const NOT_CHAR = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;
const PREDEFINED: Readonly<Record<string, string>> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

class Malformed extends Error {
  readonly offset: number;
  constructor(offset: number) {
    super(`malformed XML at ${offset}`);
    this.offset = offset;
  }
}

class DtdRefused extends Error {}

class TooLarge extends Error {
  readonly cap: XmlCap;
  constructor(cap: XmlCap) {
    super(`XML over its ${cap} cap`);
    this.cap = cap;
  }
}

function isXmlChar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

function splitName(name: string, at: number): { prefix: string; local: string } {
  const colon = name.indexOf(":");
  if (colon < 0) return { prefix: "", local: name };
  const prefix = name.slice(0, colon);
  const local = name.slice(colon + 1);
  if (prefix.length === 0 || local.length === 0 || local.includes(":")) throw new Malformed(at);
  return { prefix, local };
}

class Reader {
  private position = 0;
  private elements = 0;
  private readonly text: string;
  private readonly limits: XmlLimits;

  constructor(text: string, limits: XmlLimits) {
    this.text = text;
    this.limits = limits;
  }

  parse(): XmlElement {
    const bad = NOT_CHAR.exec(this.text);
    if (bad !== null) throw new Malformed(bad.index);
    this.prolog();
    const root = this.element();
    this.misc();
    if (this.position !== this.text.length) throw new Malformed(this.position);
    return root;
  }

  private startsWith(token: string): boolean {
    return this.text.startsWith(token, this.position);
  }

  private match(pattern: RegExp): string | undefined {
    pattern.lastIndex = this.position;
    const found = pattern.exec(this.text);
    if (found === null) return undefined;
    this.position = pattern.lastIndex;
    return found[0];
  }

  private expect(token: string): void {
    if (!this.startsWith(token)) throw new Malformed(this.position);
    this.position += token.length;
  }

  private until(token: string): string {
    const end = this.text.indexOf(token, this.position);
    if (end < 0) throw new Malformed(this.position);
    const content = this.text.slice(this.position, end);
    this.position = end + token.length;
    return content;
  }

  private name(): string {
    const name = this.match(NAME);
    if (name === undefined) throw new Malformed(this.position);
    return name;
  }

  private prolog(): void {
    if (/^<\?xml[ \t\r\n]/.test(this.text)) {
      const declaration = this.until("?>");
      const encoding = /encoding[ \t\r\n]*=[ \t\r\n]*["']([^"']*)["']/.exec(declaration);
      if (encoding !== null && encoding[1]?.toLowerCase() !== "utf-8") throw new Malformed(0);
    }
    this.misc();
    if (this.startsWith("<!DOCTYPE")) throw new DtdRefused();
  }

  /** Skips white space, comments and processing instructions outside the root element. */
  private misc(): void {
    for (;;) {
      if (this.match(SPACE) !== undefined) continue;
      if (this.startsWith("<!--")) {
        this.comment();
        continue;
      }
      if (this.startsWith("<?")) {
        this.instruction();
        continue;
      }
      return;
    }
  }

  private comment(): void {
    this.position += 4;
    const body = this.until("-->");
    if (body.includes("--") || body.endsWith("-")) throw new Malformed(this.position);
  }

  private instruction(): void {
    this.position += 2;
    const target = this.name();
    if (target.toLowerCase() === "xml") throw new Malformed(this.position);
    this.until("?>");
  }

  /** Reads one element and everything inside it, without recursion. */
  private element(): XmlElement {
    const stack: OpenElement[] = [];
    let opened = this.startTag(new Map([["xml", XML_NAMESPACE]]), 1);
    if (opened.closed) return opened.element;
    stack.push(opened.element);
    for (;;) {
      const current = stack.at(-1);
      if (current === undefined) throw new Malformed(this.position);
      if (this.position >= this.text.length) throw new Malformed(this.position);
      if (this.startsWith("</")) {
        this.position += 2;
        if (this.name() !== current.name) throw new Malformed(this.position);
        this.match(SPACE);
        this.expect(">");
        stack.pop();
        const parent = stack.at(-1);
        if (parent === undefined) return current;
        parent.children.push(current);
      } else if (this.startsWith("<!--")) {
        this.comment();
      } else if (this.startsWith("<![CDATA[")) {
        this.position += 9;
        this.appendText(current, this.until("]]>"));
      } else if (this.startsWith("<?")) {
        this.instruction();
      } else if (this.startsWith("<!")) {
        throw this.startsWith("<!DOCTYPE") ? new DtdRefused() : new Malformed(this.position);
      } else if (this.startsWith("<")) {
        opened = this.startTag(current.scope, stack.length + 1);
        if (opened.closed) current.children.push(opened.element);
        else stack.push(opened.element);
      } else {
        this.appendText(current, this.characterData());
      }
    }
  }

  private startTag(
    parentScope: ReadonlyMap<string, string>,
    depth: number,
  ): { element: OpenElement; closed: boolean } {
    this.elements += 1;
    if (this.elements > this.limits.maxElements) throw new TooLarge("elements");
    if (depth > this.limits.maxDepth) throw new TooLarge("depth");
    const at = this.position;
    this.expect("<");
    const name = this.name();
    const attributes = new Map<string, string>();
    let closed: boolean;
    for (;;) {
      const space = this.match(SPACE);
      if (this.startsWith("/>")) {
        this.position += 2;
        closed = true;
        break;
      }
      if (this.startsWith(">")) {
        this.position += 1;
        closed = false;
        break;
      }
      if (space === undefined) throw new Malformed(this.position);
      if (attributes.size >= this.limits.maxAttributes) throw new TooLarge("attributes");
      const attribute = this.name();
      this.match(SPACE);
      this.expect("=");
      this.match(SPACE);
      const quote = this.text[this.position];
      if (quote !== '"' && quote !== "'") throw new Malformed(this.position);
      this.position += 1;
      const start = this.position;
      const raw = this.until(quote);
      if (raw.includes("<")) throw new Malformed(start);
      if (attributes.has(attribute)) throw new Malformed(start);
      attributes.set(attribute, this.decode(raw, start));
    }
    const scope = this.scopeOf(parentScope, attributes, at);
    const { prefix, local } = splitName(name, at);
    const namespace = scope.get(prefix);
    if (prefix !== "" && namespace === undefined) throw new Malformed(at);
    for (const attribute of attributes.keys()) {
      const split = splitName(attribute, at);
      if (split.prefix !== "" && split.prefix !== "xmlns" && !scope.has(split.prefix)) {
        throw new Malformed(at);
      }
    }
    return {
      element: { name, localName: local, namespace, attributes, children: [], scope },
      closed,
    };
  }

  /** Adds the element's own `xmlns` declarations to the scope it inherits. */
  private scopeOf(
    parent: ReadonlyMap<string, string>,
    attributes: ReadonlyMap<string, string>,
    at: number,
  ): ReadonlyMap<string, string> {
    let scope: Map<string, string> | undefined;
    for (const [attribute, value] of attributes) {
      let prefix: string | undefined;
      if (attribute === "xmlns") prefix = "";
      else if (attribute.startsWith("xmlns:")) prefix = attribute.slice(6);
      if (prefix === undefined) continue;
      if (prefix === "xml" || prefix === "xmlns" || (prefix !== "" && value === "")) {
        throw new Malformed(at);
      }
      scope ??= new Map(parent);
      if (value === "") scope.delete(prefix);
      else scope.set(prefix, value);
    }
    return scope ?? parent;
  }

  private characterData(): string {
    const start = this.position;
    const end = this.text.indexOf("<", start);
    const raw = this.text.slice(start, end < 0 ? this.text.length : end);
    this.position = start + raw.length;
    if (raw.includes("]]>")) throw new Malformed(start);
    return this.decode(raw, start);
  }

  private appendText(element: OpenElement, text: string): void {
    const last = element.children.at(-1);
    if (typeof last === "string") element.children[element.children.length - 1] = last + text;
    else if (text.length > 0) element.children.push(text);
  }

  private decode(raw: string, start: number): string {
    if (!raw.includes("&")) return raw;
    let out = "";
    let index = 0;
    for (;;) {
      const amp = raw.indexOf("&", index);
      if (amp < 0) return out + raw.slice(index);
      out += raw.slice(index, amp);
      REFERENCE.lastIndex = amp;
      const found = REFERENCE.exec(raw);
      if (found === null) throw new Malformed(start + amp);
      const [, entity, decimal, hex] = found;
      if (entity !== undefined) {
        out += PREDEFINED[entity] ?? "";
      } else {
        const code = decimal !== undefined ? Number(decimal) : Number.parseInt(hex ?? "", 16);
        if (!isXmlChar(code)) throw new Malformed(start + amp);
        out += String.fromCodePoint(code);
      }
      index = REFERENCE.lastIndex;
    }
  }
}

/**
 * Parses one XML document into its root element.
 *
 * Refuses a document type declaration anywhere (`xml_dtd_refused`); a document over one of
 * `limits` as soon as it passes it (`xml_too_large`); and an entity other than the five
 * predefined ones, a character outside the XML Char production, a declared encoding other than
 * UTF-8, an unbound namespace prefix, or anything else not well formed (`xml_malformed`).
 */
export function parseXml(text: string, limits: XmlLimits): XmlResult {
  try {
    return { ok: true, root: new Reader(text, limits).parse() };
  } catch (error) {
    if (error instanceof DtdRefused) return { ok: false, error: { kind: "xml_dtd_refused" } };
    if (error instanceof TooLarge) {
      return { ok: false, error: { kind: "xml_too_large", cap: error.cap } };
    }
    if (error instanceof Malformed) {
      return { ok: false, error: { kind: "xml_malformed", offset: error.offset } };
    }
    throw error;
  }
}

/** Returns the child elements of `element` with the namespace `namespace` and the local name. */
export function childElements(
  element: XmlElement,
  namespace: string,
  localName: string,
): XmlElement[] {
  return element.children.filter(
    (child): child is XmlElement =>
      typeof child !== "string" && child.localName === localName && child.namespace === namespace,
  );
}

/** Returns the value of the attribute with the namespace `namespace` and the local name. */
export function attributeIn(
  element: XmlElement,
  namespace: string,
  localName: string,
): string | undefined {
  for (const [name, value] of element.attributes) {
    const colon = name.indexOf(":");
    if (colon < 0 || name.slice(colon + 1) !== localName) continue;
    const prefix = name.slice(0, colon);
    if (prefix !== "xmlns" && element.scope.get(prefix) === namespace) return value;
  }
  return undefined;
}

/** Returns the character data directly inside `element`, joined. */
export function directText(element: XmlElement): string {
  return element.children.filter((child): child is string => typeof child === "string").join("");
}
