// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The one typed client for FerroEHR's openEHR REST API (ITS-REST 1.1.0). It is the only code
// that builds a FerroEHR request: every call has a timeout, follows no redirect, reads a capped
// body, validates the answer and returns a typed result. It logs nothing.
import "@tanstack/react-start/server-only";
import type { ZodType } from "zod";
import { readCapped } from "../read-capped.ts";
import {
  bearerChallengeError,
  failure,
  type OpenEhrResult,
  openEhrErrorCode,
  requestFailure,
  success,
} from "./errors.ts";
import {
  type ConformanceManifest,
  conformanceManifest,
  type TemplateMetadata,
  templateIdentifier,
  templateList,
  type WebTemplate,
  webTemplate,
} from "./schemas.ts";
import { createTokenSource, type HttpFetch, parseJson, type TokenSource } from "./token.ts";

/** The configuration of the client: FerroEHR's base URL and eduLIMS's client credentials. */
export interface OpenEhrClientConfig {
  /** The openEHR REST base path, such as `…/ferroehr/rest/openehr/v1`. */
  baseUrl: URL;
  tokenUrl: URL;
  clientId: string;
  clientSecret: string;
  scope: string;
  /** The timeout of each request, the token request included; {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** What the client runs with: the HTTP client and a millisecond wall clock. */
export interface OpenEhrClientDeps {
  fetch: HttpFetch;
  nowMs: () => number;
}

/** The representations of a stored ADL 1.4 template (ITS-REST 1.1.0, `Accept_Template.yaml`). */
export type TemplateFormat = "opt" | "web_template";

/** A template in the representation asked for. */
export type TemplateDocument =
  | { format: "opt"; xml: string }
  | { format: "web_template"; webTemplate: WebTemplate };

/** The outcome of an upload: stored now, or already there (templates are immutable). */
export type TemplateUpload = { outcome: "created"; templateId: string } | { outcome: "exists" };

/** The operations of FerroEHR that eduLIMS uses. */
export interface OpenEhrClient {
  /**
   * Returns the conformance manifest: `OPTIONS` on the base path (ITS-REST 1.1.0, System API,
   * "Options and Conformance"). It sends no credential: the System API declares `security: []`
   * and FerroEHR serves it unauthenticated (FerroEHR book v5.7.0, `security.md`).
   */
  options(call?: { timeoutMs?: number }): Promise<OpenEhrResult<ConformanceManifest>>;
  /** Returns the ADL 1.4 templates, ordered by `template_id` (Definition API, "List templates"). */
  listTemplates(): Promise<OpenEhrResult<readonly TemplateMetadata[]>>;
  /**
   * Returns one ADL 1.4 template as the canonical OPT XML or as the WebTemplate (Definition API,
   * "Get a template"). A missing template is `refused` with status 404.
   *
   * @throws RangeError when `templateId` is empty.
   */
  getTemplate(templateId: string, format: TemplateFormat): Promise<OpenEhrResult<TemplateDocument>>;
  /**
   * Uploads an ADL 1.4 operational template (Definition API, "Upload a template"); a `409` is
   * the typed `exists` outcome, so an upload can be repeated safely.
   */
  uploadTemplate(optXml: string): Promise<OpenEhrResult<TemplateUpload>>;
}

// NOTE: no openEHR spec governs this: our own design. Ten seconds per request bounds a hanging
// FerroEHR or token endpoint; callers with a tighter budget (the B3 check) pass their own.
export const DEFAULT_TIMEOUT_MS = 10_000;

// NOTE: no openEHR spec governs these limits: our own design. A manifest and an error are small,
// a list stays well under 1 MiB, and an OPT of the eduLIMS-lab size well under 16 MiB.
export const OPTIONS_BODY_LIMIT_BYTES = 64 * 1024;
export const LIST_BODY_LIMIT_BYTES = 1024 * 1024;
export const TEMPLATE_BODY_LIMIT_BYTES = 16 * 1024 * 1024;

const ADL14_TEMPLATES = "definition/template/adl1.4";

interface Call {
  method: "GET" | "POST" | "OPTIONS";
  /** Relative to the base path; `""` is the base path itself. */
  path: string;
  accept: string;
  authenticated: boolean;
  bodyLimit: number;
  timeoutMs?: number | undefined;
  body?: string;
  headers?: Record<string, string>;
  /** Non-success statuses the caller maps itself (the `409` of an upload). */
  pass?: readonly number[];
}

interface Answer {
  status: number;
  body: string | undefined;
  /** The `WWW-Authenticate` header (RFC 6750 §3), read for a 401 or 403. */
  challenge: string | null;
}

/** Creates the client; {@link getOpenEhrClient} holds the one the server uses. */
export function createOpenEhrClient(
  config: OpenEhrClientConfig,
  deps: OpenEhrClientDeps,
): OpenEhrClient {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = config.baseUrl.href.endsWith("/") ? config.baseUrl.href : `${config.baseUrl.href}/`;
  const tokens: TokenSource = createTokenSource(
    {
      tokenUrl: config.tokenUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      scope: config.scope,
      timeoutMs,
    },
    deps,
  );

  async function attempt(call: Call, token: string | undefined): Promise<OpenEhrResult<Answer>> {
    const url = call.path === "" ? new URL(config.baseUrl.href) : new URL(call.path, base);
    const headers: Record<string, string> = { Accept: call.accept, ...call.headers };
    if (token !== undefined) headers["Authorization"] = `Bearer ${token}`;
    try {
      const response = await deps.fetch(url, {
        method: call.method,
        headers,
        ...(call.body === undefined ? {} : { body: call.body }),
        redirect: "manual",
        signal: AbortSignal.timeout(call.timeoutMs ?? timeoutMs),
      });
      const body = await readCapped(response, call.bodyLimit);
      const challenge = response.headers.get("WWW-Authenticate");
      return success({ status: response.status, body, challenge });
    } catch (error) {
      return failure(requestFailure("ferroehr", error));
    }
  }

  async function send(call: Call): Promise<OpenEhrResult<Answer>> {
    let token: string | undefined;
    if (call.authenticated) {
      const granted = await tokens.token();
      if (!granted.ok) return granted;
      token = granted.value;
    }
    let sent = await attempt(call, token);
    if (sent.ok && sent.value.status === 401 && token !== undefined) {
      // NOTE: RFC 6750 §3.1 `invalid_token`: a token revoked or expired early is dropped and
      // the call is repeated once with a new one; a second 401 is the refusal.
      tokens.invalidate(token);
      const regranted = await tokens.token();
      if (!regranted.ok) return regranted;
      sent = await attempt(call, regranted.value);
    }
    if (!sent.ok) return sent;
    return classify(sent.value, call);
  }

  return {
    async options(call) {
      const sent = await send({
        method: "OPTIONS",
        path: "",
        accept: "application/json",
        authenticated: false,
        bodyLimit: OPTIONS_BODY_LIMIT_BYTES,
        timeoutMs: call?.timeoutMs,
      });
      return sent.ok ? parseBody(sent.value, conformanceManifest) : sent;
    },

    async listTemplates() {
      const sent = await send({
        method: "GET",
        path: ADL14_TEMPLATES,
        accept: "application/json",
        authenticated: true,
        bodyLimit: LIST_BODY_LIMIT_BYTES,
      });
      if (!sent.ok) return sent;
      const parsed = parseBody(sent.value, templateList);
      if (!parsed.ok) return parsed;
      // NOTE: ITS-REST 1.1.0 defines no order for the list; this one keeps screens stable.
      const sorted = parsed.value.toSorted((a, b) =>
        a.template_id < b.template_id ? -1 : a.template_id > b.template_id ? 1 : 0,
      );
      return success(sorted);
    },

    async getTemplate(templateId, format) {
      if (templateId.trim() === "") throw new RangeError("a template id must not be empty");
      const sent = await send({
        method: "GET",
        path: `${ADL14_TEMPLATES}/${encodeURIComponent(templateId)}`,
        accept: format === "opt" ? "application/xml" : "application/openehr.wt+json",
        authenticated: true,
        bodyLimit: TEMPLATE_BODY_LIMIT_BYTES,
      });
      if (!sent.ok) return sent;
      if (format === "web_template") {
        const parsed = parseBody(sent.value, webTemplate);
        return parsed.ok ? success({ format, webTemplate: parsed.value }) : parsed;
      }
      const xml = sent.value.body ?? "";
      if (!xml.trimStart().startsWith("<")) {
        return failure({
          kind: "invalid_response",
          target: "ferroehr",
          status: sent.value.status,
          problem: "unexpected_shape",
        });
      }
      return success({ format, xml });
    },

    async uploadTemplate(optXml) {
      const sent = await send({
        method: "POST",
        path: ADL14_TEMPLATES,
        accept: "application/json",
        authenticated: true,
        bodyLimit: OPTIONS_BODY_LIMIT_BYTES,
        body: optXml,
        // NOTE: ITS-REST 1.1.0 `201_Template_adl1_4_upload.yaml`: `return=identifier` answers
        // the TemplateIdentifier as JSON.
        headers: { "Content-Type": "application/xml", Prefer: "return=identifier" },
        pass: [409],
      });
      if (!sent.ok) return sent;
      // NOTE: ITS-REST 1.1.0 `409_template_already_exists.yaml`; templates are immutable.
      if (sent.value.status === 409) return success({ outcome: "exists" });
      const parsed = parseBody(sent.value, templateIdentifier);
      return parsed.ok
        ? success({ outcome: "created", templateId: parsed.value.template_id })
        : parsed;
    },
  };
}

/** Maps a non-success answer to its typed error; a success (or a passed status) goes on. */
function classify(answer: Answer, call: Call): OpenEhrResult<Answer> {
  const { status, body } = answer;
  if ((status >= 200 && status <= 299) || call.pass?.includes(status)) {
    if (body === undefined) {
      return failure({
        kind: "invalid_response",
        target: "ferroehr",
        status,
        problem: "too_large",
      });
    }
    return success(answer);
  }
  const code = openEhrErrorCode(body);
  if (status === 401 || status === 403) {
    // NOTE: FerroEHR book v5.7.0, `using-the-api/index.md`, "Which status a credential problem
    // gets": the challenge's `error` names the refusal, the problem type names it otherwise.
    const challenge = bearerChallengeError(answer.challenge);
    return failure({ kind: "auth_refused", target: "ferroehr", status, reason: challenge ?? code });
  }
  return failure({ kind: "refused", target: "ferroehr", status, code });
}

/** Parses a JSON body with `schema`, mapping a failure to `invalid_response`. */
function parseBody<T>(answer: Answer, schema: ZodType<T>): OpenEhrResult<T> {
  const json = parseJson(answer.body);
  const parsed = schema.safeParse(json);
  if (parsed.success) return success(parsed.data);
  return failure({
    kind: "invalid_response",
    target: "ferroehr",
    status: answer.status,
    problem: json === undefined ? "not_json" : "unexpected_shape",
    cause: parsed.error,
  });
}
