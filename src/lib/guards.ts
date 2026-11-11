// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Route guards (navigation UX). They run on the server during SSR and use the session the
// server resolved in the root `beforeLoad`; data access is still enforced per server function.
import { type ParsedLocation, redirect } from "@tanstack/react-router";
import type { Role } from "@/lib/roles";
import { hasRole, portalPathFor, type SessionUser } from "@/server/authz";

/** Only relative, same-origin paths are accepted as post-login targets (no open redirect). */
export function safeRedirectPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/")) return undefined;
  if (value.startsWith("//") || value.startsWith("/\\")) return undefined;
  return value;
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
