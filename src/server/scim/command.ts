// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// `scim token create|rotate|revoke <providerId>` and `scim external-id <providerId> <claim>` of
// the host CLI (src/server/cli.ts, #45, ADR 0017); usage in docs/deployment.md, "Provisioning
// with SCIM". The token goes to standard output once and is never stored or logged in the clear.
import { parseProviderId } from "../../lib/identity-providers.ts";
import { hostEnvironment, openDatabase } from "../cli/host.ts";
import type { Out } from "../db/migrate.ts";
import { setScimExternalIdClaim } from "./settings.ts";
import {
  createScimToken,
  revokeScimToken,
  rotateScimToken,
  type ScimTokenError,
} from "./tokens.ts";

const USAGE =
  "usage: scim token create|rotate|revoke <provider-id> | scim external-id <provider-id> <claim>|--account-key";

const REFUSALS: Record<ScimTokenError, string> = {
  not_found: "no identity provider with that id",
  exists: "the provider already has a SCIM token; rotate it instead",
  no_token: "the provider has no SCIM token",
};

function usage(out: Out): number {
  out(USAGE);
  return 2;
}

async function token(action: string | undefined, providerId: string, out: Out): Promise<number> {
  if (action !== "create" && action !== "rotate" && action !== "revoke") return usage(out);
  const env = hostEnvironment();
  const db = openDatabase(env);
  try {
    const ctx = { db, actor: { type: "system" as const } };
    if (action === "revoke") {
      const result = await revokeScimToken(ctx, providerId);
      if (!result.ok) {
        out(`refused: ${REFUSALS[result.error]}`);
        return 1;
      }
      out(`revoked the SCIM token of ${providerId}; provisioning from it stops now`);
      return 0;
    }
    const result =
      action === "create"
        ? await createScimToken(ctx, providerId)
        : await rotateScimToken(ctx, providerId);
    if (!result.ok) {
      out(`refused: ${REFUSALS[result.error]}`);
      return 1;
    }
    out(`SCIM token for ${providerId} (shown once, store it in the identity provider now):`);
    out(result.token);
    out(`expires ${result.expiresAt}`);
    if (result.previousValidUntil) {
      out(`the previous token works until ${result.previousValidUntil}`);
    }
    return 0;
  } finally {
    await db.destroy();
  }
}

async function externalId(
  providerId: string,
  claim: string | undefined,
  out: Out,
): Promise<number> {
  if (claim === undefined) return usage(out);
  const env = hostEnvironment();
  const db = openDatabase(env);
  try {
    const value = claim === "--account-key" ? null : claim;
    const result = await setScimExternalIdClaim(
      { db, actor: { type: "system" } },
      { providerId, claim: value },
    );
    if (!result.ok) {
      out(
        `refused: ${result.error === "not_found" ? REFUSALS.not_found : "the claim is not valid"}`,
      );
      return 1;
    }
    out(`${providerId} links SCIM users on ${value ?? "the account key"}`);
    out("a running eduLIMS applies this within 30 seconds");
    return 0;
  } finally {
    await db.destroy();
  }
}

/** Runs one `scim` subcommand; returns the exit code. */
export async function scimCommand(args: readonly string[], out: Out): Promise<number> {
  const [command, ...rest] = args;
  if (command === "token" && rest.length === 2) {
    const providerId = parseProviderId(rest[1]);
    if (!providerId) return usage(out);
    return token(rest[0], providerId, out);
  }
  if (command === "external-id" && rest.length === 2) {
    const providerId = parseProviderId(rest[0]);
    if (!providerId) return usage(out);
    return externalId(providerId, rest[1], out);
  }
  return usage(out);
}
