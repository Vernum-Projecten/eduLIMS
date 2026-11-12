// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The client credentials grant (RFC 6749 §4.4), with the token endpoint stubbed at the HTTP layer.
import { describe, expect, it, vi } from "vitest";
import {
  clientBasicAuth,
  createTokenSource,
  type HttpFetch,
  TOKEN_BODY_LIMIT_BYTES,
  TOKEN_REFRESH_MARGIN_MS,
  type TokenConfig,
} from "./token.ts";

const CONFIG: TokenConfig = {
  tokenUrl: new URL("http://idp.test/token"),
  clientId: "edulims-ferroehr",
  clientSecret: "test-only-client-secret-0123456789",
  scope: "system/template-*.cr",
  timeoutMs: 1_000,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function grants(...tokens: string[]) {
  const queue = [...tokens];
  return vi.fn<HttpFetch>(() =>
    Promise.resolve(
      json({ access_token: queue.shift() ?? "t-last", token_type: "Bearer", expires_in: 300 }),
    ),
  );
}

describe("createTokenSource (RFC 6749 §4.4)", () => {
  it("posts the client credentials grant with client_secret_basic and the scope", async () => {
    const fetch = grants("t1");
    const source = createTokenSource(CONFIG, { fetch, nowMs: () => 0 });
    expect(await source.token()).toEqual({ ok: true, value: "t1" });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url?.href).toBe("http://idp.test/token");
    expect(init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init?.headers);
    expect(headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
    expect(headers.get("Authorization")).toBe(
      clientBasicAuth(CONFIG.clientId, CONFIG.clientSecret),
    );
    const body = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "client_credentials",
      scope: "system/template-*.cr",
    });
  });

  it("form-urlencodes the id and secret before base64 (RFC 6749 §2.3.1)", () => {
    const header = clientBasicAuth("a b", "c:d&e");
    const decoded = Buffer.from(header.replace("Basic ", ""), "base64").toString();
    expect(decoded).toBe("a+b:c%3Ad%26e");
  });

  it("caches the token until the refresh margin before it expires", async () => {
    let now = 0;
    const fetch = grants("t1", "t2");
    const source = createTokenSource(CONFIG, { fetch, nowMs: () => now });
    await source.token();
    now = 300_000 - TOKEN_REFRESH_MARGIN_MS - 1;
    expect(await source.token()).toEqual({ ok: true, value: "t1" });
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 1;
    expect(await source.token()).toEqual({ ok: true, value: "t2" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("shares one grant between concurrent callers", async () => {
    const fetch = grants("t1");
    const source = createTokenSource(CONFIG, { fetch, nowMs: () => 0 });
    const [a, b] = await Promise.all([source.token(), source.token()]);
    expect([a, b]).toEqual([
      { ok: true, value: "t1" },
      { ok: true, value: "t1" },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("drops an invalidated token, and only that one", async () => {
    const fetch = grants("t1", "t2");
    const source = createTokenSource(CONFIG, { fetch, nowMs: () => 0 });
    await source.token();
    source.invalidate("other");
    expect(await source.token()).toEqual({ ok: true, value: "t1" });
    source.invalidate("t1");
    expect(await source.token()).toEqual({ ok: true, value: "t2" });
  });

  it("uses a token without expires_in once (RFC 6749 §5.1)", async () => {
    const fetch = vi.fn<HttpFetch>(() =>
      Promise.resolve(json({ access_token: "t", token_type: "bearer" })),
    );
    const source = createTokenSource(CONFIG, { fetch, nowMs: () => 0 });
    await source.token();
    await source.token();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [400, "invalid_scope"],
    [401, "invalid_client"],
  ])(
    "reports a %i as refused authentication with its error code (RFC 6749 §5.2)",
    async (status, error) => {
      const fetch: HttpFetch = () =>
        Promise.resolve(json({ error, error_description: "free text about the client" }, status));
      const result = await createTokenSource(CONFIG, { fetch, nowMs: () => 0 }).token();
      expect(result).toEqual({
        ok: false,
        error: { kind: "auth_refused", target: "token_endpoint", status, reason: error },
      });
    },
  );

  it("drops an error code outside the RFC 6749 §5.2 character set", async () => {
    const fetch: HttpFetch = () => Promise.resolve(json({ error: 'bad"code\\' }, 400));
    const result = await createTokenSource(CONFIG, { fetch, nowMs: () => 0 }).token();
    expect(result).toMatchObject({ ok: false, error: { kind: "auth_refused", reason: null } });
  });

  it("reports another status as refused by the token endpoint", async () => {
    const fetch: HttpFetch = () => Promise.resolve(new Response("down", { status: 503 }));
    const result = await createTokenSource(CONFIG, { fetch, nowMs: () => 0 }).token();
    expect(result).toEqual({
      ok: false,
      error: { kind: "refused", target: "token_endpoint", status: 503, code: null },
    });
  });

  it.each([
    ["not JSON", "<html></html>", "not_json"],
    ["no access_token", JSON.stringify({ token_type: "Bearer" }), "unexpected_shape"],
    [
      "a token type other than Bearer",
      JSON.stringify({ access_token: "t", token_type: "mac" }),
      "unexpected_shape",
    ],
    ["too large", "x".repeat(TOKEN_BODY_LIMIT_BYTES + 1), "too_large"],
  ])("reports an answer with %s as invalid", async (_name, body, problem) => {
    const fetch: HttpFetch = () => Promise.resolve(new Response(body, { status: 200 }));
    const result = await createTokenSource(CONFIG, { fetch, nowMs: () => 0 }).token();
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "invalid_response", target: "token_endpoint", status: 200, problem },
    });
  });

  it("reports an unreachable endpoint and a timeout", async () => {
    const down: HttpFetch = () => Promise.reject(new TypeError("fetch failed"));
    const slow: HttpFetch = () => Promise.reject(new DOMException("late", "TimeoutError"));
    expect(await createTokenSource(CONFIG, { fetch: down, nowMs: () => 0 }).token()).toMatchObject({
      ok: false,
      error: { kind: "unreachable", target: "token_endpoint" },
    });
    expect(await createTokenSource(CONFIG, { fetch: slow, nowMs: () => 0 }).token()).toMatchObject({
      ok: false,
      error: { kind: "timeout", target: "token_endpoint" },
    });
  });

  it("does not cache a failed grant", async () => {
    let fail = true;
    const fetch = vi.fn<HttpFetch>(() =>
      Promise.resolve(
        fail
          ? json({ error: "invalid_client" }, 401)
          : json({ access_token: "t", token_type: "Bearer", expires_in: 300 }),
      ),
    );
    const source = createTokenSource(CONFIG, { fetch, nowMs: () => 0 });
    expect((await source.token()).ok).toBe(false);
    fail = false;
    expect(await source.token()).toEqual({ ok: true, value: "t" });
  });
});
