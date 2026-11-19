// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { MAX_XML_ATTRIBUTES, MAX_XML_DEPTH, MAX_XML_ELEMENTS } from "./limits.ts";
import {
  attributeIn,
  childElements,
  directText,
  parseXml,
  type XmlElement,
  type XmlLimits,
} from "./xml.ts";

const LIMITS: XmlLimits = {
  maxElements: MAX_XML_ELEMENTS,
  maxDepth: MAX_XML_DEPTH,
  maxAttributes: MAX_XML_ATTRIBUTES,
};

function root(text: string): XmlElement {
  const result = parseXml(text, LIMITS);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.root;
}

function refused(text: string) {
  const result = parseXml(text, LIMITS);
  if (result.ok) throw new Error("expected a refusal");
  return result.error;
}

const char = (code: number) => String.fromCodePoint(code);

describe("parseXml", () => {
  it("reads elements, attributes and text in order", () => {
    const element = root(
      '<?xml version="1.0" encoding="UTF-8"?>\n<a x="1" y=\'2\'><b/>t<c>u</c></a>',
    );
    expect(element.name).toBe("a");
    expect([...element.attributes]).toEqual([
      ["x", "1"],
      ["y", "2"],
    ]);
    expect(
      element.children.map((child) => (typeof child === "string" ? child : child.name)),
    ).toEqual(["b", "t", "c"]);
  });

  it("decodes the predefined entities and character references", () => {
    const element = root('<a v="&quot;&apos;">&lt;&gt;&amp;&#65;&#x42;</a>');
    expect(directText(element)).toBe("<>&AB");
    expect(element.attributes.get("v")).toBe("\"'");
  });

  it("reads CDATA as text and skips comments and processing instructions", () => {
    const element = root("<!-- c --><?pi data?><a><!-- d --><![CDATA[<x>]]><?pi?>y</a><!-- e -->");
    expect(directText(element)).toBe("<x>y");
  });

  it("refuses a DTD before the root", () => {
    expect(refused('<!DOCTYPE a [<!ENTITY e SYSTEM "file:///etc/passwd">]><a>&e;</a>')).toEqual({
      kind: "xml_dtd_refused",
    });
  });

  it("refuses an entity expansion bomb at its DTD", () => {
    const bomb = '<!DOCTYPE a [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]><a>&b;</a>';
    expect(refused(bomb)).toEqual({ kind: "xml_dtd_refused" });
  });

  it("refuses a DTD inside the root", () => {
    expect(refused("<a><!DOCTYPE a></a>")).toEqual({ kind: "xml_dtd_refused" });
  });

  it("refuses an undeclared entity", () => {
    expect(refused("<a>&nbsp;</a>")).toEqual({ kind: "xml_malformed", offset: 3 });
  });

  it("refuses a character reference to a character XML does not allow", () => {
    expect(refused("<a>&#0;</a>")).toMatchObject({ kind: "xml_malformed" });
    expect(refused("<a>&#xD800;</a>")).toMatchObject({ kind: "xml_malformed" });
  });

  it("refuses an encoding other than UTF-8", () => {
    expect(refused('<?xml version="1.0" encoding="UTF-16"?><a/>')).toMatchObject({
      kind: "xml_malformed",
    });
  });

  it.each([
    ["a mismatched end tag", "<a></b>"],
    ["an unclosed element", "<a><b></b>"],
    ["two roots", "<a/><b/>"],
    ["text after the root", "<a/>x"],
    ["no root", "  "],
    ["a duplicate attribute", '<a x="1" x="2"/>'],
    ["an unquoted attribute", "<a x=1/>"],
    ["attributes without space", '<a x="1"y="2"/>'],
    ["a < in an attribute", '<a x="<"/>'],
    ["]]> in text", "<a>]]></a>"],
    ["an unterminated comment", "<a><!-- x</a>"],
    ["-- inside a comment", "<a><!-- x -- y --></a>"],
    ["a reserved processing instruction", "<a><?xml x?></a>"],
    ["a bad markup declaration", "<a><!ELEMENT a></a>"],
    ["a bad name", "<1a/>"],
    ["a missing =", '<a x "1"/>'],
  ])("refuses %s", (_, text) => {
    expect(refused(text)).toMatchObject({ kind: "xml_malformed" });
  });
});

describe("parseXml and the Char production (XML 1.0 §2.2)", () => {
  it.each([
    ["NUL", 0x0],
    ["a C0 control", 0x1],
    ["vertical tab", 0xb],
    ["form feed", 0xc],
    ["U+FFFE", 0xfffe],
    ["U+FFFF", 0xffff],
  ])("refuses a raw %s in text and in an attribute value", (_, code) => {
    expect(refused(`<a>x${char(code)}y</a>`)).toEqual({ kind: "xml_malformed", offset: 4 });
    expect(refused(`<a v="${char(code)}"/>`)).toEqual({ kind: "xml_malformed", offset: 6 });
  });

  it("refuses a lone surrogate", () => {
    expect(refused(`<a>${String.fromCharCode(0xd800)}</a>`)).toMatchObject({
      kind: "xml_malformed",
    });
  });

  it("accepts tab, line feed, carriage return and characters beyond the BMP", () => {
    expect(directText(root(`<a>\t\n\r${char(0x1f600)}</a>`))).toBe(`\t\n\r${char(0x1f600)}`);
  });
});

