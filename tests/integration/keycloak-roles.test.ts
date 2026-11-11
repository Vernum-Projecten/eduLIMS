// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Reads real ID tokens from the development Keycloak (docker/keycloak/edulims-realm.json) and
// feeds their claims through the role mapping eduLIMS runs on every sign-in (ADR 0010, 0012).
// The tokens come from the realm's test-only `edulims-test` client (password grant), never from
// the app client. Skipped when that Keycloak or its test client is not reachable, as in CI;
// EDULIMS_IT_KEYCLOAK_ISSUER points it at another realm URL than the dev stack's.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NO_ROLE_ERROR, ROLE_CONFLICT_ERROR } from "../../src/lib/identity-providers.ts";
import { type IdpRoles, parseRoleMap, resolveIdpRoles } from "../../src/server/idp-roles.ts";
import { createIdpRoleSync } from "../../src/server/idp-sync.ts";

const ISSUER =
  process.env["EDULIMS_IT_KEYCLOAK_ISSUER"]?.trim() || "http://localhost:8180/realms/edulims";
const CLIENT = { id: "edulims-test", secret: "edulims-test-secret" };

/** The default role map of `.env.example` and the group-path alternative. */
const ROLE_MAP = parseRoleMap(
  "edulims-student:student,edulims-teacher:teacher,edulims-admin:admin",
);
const GROUP_MAP = parseRoleMap("/Students:student,/Teachers:teacher,/Administrators:admin");

/** Returns the decoded payload of the user's ID token, or `null` when the grant is refused. */
async function idTokenClaims(username: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: CLIENT.id,
      client_secret: CLIENT.secret,
      username,
      password: username,
      scope: "openid",
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  const token =
    typeof body === "object" && body !== null ? Reflect.get(body, "id_token") : undefined;
  if (typeof token !== "string") return null;
  const payload = token.split(".")[1] ?? "";
  const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (typeof claims !== "object" || claims === null || Array.isArray(claims)) return null;
  return Object.fromEntries(Object.entries(claims));
}

/** Whether the dev Keycloak answers with the test client (the realm file is imported). */
async function keycloakReady(): Promise<boolean> {
  try {
    return (await idTokenClaims("student")) !== null;
  } catch {
    return false;
  }
}

const ready = await keycloakReady();
if (!ready) {
  console.warn(
    `Keycloak role-mapping test skipped: no edulims-test client at ${ISSUER}. ` +
      "Recreate the Keycloak container to import the realm (pnpm dev:db:stop && pnpm dev:db).",
  );
}

const roles = (...set: ("student" | "teacher" | "admin")[]): IdpRoles => ({
  kind: "roles",
  roles: set,
});

/** Per user: how the realm grants the roles, and the expected role set per claim. */
const CASES = [
  { user: "student", via: "group Students", realm: roles("student"), groups: roles("student") },
  { user: "teacher", via: "group Teachers", realm: roles("teacher"), groups: roles("teacher") },
  { user: "admin", via: "direct role", realm: roles("admin"), groups: { kind: "none" } },
  {
    user: "coordinator",
    via: "groups Teachers and Administrators",
    realm: roles("teacher", "admin"),
    groups: roles("teacher", "admin"),
  },
  {
    user: "teacher-direct",
    via: "direct role",
    realm: roles("teacher"),
    groups: { kind: "none" },
  },
  {
    user: "mixed",
    via: "group Teachers and direct admin role",
    realm: roles("teacher", "admin"),
    groups: roles("teacher"),
  },
  {
    user: "conflict",
    via: "groups Students and Teachers",
    realm: { kind: "conflict" },
    groups: { kind: "conflict" },
  },
  { user: "norole", via: "no eduLIMS role", realm: { kind: "none" }, groups: { kind: "none" } },
] as const satisfies readonly { user: string; via: string; realm: IdpRoles; groups: IdpRoles }[];

describe.skipIf(!ready)("development Keycloak realm roles (ADR 0012)", () => {
  const claims = new Map<string, Record<string, unknown>>();

  beforeAll(async () => {
    for (const { user } of CASES) {
      const payload = await idTokenClaims(user);
      if (!payload) throw new Error(`Keycloak refused the password grant for ${user}`);
      claims.set(user, payload);
    }
  });

  it.each(CASES)("$user ($via): effective realm roles in realm_access.roles", (c) => {
    const result = resolveIdpRoles({
      claims: claims.get(c.user) ?? {},
      claimPath: "realm_access.roles",
      roleMap: ROLE_MAP,
    });
    expect(result).toEqual(c.realm);
  });

  it.each(CASES)("$user ($via): group paths in the groups claim", (c) => {
    const result = resolveIdpRoles({
      claims: claims.get(c.user) ?? {},
      claimPath: "groups",
      roleMap: GROUP_MAP,
    });
    expect(result).toEqual(c.groups);
  });

  it("refuses the sign-in of conflict with role_conflict and of norole with no_edulims_role", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sync = createIdpRoleSync({
      claimPaths: { keycloak: "realm_access.roles" },
      roleMap: ROLE_MAP,
    });
    const ctx = { context: { internalAdapter: { updateUser: vi.fn() } } } as unknown as Parameters<
      typeof sync
    >[1];
    const signIn = (user: string) =>
      sync(
        {
          user: { email: `${user}@edulims.test` },
          source: {
            action: "create-user",
            method: "oauth",
            oauth: { providerId: "keycloak", profile: claims.get(user) ?? {} },
          },
        },
        ctx,
      );
    expect(await signIn("conflict")).toMatchObject({ error: ROLE_CONFLICT_ERROR });
    expect(await signIn("norole")).toMatchObject({ error: NO_ROLE_ERROR });
    vi.restoreAllMocks();
  });
});
