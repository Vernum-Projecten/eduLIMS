// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  childElements,
  directText,
  localName,
  namespaceOf,
  parseXml,
  type XmlElement,
} from "./xml.ts";

function root(text: string): XmlElement {
  const result = parseXml(text);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.root;
}

function refused(text: string) {
  const result = parseXml(text);
  if (result.ok) throw new Error("expected a refusal");
  return result.error;
}

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

  it("reads deep nesting without recursion", () => {
    const depth = 20_000;
    const element = root(`${"<a>".repeat(depth)}${"</a>".repeat(depth)}`);
    expect(element.name).toBe("a");
  });
});

describe("helpers", () => {
  const element = root('<x:w xmlns:x="urn:example"><x:c>1</x:c><c>2</c><d/></x:w>');

  it("splits the local name", () => {
    expect(localName("x:w")).toBe("w");
    expect(localName("w")).toBe("w");
  });

  it("finds the namespace of the element's prefix", () => {
    expect(namespaceOf(element)).toBe("urn:example");
    expect(namespaceOf(root('<w xmlns="urn:default"/>'))).toBe("urn:default");
  });

  it("finds child elements by local name", () => {
    expect(childElements(element, "c").map(directText)).toEqual(["1", "2"]);
  });
});
