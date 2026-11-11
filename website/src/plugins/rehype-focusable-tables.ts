// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/** The part of a hast node this plugin reads. */
interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/**
 * Returns a rehype plugin that makes every Markdown table focusable.
 *
 * Starlight lets a wide table scroll sideways inside its own box, so a keyboard user needs
 * to focus it to scroll it (WCAG 2.1.1, axe rule `scrollable-region-focusable`).
 */
export function rehypeFocusableTables() {
  const visit = (node: HastNode): void => {
    if (node.type === "element" && node.tagName === "table") {
      node.properties = { ...node.properties, tabIndex: 0 };
    }
    for (const child of node.children ?? []) visit(child);
  };
  return (tree: HastNode) => visit(tree);
}
