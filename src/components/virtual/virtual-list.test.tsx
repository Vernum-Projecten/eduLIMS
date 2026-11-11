// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VirtualList } from "@/components/virtual/virtual-list";

const ITEMS = Array.from({ length: 10_000 }, (_, index) => `row-${index + 1}`);

function serverRender(): string {
  return renderToString(
    <VirtualList
      items={ITEMS}
      getKey={(item) => item}
      renderItem={(item) => <span>{item}</span>}
      label="Rows"
      estimateRowHeight={50}
      initialViewportHeight={500}
    />,
  );
}

describe("VirtualList on the server", () => {
  it("renders only the first window of 10,000 rows (#64)", () => {
    const html = serverRender();
    const rows = html.match(/<li /g) ?? [];
    // 500 px / 50 px = 10 rows in view, plus the overscan below the window.
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.length).toBeLessThanOrEqual(20);
    expect(html).toContain("row-1<");
    expect(html).not.toContain("row-10000<");
  });

  it("gives each row its position in the whole set", () => {
    const html = serverRender();
    expect(html).toContain('aria-setsize="10000"');
    expect(html).toContain('aria-posinset="1"');
    expect(html).toContain('aria-label="Rows"');
  });

  it("makes exactly one row a tab stop", () => {
    const html = serverRender();
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
  });

  it("lays rows out in normal flow until the client positions them, with no inline style", () => {
    const html = serverRender();
    expect(html).not.toMatch(/<li[^>]*class="[^"]*\babsolute\b/);
    expect(html).not.toContain("style=");
  });
});
