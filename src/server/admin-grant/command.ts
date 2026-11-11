// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// `admin grant <email> [--provider <id>]` and `admin revoke <email>` of the host CLI
// (src/server/cli.ts, #48): the break-glass path when no administrator exists or the identity
// provider is down. Prints outcome codes only, never the email address back.
import { z } from "zod";
import { PROVIDER_ID_PATTERN } from "../../lib/identity-providers.ts";
import { hostEnvironment, openDatabase, parseCliArgs } from "../cli/host.ts";
import type { Out } from "../db/migrate.ts";
import { grantAdmin, revokeAdmin } from "./grants.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  granted: "granted: the user now holds the admin role (local)",
  already_admin: "unchanged: the user already holds the admin role",
  pending: "pending: applied at the first sign-in through that provider, within 24 hours",
  revoked: "revoked",
  not_admin: "unchanged: the user does not hold the admin role",
  role_conflict: "refused: a student cannot also be an administrator (ADR 0012)",
  email_unverified:
    "refused: this user's email address is not verified by their provider, so it may not be theirs",
  provider_required:
    "refused: nobody signed in with this email yet; name the provider (--provider <id>)",
  provider_unknown: "refused: no such provider",
  provider_not_authoritative:
    "refused: that provider's email addresses are not marked as verified, so no grant can be bound to it",
  last_admin: "refused: this is the last administrator",
  not_found: "refused: no user and no pending grant with this email",
};

const USAGE = "usage: admin grant <email> [--provider <id>] | admin revoke <email>";

const adminArgs = z.object({
  action: z.enum(["grant", "revoke"]),
  email: z.email().max(254),
  provider: z.string().regex(PROVIDER_ID_PATTERN).optional(),
});

/** Grants or revokes the admin role from the host; returns the exit code. */
export async function adminCommand(args: readonly string[], out: Out): Promise<number> {
  const parsedArgs = parseCliArgs(args, { provider: { type: "string" } });
  if (!parsedArgs) {
    out(USAGE);
    return 2;
  }
  const [action, email, ...extra] = parsedArgs.positionals;
  const input = adminArgs.safeParse({ action, email, provider: parsedArgs.values["provider"] });
  if (extra.length > 0) {
    out(USAGE);
    return 2;
  }
  if (!input.success) {
    const fields = input.error.issues.map((issue) => issue.path.join(".")).join(", ");
    out(`refused: invalid ${fields}`);
    out(USAGE);
    return 1;
  }
  const env = hostEnvironment();
  const db = openDatabase(env);
  try {
    const now = new Date();
    const { data } = input;
    const result =
      data.action === "grant"
        ? await grantAdmin(db, { email: data.email, providerId: data.provider, now })
        : await revokeAdmin(db, { email: data.email, now });
    const code = result.ok ? result.kind : result.error;
    out(MESSAGES[code] ?? code);
    return result.ok ? 0 : 1;
  } finally {
    await db.destroy();
  }
}
