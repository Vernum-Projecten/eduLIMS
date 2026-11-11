// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// `idp add|list|enable|disable|rekey` of the host CLI (src/server/cli.ts, #46, ADR 0015); usage
// in docs/deployment.md, "First start". An operator adds the first identity provider through
// the same admin service as the screen (validation, discovery, encryption, an activity-log row
// with actor `system`). `idp add -` reads the JSON from standard input. The OIDC client secret
// comes from the JSON or from EDULIMS_IDP_CLIENT_SECRET, never a flag or an echoing prompt.
// Prints ids only.
import { readFile } from "node:fs/promises";
import { ask, hostEnvironment, openDatabase, parseCliArgs, systemContext } from "../cli/host.ts";
import type { Out } from "../db/migrate.ts";
import { parseRoleMap } from "../idp-roles.ts";
import { DataKeyError, keyringOf } from "./crypto.ts";
import { IDP_MESSAGE_CODES, idpSchemas } from "./input.ts";
import { rekeySecrets } from "./rekey.ts";
import { createProvider, setProviderEnabled } from "./service.ts";

const schemas = idpSchemas(IDP_MESSAGE_CODES);

const OPTIONS = {
  id: { type: "string" },
  protocol: { type: "string" },
  issuer: { type: "string" },
  "client-id": { type: "string" },
  "metadata-url": { type: "string" },
  "metadata-file": { type: "string" },
  "label-en": { type: "string" },
  "label-nl": { type: "string" },
  "role-claim": { type: "string" },
  "role-map": { type: "string" },
  "default-role": { type: "string" },
  domain: { type: "string", multiple: true },
  "email-authoritative": { type: "boolean" },
  "attest-pkce": { type: "boolean" },
  enable: { type: "boolean" },
} as const;

type Flags = NonNullable<ReturnType<typeof parseCliArgs<typeof OPTIONS>>>["values"];

async function value(flag: string | undefined, question: string): Promise<string> {
  return flag ?? (await ask(question)) ?? "";
}

/** Builds the `createProvider` input from flags, prompting on a terminal for what is missing. */
async function inputFromFlags(flags: Flags): Promise<unknown> {
  const providerId = await value(flags.id, "Provider id (for example entra): ");
  const protocol = await value(flags.protocol, "Protocol (oidc or saml): ");
  const labelEn = await value(flags["label-en"], "Button text in English: ");
  const roleMapText = await value(flags["role-map"], "Role map (value:role, comma-separated): ");
  const settings = {
    labelEn,
    labelNl: flags["label-nl"] ?? labelEn,
    icon: "key-round",
    sortOrder: 0,
    roleClaim: flags["role-claim"] ?? (protocol === "saml" ? "Role" : "roles"),
    roleMap: roleMapText
      ? [...parseRoleMap(roleMapText)].map(([entry, role]) => ({ value: entry, role }))
      : [],
    defaultRole: flags["default-role"] ?? null,
    emailAuthoritative: flags["email-authoritative"] ?? false,
    domains: flags.domain ?? [],
  };
  if (protocol === "saml") {
    const file = flags["metadata-file"];
    return {
      providerId,
      protocol,
      settings,
      saml: {
        metadataXml: file ? await readFile(file, "utf8") : "",
        metadataUrl:
          flags["metadata-url"] ?? (file ? "" : await value(undefined, "Metadata URL: ")),
        spPrivateKey: "",
      },
    };
  }
  return {
    providerId,
    protocol,
    settings,
    oidc: {
      issuer: await value(flags.issuer, "Issuer URL: "),
      clientId: await value(flags["client-id"], "Client ID: "),
      clientSecret: "",
      attestPkce: flags["attest-pkce"] ?? false,
    },
  };
}

/**
 * Completes the OIDC part of the input: an empty client secret comes from
 * `EDULIMS_IDP_CLIENT_SECRET` (never from a flag, which the shell history and `ps` keep, and
 * never from a prompt, which echoes it), and a missing `attestPkce` is off.
 */
function withDefaults(input: unknown): unknown {
  if (typeof input !== "object" || input === null) return input;
  const oidc: unknown = Reflect.get(input, "oidc");
  if (typeof oidc !== "object" || oidc === null) return input;
  const secret: unknown = Reflect.get(oidc, "clientSecret");
  const attest: unknown = Reflect.get(oidc, "attestPkce");
  return {
    ...input,
    oidc: {
      ...oidc,
      clientSecret: secret || (process.env["EDULIMS_IDP_CLIENT_SECRET"]?.trim() ?? ""),
      attestPkce: attest ?? false,
    },
  };
}

