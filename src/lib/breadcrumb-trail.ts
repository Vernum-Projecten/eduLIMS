// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/** One step of the breadcrumb below a section: the name a route's loader returned, its address. */
export interface Crumb {
  label: string;
  to: string;
}

/** Returns the `crumb` a route's loader returned (the page's own name), if it returned one. */
export function crumbOf(loaderData: unknown): string | null {
  if (typeof loaderData !== "object" || loaderData === null) return null;
  const crumb: unknown = Reflect.get(loaderData, "crumb");
  return typeof crumb === "string" && crumb !== "" ? crumb : null;
}

/**
 * Returns the trail of the matched routes that name themselves, outermost first, as JSON: a
 * string keeps the router's selector result stable between renders. A layout and the page inside
 * it that name the same thing show once (a simulation's layout and its overview, the labs layout
 * and the labs list).
 */
export function trailOf(matches: readonly { loaderData?: unknown; pathname: string }[]): string {
  const trail: Crumb[] = [];
  for (const match of matches) {
    const label = crumbOf(match.loaderData);
    if (label !== null && trail.at(-1)?.label !== label) {
      trail.push({ label, to: match.pathname });
    }
  }
  return JSON.stringify(trail);
}

/** Returns the trail {@link trailOf} wrote, dropping anything that is not a step. */
export function parseTrail(json: string): Crumb[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const label: unknown = Reflect.get(item, "label");
    const to: unknown = Reflect.get(item, "to");
    return typeof label === "string" && typeof to === "string" ? [{ label, to }] : [];
  });
}
