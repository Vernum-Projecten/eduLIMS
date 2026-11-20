// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Who reaches the test catalogue (D9; owner 2026-11-20 on #393): an administrator manages it. The
// middleware checks first; this keeps each service function safe on its own.
import "@tanstack/react-start/server-only";
import { hasRole, type SessionUser } from "../authz.ts";
import { AuthError } from "../middleware.ts";

/**
 * Refuses a caller without the admin role, whatever else they hold (ADR 0012).
 *
 * @throws AuthError 403 without the admin role.
 */
export function assertCatalogueAdmin(actor: Pick<SessionUser, "roles">): void {
  if (!hasRole(actor, "admin")) throw new AuthError(403);
}
