// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { embeddedIpv4, isPrivateAddress } from "./addresses.ts";
import {
  checkFetchOrigin,
  discoverOidc,
  fetchSamlMetadata,
  IdpValidationError,
  type OriginPolicy,
  parseSamlMetadata,
  serviceLocation,
} from "./validate.ts";

const METADATA = readFileSync(
  new URL("../../../tests/fixtures/idp/saml-idp-metadata.xml", import.meta.url),
  "utf8",
);
const ISSUER = "https://login.example.test/tenant/v2.0";
const PUBLIC: OriginPolicy = {
  production: true,
  privateOrigins: [],
  resolve: async () => ["93.184.215.14"],
};

async function problem(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return error instanceof IdpValidationError ? error.kind : "other";
  }
}

function syncProblem(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof IdpValidationError ? error.kind : "other";
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("issuer origins (SSRF, ASVS V1.3.6)", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
    "::",
    "224.0.0.1",
    "198.18.0.1",
    "not-an-ip",
  ])("treats %s as private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    ["the hex IPv4-mapped form of 127.0.0.1", "::ffff:7f00:1"],
    ["the hex IPv4-mapped form of 10.0.0.1", "0:0:0:0:0:ffff:a00:1"],
    ["NAT64 of 127.0.0.1", "64:ff9b::7f00:1"],
    ["NAT64 of 169.254.169.254 in dotted form", "64:ff9b::169.254.169.254"],
    ["the local-use NAT64 prefix", "64:ff9b:1::5db8:d70e"],
    ["6to4 of 192.168.1.1", "2002:c0a8:101::1"],
    ["6to4 of 127.0.0.1", "2002:7f00:1::"],
    ["the IPv4-compatible form", "::7f00:1"],
    ["Teredo", "2001:0:4136:e378:8000:63bf:3fff:fdd2"],
    ["site-local", "fec0::1"],
  ])("treats %s as private (M3a)", (_name, address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it("reads the IPv4 address inside mapped, NAT64 and 6to4 addresses", () => {
    expect(embeddedIpv4("::ffff:7f00:1")).toBe("127.0.0.1");
    expect(embeddedIpv4("64:ff9b::5db8:d70e")).toBe("93.184.215.14");
    expect(embeddedIpv4("2002:5db8:d70e::1")).toBe("93.184.215.14");
    expect(embeddedIpv4("2606:2800:21f:cb07:6820:80da:af6b:8b2c")).toBeNull();
  });

  it.each([
    "93.184.215.14",
    "2606:2800:21f:cb07:6820:80da:af6b:8b2c",
    "::ffff:5db8:d70e",
    "64:ff9b::5db8:d70e",
    "2002:5db8:d70e::1",
  ])("treats %s as public", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it("accepts a public https issuer and returns its origin", async () => {
    expect(await checkFetchOrigin(ISSUER, PUBLIC)).toBe("https://login.example.test");
  });

  it("refuses an issuer that resolves to a private address (DNS)", async () => {
    const policy = { ...PUBLIC, resolve: async () => ["93.184.215.14", "10.0.0.5"] };
    expect(await problem(() => checkFetchOrigin(ISSUER, policy))).toBe("issuer_private");
  });

  it("refuses a literal loopback issuer and an unresolvable one", async () => {
    expect(await problem(() => checkFetchOrigin("https://127.0.0.1/realm", PUBLIC))).toBe(
      "issuer_private",
    );
    const none = { ...PUBLIC, resolve: async () => [] };
    expect(await problem(() => checkFetchOrigin(ISSUER, none))).toBe("issuer_unresolvable");
    const failing = { ...PUBLIC, resolve: () => Promise.reject(new Error("ENOTFOUND")) };
    expect(await problem(() => checkFetchOrigin(ISSUER, failing))).toBe("issuer_unresolvable");
  });

  it("refuses http in production, even for an allowed private origin", async () => {
    const allowed = { ...PUBLIC, privateOrigins: ["http://localhost:8180"] };
    expect(await problem(() => checkFetchOrigin("http://localhost:8180/realms/x", allowed))).toBe(
      "issuer_insecure",
    );
    expect(await problem(() => checkFetchOrigin("http://login.example.test/x", PUBLIC))).toBe(
      "issuer_insecure",
    );
  });

  it("allows an operator-listed private origin, over http only outside production", async () => {
    const dev = { production: false, privateOrigins: ["http://localhost:8180"] };
    expect(await checkFetchOrigin("http://localhost:8180/realms/edulims", dev)).toBe(
      "http://localhost:8180",
    );
    const onPrem = { production: true, privateOrigins: ["https://idp.campus.internal"] };
    expect(await checkFetchOrigin("https://idp.campus.internal/realms/x", onPrem)).toBe(
      "https://idp.campus.internal",
    );
  });
});

/** Stubs `fetch` with an OIDC discovery document for {@link ISSUER}. */
function stubDiscovery(document: Record<string, unknown>): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== `${ISSUER}/.well-known/openid-configuration`) {
      return new Response(null, { status: 404 });
    }
    return Response.json({
      issuer: ISSUER,
      authorization_endpoint: "https://login.example.test/tenant/oauth2/v2.0/authorize",
      token_endpoint: "https://login.example.test/tenant/oauth2/v2.0/token",
      jwks_uri: "https://login.example.test/tenant/discovery/v2.0/keys",
      userinfo_endpoint: "https://graph.example.test/oidc/userinfo",
      end_session_endpoint: "https://login.example.test/tenant/oauth2/v2.0/logout",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
      ...document,
    });
  });
}