async function readInput(file: string): Promise<string> {
  if (file !== "-") return readFile(file, "utf8");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function add(argv: readonly string[], out: Out): Promise<number> {
  const parsedArgs = parseCliArgs(argv, OPTIONS);
  if (!parsedArgs || parsedArgs.positionals.length > 1) {
    out(USAGE);
    return 2;
  }
  const { values: flags, positionals } = parsedArgs;
  const file = positionals[0];
  let raw: unknown;
  try {
    raw = file ? JSON.parse(await readInput(file)) : await inputFromFlags(flags);
  } catch {
    out("refused: the provider JSON cannot be read");
    return 1;
  }
  const parsed = schemas.createProviderInput.safeParse(withDefaults(raw));
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      out(`refused: ${issue.path.join(".")}: ${issue.message}`);
    return 1;
  }
  const env = hostEnvironment();
  const db = openDatabase(env);
  try {
    const ctx = systemContext(db, env);
    const result = await createProvider(ctx, parsed.data);
    if (!result.ok) {
      out(`refused: ${result.error}`);
      return 1;
    }
    out(`created ${result.providerId} (disabled)`);
    if (flags.enable) {
      await setProviderEnabled(ctx, { providerId: result.providerId, enabled: true });
      out(`enabled ${result.providerId}`);
    }
    return 0;
  } finally {
    await db.destroy();
  }
}

async function list(out: Out): Promise<number> {
  const env = hostEnvironment();
  const db = openDatabase(env);
  try {
    const rows = await db
      .selectFrom("identity_provider")
      .select(["provider_id", "protocol", "enabled"])
      .orderBy("sort_order")
      .orderBy("provider_id")
      .execute();
    if (rows.length === 0) out("no identity providers");
    for (const row of rows) {
      out(`${row.provider_id}\t${row.protocol}\t${row.enabled ? "enabled" : "disabled"}`);
    }
    return 0;
  } finally {
    await db.destroy();
  }
}

async function toggle(providerId: string | undefined, enabled: boolean, out: Out): Promise<number> {
  const id = schemas.providerIdSchema.safeParse(providerId);
  if (!id.success) {
    out("refused: give a provider id");
    return 1;
  }
  const env = hostEnvironment();
  const db = openDatabase(env);
  try {
    // NOTE: #46; the host CLI is the way out when the last enabled provider must go.
    const result = await setProviderEnabled(systemContext(db, env), {
      providerId: id.data,
      enabled,
      allowLast: true,
    });
    if (!result.ok) {
      out(`refused: ${result.error}`);
      return 1;
    }
    out(`${enabled ? "enabled" : "disabled"} ${id.data}`);
    // NOTE: #92 M-1; the cache delays only the sign-in buttons, never a sign-in or a session.
    out("sign-ins and sessions follow at once; the sign-in page within 30 seconds");
    return 0;
  } finally {
    await db.destroy();
  }
}

/** Re-encrypts every stored secret under `EDULIMS_DATA_KEY` (rotation, ASVS V11.1.1). */
async function rekey(out: Out): Promise<number> {
  const env = hostEnvironment();
  const db = openDatabase(env);
  try {
    const { providers, idTokens } = await rekeySecrets(db, keyringOf(env));
    out(
      `re-encrypted ${providers} provider(s) and ${idTokens} ID token(s); remove EDULIMS_DATA_KEY_PREVIOUS now`,
    );
    return 0;
  } catch (error) {
    if (error instanceof DataKeyError) {
      out(`refused: ${error.kind}`);
      return 1;
    }
    throw error;
  } finally {
    await db.destroy();
  }
}

const USAGE =
  "usage: idp add <provider.json|-> [--enable] | idp add --id <id> --protocol oidc|saml … | idp list | idp enable <id> | idp disable <id> | idp rekey";

/** Runs one `idp` subcommand; returns the exit code. */
export async function idpCommand(args: readonly string[], out: Out): Promise<number> {
  const [command, ...rest] = args;
  switch (command) {
    case "add":
      return add(rest, out);
    case "list":
      return rest.length === 0 ? list(out) : usage(out);
    case "enable":
      return toggle(rest[0], true, out);
    case "disable":
      return toggle(rest[0], false, out);
    case "rekey":
      return rest.length === 0 ? rekey(out) : usage(out);
    default:
      return usage(out);
  }
}

function usage(out: Out): number {
  out(USAGE);
  return 2;
}
