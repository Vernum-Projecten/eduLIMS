// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Route guards (navigation UX). They run on the server during SSR and use the session the
// server resolved in the root `beforeLoad`; data access is still enforced per server function.
import { type ParsedLocation, redirect } from "@tanstack/react-router";
import type { Role } from "@/lib/roles";
import { hasRole, portalPathFor, type SessionUser } from "@/server/authz";

/** A placeholder origin to resolve candidate paths against; never requested. */
const REDIRECT_BASE = "https://edulims.invalid";

/** Control characters, whitespace and backslashes, which browsers strip or rewrite in URLs. */
const UNSAFE_URL_CHARACTERS = /[\p{Cc}\s\\]/u;

/**
 * Returns `value` as a post-login target when it is a path on this origin, or `undefined`.
 *
 * NOTE: OWASP A01 (open redirect), #29; a tab in `/<TAB>/evil.example` is stripped by browsers
 * into `//evil.example`, so unsafe characters are refused before the same-origin check.
 */
export function safeRedirectPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/")) return undefined;
  if (UNSAFE_URL_CHARACTERS.test(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value, REDIRECT_BASE);
  } catch {
    return undefined;
  }
  if (url.origin !== REDIRECT_BASE) return undefined;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function requireUser({
  context,
  location,
}: {
  context: { user: SessionUser | null };
  location: ParsedLocation;
}): { user: SessionUser } {
  if (!context.user) {
    throw redirect({ to: "/login", search: { redirect: location.href } });
  }
  return { user: context.user };
}

/** Sends users without `role` to their own portal (or home when they have none). */
export function requireRole(role: Role) {
  return ({ context }: { context: { user: SessionUser } }): void => {
    if (!hasRole(context.user, role)) {
      throw redirect({ to: portalPathFor(context.user) ?? "/" });
    }
  };
}