describe("OIDC discovery", () => {
  it("stores the endpoints, the end-session endpoint, and never the UserInfo endpoint", async () => {
    stubDiscovery({});
    const discovered = await discoverOidc(ISSUER, PUBLIC);
    expect(discovered).toEqual({
      discoveryEndpoint: `${ISSUER}/.well-known/openid-configuration`,
      authorizationEndpoint: "https://login.example.test/tenant/oauth2/v2.0/authorize",
      tokenEndpoint: "https://login.example.test/tenant/oauth2/v2.0/token",
      jwksEndpoint: "https://login.example.test/tenant/discovery/v2.0/keys",
      tokenEndpointAuthentication: "client_secret_basic",
      endSessionEndpoint: "https://login.example.test/tenant/oauth2/v2.0/logout",
    });
    expect(discovered).not.toHaveProperty("userInfoEndpoint");
  });

  it("refuses a discovery document for another issuer (mix-up, V10.2.2)", async () => {
    stubDiscovery({ issuer: "https://login.example.test/other/v2.0" });
    expect(await problem(() => discoverOidc(ISSUER, PUBLIC))).toBe("issuer_mismatch");
  });

  it("refuses endpoints on another origin than the issuer", async () => {
    stubDiscovery({ token_endpoint: "https://elsewhere.example.test/token" });
    expect(await problem(() => discoverOidc(ISSUER, PUBLIC))).not.toBeNull();
  });

  it("refuses a provider without PKCE S256 (V10.2.1)", async () => {
    stubDiscovery({ code_challenge_methods_supported: ["plain"] });
    expect(await problem(() => discoverOidc(ISSUER, PUBLIC))).toBe("no_pkce");
    const attested = { attestPkce: true };
    expect(await problem(() => discoverOidc(ISSUER, PUBLIC, attested))).toBe("no_pkce");
  });

  it("refuses a document that does not list code_challenge_methods_supported (H1)", async () => {
    stubDiscovery({ code_challenge_methods_supported: undefined });
    expect(await problem(() => discoverOidc(ISSUER, PUBLIC))).toBe("no_pkce");
  });

  it("accepts that document when the administrator attests PKCE S256 (H1)", async () => {
    stubDiscovery({ code_challenge_methods_supported: undefined });
    const discovered = await discoverOidc(ISSUER, PUBLIC, { attestPkce: true });
    expect(discovered.tokenEndpoint).toBe("https://login.example.test/tenant/oauth2/v2.0/token");
  });

  it("refuses a provider that only accepts private_key_jwt", async () => {
    stubDiscovery({ token_endpoint_auth_methods_supported: ["private_key_jwt"] });
    expect(await problem(() => discoverOidc(ISSUER, PUBLIC))).toBe("unsupported_client_auth");
  });

  it("drops an end-session endpoint on another origin", async () => {
    stubDiscovery({ end_session_endpoint: "https://elsewhere.example.test/logout" });
    expect((await discoverOidc(ISSUER, PUBLIC)).endSessionEndpoint).toBeNull();
  });

  it("reports an unreachable discovery document", async () => {
    stubDiscovery({});
    expect(await problem(() => discoverOidc(`${ISSUER}/missing`, PUBLIC))).toBe("discovery_failed");
  });
});

