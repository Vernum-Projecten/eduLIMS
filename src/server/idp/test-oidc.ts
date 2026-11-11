// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Test support: an OIDC provider at the HTTP layer. It answers the token endpoint with an ID
// token signed by a fresh RS256 key and the JWKS endpoint with that key, so a real SSO callback
// runs through better-auth and the sso plugin's signature, issuer and audience checks.
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";

/** A stubbed OIDC provider: its `fetch`, and the claims its next ID token carries. */
export interface StubIdp {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  claims: Record<string, unknown>;
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Returns an OIDC provider stub for `issuer` and `clientId` (the test provider's own). */
export function stubIdp(issuer: string, clientId: string): StubIdp {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = randomUUID();
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
  const stub: StubIdp = {
    claims: {},
    fetch: async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === `${issuer}/jwks`) return Response.json({ keys: [jwk] });
      if (url !== `${issuer}/token`) return new Response(null, { status: 404 });
      const now = Math.floor(Date.now() / 1000);
      const header = base64url({ alg: "RS256", typ: "JWT", kid });
      const payload = base64url({
        iss: issuer,
        aud: clientId,
        iat: now,
        exp: now + 300,
        ...stub.claims,
      });
      const signer = createSign("RSA-SHA256");
      signer.update(`${header}.${payload}`);
      const signature = signer.sign(privateKey).toString("base64url");
      return Response.json({
        access_token: "stub-access-token",
        id_token: `${header}.${payload}.${signature}`,
        token_type: "Bearer",
        expires_in: 300,
      });
    },
  };
  return stub;
}
