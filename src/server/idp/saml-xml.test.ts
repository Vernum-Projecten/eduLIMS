// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Safe XML parsing on the SAML route (ASVS 5.0 V1.5.1, #298): a SAMLResponse posted to the ACS
// and IdP metadata an administrator adds may carry a DTD. Each is refused, nothing expands, and
// no file or URL an entity names is read: a local listener counts every request it receives.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import "@better-auth/sso";
import type { Kysely } from "kysely";
import { SamlLib } from "samlify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "../auth.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { parseEnv } from "../env.ts";
import { createTestAuth } from "../test-auth.ts";
import { VALID_ENV } from "../test-env.ts";
import { keyringOf } from "./crypto.ts";
import { invalidateProviderCache } from "./registry.ts";
import { createProvider, type IdpServiceContext, setProviderEnabled } from "./service.ts";
import { fixtureMetadata } from "./test-providers.ts";

const BASE = VALID_ENV.BETTER_AUTH_URL;
const PROVIDER = "xxe-saml";
/** Text that only the local file holds: it must never reach a response. */
const FILE_MARKER = "xxe-file-marker-7f3a";
const METADATA = fixtureMetadata();

/** A local HTTP listener that records every path asked of it. */
interface Listener {
  origin: string;
  hits: string[];
  server: Server;
}

async function listen(serve: (path: string) => string | null): Promise<Listener> {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    const path = req.url ?? "";
    hits.push(path);
    const body = serve(path);
    res.writeHead(body === null ? 404 : 200, { "content-type": "application/xml" });
    res.end(body ?? "");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address: AddressInfo | string | null = server.address();
  if (typeof address !== "object" || address === null) throw new Error("no port");
  return { origin: `http://127.0.0.1:${address.port}`, hits, server };
}

async function close(listener: Listener | undefined): Promise<void> {
  await new Promise((resolve) => (listener ? listener.server.close(resolve) : resolve(undefined)));
}

/** A well-formed SAMLResponse with one assertion, `prolog` before it and `nameId` as subject. */
function samlResponseXml(prolog: string, nameId: string): string {
  return [
    prolog,
    '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
    ' xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r1" Version="2.0"',
    ` IssueInstant="${new Date().toISOString()}" Destination="${BASE}/api/auth/sso/saml2/sp/acs/${PROVIDER}">`,
    "<saml:Issuer>https://idp.example.test/saml</saml:Issuer>",
    '<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>',
    '<saml:Assertion ID="_a1" Version="2.0" IssueInstant="2026-11-19T12:00:00Z">',
    "<saml:Issuer>https://idp.example.test/saml</saml:Issuer>",
    "<saml:Subject>",
    `<saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">${nameId}</saml:NameID>`,
    "</saml:Subject></saml:Assertion></samlp:Response>",
  ].join("");
}

/** A small "billion laughs": four levels of ten, 10,000 copies if a parser expanded it. */
const LAUGHS = [
  "<!DOCTYPE samlp:Response [",
  '<!ENTITY lol "lol">',
  '<!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">',
  '<!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">',
  '<!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">',
  '<!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">',
  "]>",
].join("");

/**
 * One hostile DTD: `ref` uses its entity, and `acsRefusal` is the ACS error code of the first
 * parser that refuses it (the sso plugin's assertion count, or samlify's XML gate).
 */
interface HostileDtd {
  dtd: string;
  ref: string;
  acsRefusal: "saml_invalid_xml" | "saml_error";
}

/** The DTDs under test, each naming the listener or the marker file. */
function hostileDtds(origin: string, file: string): Record<string, HostileDtd> {
  return {
    "an internal entity expansion": { dtd: LAUGHS, ref: "&lol4;", acsRefusal: "saml_error" },
    "an external entity on a file URL": {
      dtd: `<!DOCTYPE samlp:Response [<!ENTITY xxe SYSTEM "${file}">]>`,
      ref: "&xxe;",
      acsRefusal: "saml_invalid_xml",
    },
    "an external entity on an http URL": {
      dtd: `<!DOCTYPE samlp:Response [<!ENTITY xxe SYSTEM "${origin}/entity">]>`,
      ref: "&xxe;",
      acsRefusal: "saml_invalid_xml",
    },
    "an external DTD": {
      dtd: `<!DOCTYPE samlp:Response SYSTEM "${origin}/dtd">`,
      ref: "subject-1",
      acsRefusal: "saml_error",
    },
    "an external parameter entity": {
      dtd: `<!DOCTYPE samlp:Response [<!ENTITY % ext SYSTEM "${origin}/param"> %ext;]>`,
      ref: "subject-1",
      acsRefusal: "saml_invalid_xml",
    },
  };
}