describe("SAML metadata", () => {
  it("reads the entity id, the HTTP-Redirect SSO service and single logout", () => {
    expect(parseSamlMetadata(METADATA)).toEqual({
      entityId: "https://idp.example.test/saml",
      ssoUrl: "https://idp.example.test/saml/sso",
      singleLogout: true,
    });
  });

  it("refuses metadata without a signing certificate", () => {
    const unsigned = METADATA.replace(/<md:KeyDescriptor[\s\S]*<\/md:KeyDescriptor>/, "");
    expect(syncProblem(() => parseSamlMetadata(unsigned))).toBe("metadata_no_signing_cert");
  });

  it("refuses metadata that lists no NameIDFormat at all (L8)", () => {
    const none = METADATA.replace(/<md:NameIDFormat>[^<]*<\/md:NameIDFormat>/g, "");
    expect(syncProblem(() => parseSamlMetadata(none))).toBe("metadata_no_persistent_nameid");
  });

  it("refuses an IdP that offers no persistent NameID", () => {
    const transient = METADATA.replace(
      "<md:NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:persistent</md:NameIDFormat>",
      "",
    );
    expect(syncProblem(() => parseSamlMetadata(transient))).toBe("metadata_no_persistent_nameid");
  });

  it("refuses an IdP without an HTTP-Redirect SSO service", () => {
    const postOnly = METADATA.replace(
      /<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2\.0:bindings:HTTP-Redirect"[^>]*\/>/,
      "",
    );
    expect(syncProblem(() => parseSamlMetadata(postOnly))).toBe("metadata_no_sso_service");
  });

  it("refuses a DOCTYPE (XXE, V1.5.1), SP metadata and too much XML", () => {
    expect(syncProblem(() => parseSamlMetadata(`<!DOCTYPE x [<!ENTITY e "x">]>${METADATA}`))).toBe(
      "metadata_invalid",
    );
    expect(syncProblem(() => parseSamlMetadata("<md:EntityDescriptor/>"))).toBe("metadata_invalid");
    expect(syncProblem(() => parseSamlMetadata(`${METADATA}${" ".repeat(110 * 1024)}`))).toBe(
      "metadata_too_large",
    );
  });

  it("reads a service location in every form samlify returns", () => {
    const binding = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect";
    expect(serviceLocation("https://a", binding)).toBe("https://a");
    expect(serviceLocation({ [binding]: "https://b" }, binding)).toBe("https://b");
    expect(serviceLocation([{ binding, location: "https://c" }], binding)).toBe("https://c");
    expect(serviceLocation([], binding)).toBeNull();
    expect(serviceLocation("", binding)).toBeNull();
    expect(serviceLocation(undefined, binding)).toBeNull();
  });
});

describe("SAML metadata fetch (M3b, L5)", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
    server = undefined;
  });

  async function serve(body: string, status = 200): Promise<string> {
    server = createServer((_req, res) => {
      res.writeHead(status, { "content-type": "application/samlmetadata+xml" });
      res.end(body);
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address: AddressInfo | string | null | undefined = server?.address();
    if (typeof address !== "object" || address === null) throw new Error("no port");
    return `http://127.0.0.1:${address.port}`;
  }

  it("reads metadata from an operator-allowed private origin", async () => {
    const origin = await serve(METADATA);
    const dev = { production: false, privateOrigins: [origin] };
    expect(await fetchSamlMetadata(`${origin}/metadata`, dev)).toBe(METADATA);
  });

  it("stops reading at the size limit (L5)", async () => {
    const origin = await serve("x".repeat(200 * 1024));
    const dev = { production: false, privateOrigins: [origin] };
    expect(await problem(() => fetchSamlMetadata(`${origin}/metadata`, dev))).toBe(
      "metadata_too_large",
    );
  });

  it("refuses a redirect instead of following it", async () => {
    const origin = await serve("", 302);
    const dev = { production: false, privateOrigins: [origin] };
    expect(await problem(() => fetchSamlMetadata(`${origin}/metadata`, dev))).toBe(
      "metadata_fetch_failed",
    );
  });

  it("resolves the host once, at connect time, and refuses a private answer", async () => {
    const resolve = vi.fn(async () => ["127.0.0.1"]);
    const policy = { production: true, privateOrigins: [], resolve };
    expect(
      await problem(() => fetchSamlMetadata("https://idp.example.test/metadata", policy)),
    ).toBe("issuer_private");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("refuses a literal private address without connecting", async () => {
    expect(await problem(() => fetchSamlMetadata("https://[::ffff:7f00:1]/m", PUBLIC))).toBe(
      "issuer_private",
    );
  });
});