describe("parseXml caps, enforced while reading", () => {
  const small: XmlLimits = { maxElements: 4, maxDepth: 3, maxAttributes: 2 };

  it("accepts exactly the element cap and refuses one more", () => {
    expect(parseXml("<a><b/><b/><b/></a>", small).ok).toBe(true);
    expect(parseXml("<a><b/><b/><b/><b/></a>", small)).toEqual({
      ok: false,
      error: { kind: "xml_too_large", cap: "elements" },
    });
  });

  it("accepts exactly the depth cap and refuses one level deeper", () => {
    expect(parseXml("<a><b><c/></b></a>", small).ok).toBe(true);
    expect(parseXml("<a><b><c><d/></c></b></a>", small)).toEqual({
      ok: false,
      error: { kind: "xml_too_large", cap: "depth" },
    });
  });

  it("accepts exactly the attribute cap and refuses one more", () => {
    expect(parseXml('<a x="1" y="2"/>', small).ok).toBe(true);
    expect(parseXml('<a x="1" y="2" z="3"/>', small)).toEqual({
      ok: false,
      error: { kind: "xml_too_large", cap: "attributes" },
    });
  });

  it("holds the real caps at and one over each", () => {
    const elements = (count: number) => `<a>${"<b/>".repeat(count - 1)}</a>`;
    expect(parseXml(elements(MAX_XML_ELEMENTS), LIMITS).ok).toBe(true);
    expect(refused(elements(MAX_XML_ELEMENTS + 1))).toEqual({
      kind: "xml_too_large",
      cap: "elements",
    });
    const deep = (depth: number) => `${"<a>".repeat(depth)}${"</a>".repeat(depth)}`;
    expect(parseXml(deep(MAX_XML_DEPTH), LIMITS).ok).toBe(true);
    expect(refused(deep(MAX_XML_DEPTH + 1))).toEqual({ kind: "xml_too_large", cap: "depth" });
    const attributes = (count: number) =>
      `<a ${Array.from({ length: count }, (_, index) => `a${index}="1"`).join(" ")}/>`;
    expect(parseXml(attributes(MAX_XML_ATTRIBUTES), LIMITS).ok).toBe(true);
    expect(refused(attributes(MAX_XML_ATTRIBUTES + 1))).toEqual({
      kind: "xml_too_large",
      cap: "attributes",
    });
  });

  it("stops a flood of two million elements at the cap", () => {
    expect(refused(`<a>${"<x/>".repeat(2_000_000)}</a>`)).toEqual({
      kind: "xml_too_large",
      cap: "elements",
    });
  });
});

describe("namespaces", () => {
  it("resolves the default namespace and prefixes, inherited by children", () => {
    const element = root('<w xmlns="urn:d" xmlns:x="urn:x"><c/><x:c/><c xmlns="urn:o"/></w>');
    expect(element.namespace).toBe("urn:d");
    expect(childElements(element, "urn:d", "c")).toHaveLength(1);
    expect(childElements(element, "urn:x", "c")).toHaveLength(1);
    expect(childElements(element, "urn:o", "c")).toHaveLength(1);
  });

  it("does not match a child in a foreign namespace", () => {
    const element = root('<w xmlns="urn:d"><evil:c xmlns:evil="urn:evil">1</evil:c></w>');
    expect(childElements(element, "urn:d", "c")).toEqual([]);
  });

  it("finds an attribute by its namespace, whatever the prefix", () => {
    const element = root('<w xmlns:q="urn:r" q:id="7" id="8"/>');
    expect(attributeIn(element, "urn:r", "id")).toBe("7");
    expect(attributeIn(element, "urn:other", "id")).toBeUndefined();
  });

  it.each([
    ["an unbound element prefix", "<x:a/>"],
    ["an unbound attribute prefix", '<a x:b="1"/>'],
    ["a rebound xml prefix", '<a xmlns:xml="urn:x"/>'],
    ["an empty prefixed declaration", '<a xmlns:x=""/>'],
    ["an empty prefix", "<:a/>"],
  ])("refuses %s", (_, text) => {
    expect(refused(text)).toMatchObject({ kind: "xml_malformed" });
  });

  it("lets an empty default declaration undo the default namespace", () => {
    const element = root('<w xmlns="urn:d"><c xmlns=""/></w>');
    const child = element.children[0];
    expect(typeof child !== "string" && child?.namespace).toBeUndefined();
  });
});
