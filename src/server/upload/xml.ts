// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A small, strict reader for the machine-written XML parts of a workbook (XML 1.0, Fifth
// Edition, https://www.w3.org/TR/xml/). It refuses any document type declaration, so no entity
// can be declared, expanded or fetched (ASVS 5.0 V1.5.1); it knows only the five predefined
// entities and character references (§4.6, §4.1). Names are ASCII, which every SpreadsheetML,
// package relationship and content type name is.

/** An element with its attributes as written and its children in document order. */
export interface XmlElement {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: readonly XmlNode[];
}

/** A child of an element: an element, or a run of character data. */
export type XmlNode = XmlElement | string;

/** The result of {@link parseXml}. */
export type XmlResult =
  | { readonly ok: true; readonly root: XmlElement }
  | { readonly ok: false; readonly error: XmlError };

/** Why a document was refused: it is not well formed at `offset`, or it carries a DTD. */
export type XmlError =
  | { readonly kind: "xml_malformed"; readonly offset: number }
  | { readonly kind: "xml_dtd_refused" };

interface OpenElement {
  name: string;
  attributes: Map<string, string>;
  children: XmlNode[];
}

const NAME = /[A-Za-z_:][-A-Za-z0-9_.:]*/y;
const SPACE = /[ \t\r\n]+/y;
const REFERENCE = /&(?:(lt|gt|amp|quot|apos)|#([0-9]{1,7})|#x([0-9A-Fa-f]{1,6}));/y;
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

class Reader {
  private position = 0;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  parse(): XmlElement {
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

  /** Reads one element and everything inside it, without recursion, so depth cannot overflow. */
  private element(): XmlElement {
    const stack: OpenElement[] = [];
    let opened = this.startTag();
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
        opened = this.startTag();
        if (opened.closed) current.children.push(opened.element);
        else stack.push(opened.element);
      } else {
        this.appendText(current, this.characterData());
      }
    }
  }

  private startTag(): { element: OpenElement; closed: boolean } {
    this.expect("<");
    const element: OpenElement = { name: this.name(), attributes: new Map(), children: [] };
    for (;;) {
      const space = this.match(SPACE);
      if (this.startsWith("/>")) {
        this.position += 2;
        return { element, closed: true };
      }
      if (this.startsWith(">")) {
        this.position += 1;
        return { element, closed: false };
      }
      if (space === undefined) throw new Malformed(this.position);
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
      if (element.attributes.has(attribute)) throw new Malformed(start);
      element.attributes.set(attribute, this.decode(raw, start));
    }
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
 * Refuses a document type declaration anywhere (`xml_dtd_refused`), an entity other than the
 * five predefined ones, a declared encoding other than UTF-8, and anything not well formed
 * (`xml_malformed` with the offset of the problem).
 */
export function parseXml(text: string): XmlResult {
  try {
    return { ok: true, root: new Reader(text).parse() };
  } catch (error) {
    if (error instanceof DtdRefused) return { ok: false, error: { kind: "xml_dtd_refused" } };
    if (error instanceof Malformed) {
      return { ok: false, error: { kind: "xml_malformed", offset: error.offset } };
    }
    throw error;
  }
}

/** Returns the local part of a qualified name: `worksheet` for `x:worksheet`. */
export function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}

/** Returns the namespace URI the element's own prefix (or the default namespace) is bound to. */
export function namespaceOf(element: XmlElement): string | undefined {
  const colon = element.name.indexOf(":");
  const declaration = colon < 0 ? "xmlns" : `xmlns:${element.name.slice(0, colon)}`;
  return element.attributes.get(declaration);
}

/** Returns the child elements of `element` with the local name `name`. */
export function childElements(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter(
    (child): child is XmlElement => typeof child !== "string" && localName(child.name) === name,
  );
}

/** Returns the character data directly inside `element`, joined. */
export function directText(element: XmlElement): string {
  return element.children.filter((child): child is string => typeof child === "string").join("");
}
