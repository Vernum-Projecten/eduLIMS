// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Test support: the node paths of an ADL 1.4 operational template (the `eduLIMS-lab.v1` OPT) and
// of a canonical composition, so a test can hold the builder to the template (Q-COMP-1). A path is
// `/attribute[archetype id or at-code]/…`, as AQL writes it. The OPT is a generated, trusted file.

/** What the template allows at one node path. */
export interface OptNode {
  rmTypes: Set<string>;
  /** The RM types of an ELEMENT's `value`. */
  valueTypes: Set<string>;
  /** The lower bound of its occurrences, 0 when its attribute itself is optional. */
  lower: number;
}

interface Frame {
  attr: string;
  parent: Frame | null;
  rm?: string;
  node?: string;
  archetype?: string;
  lower?: number;
  /** The lower bound of the existence of the attribute it sits in. */
  existence: number;
  path?: string;
}

interface Attribute {
  name: string;
  existence?: number;
}

const TOKEN =
  /<(\/?)(attributes|children)\b[^>]*>|<rm_attribute_name>([^<]*)<\/rm_attribute_name>|<rm_type_name>([^<]*)<\/rm_type_name>|<node_id>([^<]*)<\/node_id>|<archetype_id>\s*<value>([^<]*)<\/value>|<lower>(\d+)<\/lower>/g;

function pathOf(frame: Frame): string {
  if (frame.path !== undefined) return frame.path;
  const key = frame.archetype ?? (frame.node ? frame.node : undefined);
  const parent = frame.parent === null ? "" : pathOf(frame.parent);
  frame.path = key === undefined ? `${parent}/${frame.attr}` : `${parent}/${frame.attr}[${key}]`;
  return frame.path;
}

/** Returns every archetyped node of the OPT `xml` by its path, the root being `""`. */
export function optNodes(xml: string): Map<string, OptNode> {
  const nodes = new Map<string, OptNode>();
  const root: Frame = { attr: "", parent: null, path: "", existence: 1 };
  const frames: Frame[] = [root];
  const closed: Frame[] = [];
  const attrs: Attribute[] = [];
  let lastOpened: "attribute" | "node" = "node";
  const top = () => {
    const frame = frames.at(-1);
    if (frame === undefined) throw new Error("the OPT closes more nodes than it opens");
    return frame;
  };
  for (const match of xml.matchAll(TOKEN)) {
    const [, close, tag, attrName, rm, node, archetype, lower] = match;
    if (tag === "attributes") {
      if (close) attrs.pop();
      else {
        attrs.push({ name: "" });
        lastOpened = "attribute";
      }
    } else if (tag === "children" && !close) {
      const attr = attrs.at(-1);
      frames.push({ attr: attr?.name ?? "", parent: top(), existence: attr?.existence ?? 0 });
      lastOpened = "node";
    } else if (tag === "children" && close) {
      closed.push(top());
      frames.pop();
    } else if (attrName !== undefined) {
      const attr = attrs.at(-1);
      if (attr !== undefined) attr.name = attrName;
    } else if (rm !== undefined) {
      top().rm ??= rm;
    } else if (node !== undefined) {
      top().node ??= node;
    } else if (archetype !== undefined) {
      top().archetype ??= archetype;
    } else if (lower !== undefined) {
      const attr = attrs.at(-1);
      if (lastOpened === "attribute" && attr !== undefined) attr.existence ??= Number(lower);
      else top().lower ??= Number(lower);
    }
  }
  // NOTE: an archetype root names its archetype after its attributes, so paths wait for the end.
  for (const frame of [...closed, root]) record(nodes, frame);
  return nodes;
}

function record(nodes: Map<string, OptNode>, frame: Frame): void {
  const keyed = frame.archetype !== undefined || Boolean(frame.node);
  const rm = frame.rm ?? "";
  if (keyed) {
    const path = pathOf(frame);
    const known = nodes.get(path) ?? { rmTypes: new Set(), valueTypes: new Set(), lower: 0 };
    known.rmTypes.add(rm);
    known.lower = Math.max(known.lower, frame.existence >= 1 ? (frame.lower ?? 0) : 0);
    nodes.set(path, known);
  } else if (frame.attr === "value" && frame.parent !== null) {
    const parent = pathOf(frame.parent);
    const known = nodes.get(parent) ?? { rmTypes: new Set(), valueTypes: new Set(), lower: 0 };
    known.valueTypes.add(rm);
    nodes.set(parent, known);
  }
}

/** One archetyped node of a canonical composition: its path, its type and its value's type. */
export interface CompositionNode {
  path: string;
  type: string;
  valueType?: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Returns every node of `composition` that carries an `archetype_node_id`, the root included. */
export function compositionNodes(composition: Record<string, unknown>): CompositionNode[] {
  const out: CompositionNode[] = [];
  const visit = (value: Record<string, unknown>, path: string) => {
    const held = value["value"];
    out.push({
      path,
      type: String(value["_type"]),
      ...(value["_type"] === "ELEMENT" && isObject(held)
        ? { valueType: String(held["_type"]) }
        : {}),
    });
    for (const [attr, child] of Object.entries(value)) {
      const children = Array.isArray(child) ? child : [child];
      for (const item of children) {
        if (!isObject(item) || typeof item["archetype_node_id"] !== "string") continue;
        visit(item, `${path}/${attr}[${item["archetype_node_id"]}]`);
      }
    }
  };
  visit(composition, "");
  return out;
}