let workDir = "";
let fileUrl = "";
let target: Listener | undefined;

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "edulims-xxe-"));
  const file = join(workDir, "secret.txt");
  writeFileSync(file, FILE_MARKER, "utf8");
  fileUrl = pathToFileURL(file).href;
  target = await listen(() => `<!ENTITY leak "${FILE_MARKER}">`);
});

afterAll(async () => {
  await close(target);
  rmSync(workDir, { recursive: true, force: true });
});

beforeEach(() => {
  target?.hits.splice(0);
});

function targetOrigin(): string {
  if (!target) throw new Error("listener not started");
  return target.origin;
}

describe("samlify's XML gate on every SAML message (V1.5.1)", () => {
  it("accepts the same response without a DTD (the control)", async () => {
    await expect(SamlLib.isValidXml(samlResponseXml("", "subject-1"))).resolves.toBeDefined();
  });

  it.each(Object.keys(hostileDtds("http://x", "file:///x")))(
    "refuses a response with %s before it is parsed",
    async (name) => {
      const payload = hostileDtds(targetOrigin(), fileUrl)[name];
      if (!payload) throw new Error(`no payload ${name}`);
      await expect(SamlLib.isValidXml(samlResponseXml(payload.dtd, payload.ref))).rejects.toThrow(
        "ERR_INVALID_XML",
      );
      expect(target?.hits).toEqual([]);
    },
  );

  it("refuses a lower-case doctype too", async () => {
    const xml = samlResponseXml('<!doctype samlp:Response [<!ENTITY e "x">]>', "&e;");
    await expect(SamlLib.isValidXml(xml)).rejects.toThrow("ERR_INVALID_XML");
  });
});

