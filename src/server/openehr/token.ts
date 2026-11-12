// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// eduLIMS's FerroEHR identity: an OAuth2 client credentials grant (RFC 6749 §4.4) at the
// configured token endpoint. FerroEHR is a resource server and issues no tokens (FerroEHR book
// v5.7.0, `smart-app-launch.md`); a machine holds `system/` scopes only through this grant
// (`installation/config-auth.md`, "The Basic-auth user store").
import "@tanstack/react-start/server-only";
import { z } from "zod";
import { readCapped } from "../read-capped.ts";
import { failure, type OpenEhrResult, oauthErrorCode, requestFailure, success } from "./errors.ts";

/** The `fetch` the client uses; a test passes a stub. */
export type HttpFetch = (url: URL, init: RequestInit) => Promise<Response>;

/** The client credentials of eduLIMS at the token endpoint. */
export interface TokenConfig {
  tokenUrl: URL;
  clientId: string;
  clientSecret: string;
  /** The space-separated scopes to ask for (RFC 6749 §3.3). */
  scope: string;
  timeoutMs: number;
}

/** What the token source runs with: the HTTP client and a millisecond wall clock. */
export interface TokenDeps {
  fetch: HttpFetch;
  nowMs: () => number;
}

/** A source of access tokens, cached until shortly before they expire. */
export interface TokenSource {
  /** Returns a valid access token, from the cache or a new grant. */
  token(): Promise<OpenEhrResult<string>>;
  /** Drops `token` from the cache (after FerroEHR refused it), so the next call fetches anew. */
  invalidate(token: string): void;
}

// NOTE: no openEHR spec governs this: our own design. A token is refetched 30 s before it
// expires, so a call never starts with a token that runs out on the way.
export const TOKEN_REFRESH_MARGIN_MS = 30_000;

// NOTE: no openEHR spec governs this: our own design; a token answer is a small JSON object.
export const TOKEN_BODY_LIMIT_BYTES = 64 * 1024;

/** RFC 6749 §5.1: the successful access token response. */
const tokenResponse = z.object({
  access_token: z.string().min(1),
  // RFC 6749 §5.1 and §7.1: `token_type` is case-insensitive; FerroEHR takes Bearer only.
  token_type: z.string().refine((type) => type.toLowerCase() === "bearer"),
  expires_in: z.number().positive().optional(),
});

/**
 * Returns the `Authorization` header of `client_secret_basic` (RFC 6749 §2.3.1): the id and the
 * secret each form-urlencoded (Appendix B), then joined by a colon and base64-encoded.
 */
export function clientBasicAuth(clientId: string, clientSecret: string): string {
  const encode = (text: string) => new URLSearchParams({ x: text }).toString().slice(2);
  return `Basic ${Buffer.from(`${encode(clientId)}:${encode(clientSecret)}`).toString("base64")}`;
}

/** Creates a {@link TokenSource} for one set of client credentials. */
export function createTokenSource(config: TokenConfig, deps: TokenDeps): TokenSource {
  let cached: { token: string; refreshAtMs: number } | undefined;
  let pending: Promise<OpenEhrResult<string>> | undefined;

  async function grant(): Promise<OpenEhrResult<string>> {
    const target = "token_endpoint";
    let response: Response;
    let body: string | undefined;
    try {
      response = await deps.fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          Authorization: clientBasicAuth(config.clientId, config.clientSecret),
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({ grant_type: "client_credentials", scope: config.scope }),
        redirect: "manual",
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      body = await readCapped(response, TOKEN_BODY_LIMIT_BYTES);
    } catch (error) {
      return failure(requestFailure(target, error));
    }
    const { status } = response;
    const json = parseJson(body);
    if (status === 400 || status === 401) {
      // NOTE: RFC 6749 §5.2: a refused grant answers 400 (401 for a refused client) with an
      // `error` code; `error_description` is free text and is never kept.
      const error = isRecord(json) ? oauthErrorCode(json["error"]) : null;
      return failure({ kind: "auth_refused", target, status, reason: error });
    }
    if (status < 200 || status > 299) {
      const code = isRecord(json) ? oauthErrorCode(json["error"]) : null;
      return failure({ kind: "refused", target, status, code });
    }
    if (body === undefined) {
      return failure({ kind: "invalid_response", target, status, problem: "too_large" });
    }
    const parsed = tokenResponse.safeParse(json);
    if (!parsed.success) {
      const problem = json === undefined ? "not_json" : "unexpected_shape";
      return failure({ kind: "invalid_response", target, status, problem, cause: parsed.error });
    }
    const { access_token: token, expires_in: expiresIn } = parsed.data;
    // NOTE: RFC 6749 §5.1 makes `expires_in` RECOMMENDED; without it the token is used once.
    cached =
      expiresIn === undefined
        ? undefined
        : { token, refreshAtMs: deps.nowMs() + expiresIn * 1000 - TOKEN_REFRESH_MARGIN_MS };
    return success(token);
  }

  return {
    token() {
      if (cached && deps.nowMs() < cached.refreshAtMs)
        return Promise.resolve(success(cached.token));
      cached = undefined;
      // NOTE: no openEHR spec governs this: our own design; concurrent calls share one grant.
      pending ??= grant().finally(() => {
        pending = undefined;
      });
      return pending;
    },
    invalidate(token) {
      if (cached?.token === token) cached = undefined;
    },
  };
}

/** Parses JSON text; `undefined` for no text or text that is not JSON. */
export function parseJson(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // NOTE: a body that does not parse is reported by the caller as `not_json`.
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