describe("the ACS refuses a SAMLResponse with a DTD (V1.5.1)", () => {
  let db: Kysely<DB>;
  let auth: Auth;

  beforeAll(async () => {
    db = await createTestDb();
    const env = parseEnv(VALID_ENV);
    auth = await createTestAuth(env, { db, type: "postgres" });
    const ctx: IdpServiceContext = {
      db,
      keyring: keyringOf(env),
      policy: { production: false, privateOrigins: [] },
      baseURL: BASE,
      actor: { type: "system" },
    };
    expect(await createProvider(ctx, samlInput(PROVIDER, { metadataXml: METADATA }))).toEqual({
      ok: true,
      providerId: PROVIDER,
    });
    await setProviderEnabled(ctx, { providerId: PROVIDER, enabled: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    invalidateProviderCache();
    await db?.destroy();
  });

  async function postAcs(xml: string): Promise<Response> {
    const body = new URLSearchParams({ SAMLResponse: Buffer.from(xml, "utf8").toString("base64") });
    return auth.handler(
      new Request(`${BASE}/api/auth/sso/saml2/sp/acs/${PROVIDER}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }),
    );
  }

  it("passes the same response without a DTD on to signature verification (the control)", async () => {
    const isValidXml = vi.spyOn(SamlLib, "isValidXml");
    const verifySignature = vi.spyOn(SamlLib, "verifySignature");
    const response = await postAcs(samlResponseXml("", "subject-1"));
    expect(response.status).toBe(302);
    await expect(isValidXml.mock.results[0]?.value).resolves.toBeDefined();
    expect(verifySignature).toHaveBeenCalledTimes(1);
  });

  it.each(Object.keys(hostileDtds("http://x", "file:///x")))(
    "refuses %s: no session, no expansion, no file read, no request",
    async (name) => {
      const payload = hostileDtds(targetOrigin(), fileUrl)[name];
      if (!payload) throw new Error(`no payload ${name}`);
      const isValidXml = vi.spyOn(SamlLib, "isValidXml");
      const verifySignature = vi.spyOn(SamlLib, "verifySignature");
      const response = await postAcs(samlResponseXml(payload.dtd, payload.ref));
      const location = response.headers.get("location") ?? "";
      const text = `${location}${await response.text()}`;
      expect(response.status).toBe(302);
      expect(new URL(location).searchParams.get("error")).toBe(payload.acsRefusal);
      if (payload.acsRefusal === "saml_error") {
        expect(isValidXml).toHaveBeenCalledTimes(1);
        await expect(isValidXml.mock.results[0]?.value).rejects.toThrow("ERR_INVALID_XML");
      } else {
        expect(isValidXml).not.toHaveBeenCalled();
      }
      expect(verifySignature).not.toHaveBeenCalled();
      expect(response.headers.getSetCookie().join(";")).not.toContain("session_token");
      expect(text).not.toContain(FILE_MARKER);
      expect(text).not.toContain("lollol");
      expect(target?.hits).toEqual([]);
      const sessions = await db.selectFrom("session").select("id").execute();
      expect(sessions).toEqual([]);
    },
  );
});

describe("IdP metadata with a DTD is refused when an administrator adds it (V1.5.1)", () => {
  let db: Kysely<DB>;
  let metadataHost: Listener | undefined;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await close(metadataHost);
    invalidateProviderCache();
    await db?.destroy();
  });

  function context(privateOrigins: string[]): IdpServiceContext {
    return {
      db,
      keyring: keyringOf(parseEnv(VALID_ENV)),
      policy: { production: false, privateOrigins },
      baseURL: BASE,
      actor: { type: "system" },
    };
  }

  /** The fixture metadata with `dtd` before its root and `ref` in its NameIDFormat. */
  function hostileMetadata(dtd: string, ref: string): string {
    return METADATA.replace("<md:EntityDescriptor", `${dtd}<md:EntityDescriptor`).replace(
      "<md:NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:transient",
      `<md:NameIDFormat>${ref}`,
    );
  }

  it.each(Object.keys(hostileDtds("http://x", "file:///x")))(
    "refuses pasted metadata with %s and reads no file or URL",
    async (name) => {
      const payload = hostileDtds(targetOrigin(), fileUrl)[name];
      if (!payload) throw new Error(`no payload ${name}`);
      const metadataXml = hostileMetadata(payload.dtd, payload.ref);
      expect(await createProvider(context([]), samlInput("pasted", { metadataXml }))).toEqual({
        ok: false,
        error: "metadata_invalid",
      });
      expect(target?.hits).toEqual([]);
    },
  );

  it.each(Object.keys(hostileDtds("http://x", "file:///x")))(
    "refuses fetched metadata with %s and fetches nothing but the metadata",
    async (name) => {
      const payload = hostileDtds(targetOrigin(), fileUrl)[name];
      if (!payload) throw new Error(`no payload ${name}`);
      const xml = hostileMetadata(payload.dtd, payload.ref);
      await close(metadataHost);
      metadataHost = await listen((path) => (path === "/metadata" ? xml : null));
      const input = samlInput("fetched", { metadataUrl: `${metadataHost.origin}/metadata` });
      expect(await createProvider(context([metadataHost.origin]), input)).toEqual({
        ok: false,
        error: "metadata_invalid",
      });
      expect(metadataHost.hits).toEqual(["/metadata"]);
      expect(target?.hits).toEqual([]);
    },
  );

  it("stores nothing for a refused provider", async () => {
    const rows = await db.selectFrom("identity_provider").select("provider_id").execute();
    expect(rows).toEqual([]);
  });
});

/** The create input of a SAML provider with metadata pasted or fetched. */
function samlInput(
  providerId: string,
  saml: { metadataXml?: string; metadataUrl?: string },
): Parameters<typeof createProvider>[1] {
  return {
    providerId,
    protocol: "saml",
    settings: {
      labelEn: providerId,
      labelNl: providerId,
      icon: "school",
      sortOrder: 0,
      roleClaim: "Role",
      roleMap: [],
      defaultRole: null,
      emailAuthoritative: false,
      domains: [],
    },
    saml: {
      metadataXml: saml.metadataXml ?? "",
      metadataUrl: saml.metadataUrl ?? "",
      spPrivateKey: "",
    },
  };
}
