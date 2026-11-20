// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The one typed client for FerroEHR's openEHR REST API (ITS-REST 1.1.0). It is the only code
// that builds a FerroEHR request: every call has a timeout, follows no redirect, reads a capped
// body, validates the answer and returns a typed result. It logs nothing.
import "@tanstack/react-start/server-only";
import { readCapped } from "../read-capped.ts";
import { type Answer, classify, parseBody, unexpectedStatus } from "./answer.ts";
import type { NewContribution } from "./contribution.ts";
import type { EhrStatus, EhrSubjectRef } from "./ehr.ts";
import {
  failure,
  type OpenEhrError,
  type OpenEhrResult,
  requestFailure,
  success,
} from "./errors.ts";
import {
  type CompositionDocument,
  type ConformanceManifest,
  type Contribution,
  compositionDocument,
  conformanceManifest,
  contribution,
  type EhrSummary,
  ehrSummary,
  type TemplateMetadata,
  templateList,
  type WebTemplate,
  webTemplate,
} from "./schemas.ts";
import { createTokenSource, type HttpFetch, type TokenSource } from "./token.ts";

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

/**
 * The outcome of creating an EHR: the new EHR, or `conflict` when an EHR already names the
 * subject (ITS-REST 1.1.0, EHR API, "Create EHR", `409`).
 */
export type CreateEhrOutcome = { outcome: "created"; ehr: EhrSummary } | { outcome: "conflict" };

/**
 * The outcome of committing a CONTRIBUTION: the stored one, or `conflict` on a `409`, which
 * ITS-REST 1.1.0 (`contribution_create.yaml`) gives a supplied `uid` that is already in use.
 */
export type CreateContributionOutcome =
  | { outcome: "created"; contribution: Contribution }
  | { outcome: "conflict" };

/** The operations of FerroEHR that eduLIMS uses. */
export interface OpenEhrClient {
  /**
   * Returns the conformance manifest: `OPTIONS` on the base path (ITS-REST 1.1.0, System API,
   * "Options and Conformance"). It sends no credential: the System API declares `security: []`
   * and FerroEHR serves it unauthenticated (FerroEHR book v5.7.0, `security.md`).
   */
  options(call?: { timeoutMs?: number }): Promise<OpenEhrResult<ConformanceManifest>>;
  /** Returns the ADL 1.4 templates, ordered by `template_id` (Definition API, "List templates"). */
  listTemplates(call?: { timeoutMs?: number }): Promise<OpenEhrResult<readonly TemplateMetadata[]>>;
  /**
   * Returns one ADL 1.4 template as the canonical OPT XML or as the WebTemplate (Definition API,
   * "Get a template"). A missing template is `refused` with status 404.
   *
   * @throws RangeError when `templateId` is empty.
   */
  getTemplate(templateId: string, format: TemplateFormat): Promise<OpenEhrResult<TemplateDocument>>;
  /**
   * Returns the EHR whose `EHR_STATUS.subject.external_ref` names `subject`, or `null` when none
   * does (EHR API, "Get EHR by subject id": `GET /ehr?subject_id=…&subject_namespace=…`, `404`).
   */
  getEhrBySubject(subject: EhrSubjectRef): Promise<OpenEhrResult<EhrSummary | null>>;
  /**
   * Creates an EHR with `status` as its first `EHR_STATUS` (EHR API, "Create EHR": `POST /ehr`).
   * A `409` is the outcome `conflict`, never an error: the caller reads the existing EHR.
   */
  createEhr(status: EhrStatus): Promise<OpenEhrResult<CreateEhrOutcome>>;
  /**
   * Commits a CONTRIBUTION to the EHR `ehrId` (EHR API, "Create CONTRIBUTION":
   * `POST /ehr/{ehr_id}/contribution`). A `409` is the outcome `conflict`, never an error.
   */
  createContribution(
    ehrId: string,
    body: NewContribution,
  ): Promise<OpenEhrResult<CreateContributionOutcome>>;
  /**
   * Returns a CONTRIBUTION of the EHR `ehrId`, or `null` on a `404` (EHR API, "Get
   * CONTRIBUTION": `GET /ehr/{ehr_id}/contribution/{contribution_uid}`).
   */
  getContribution(ehrId: string, uid: string): Promise<OpenEhrResult<Contribution | null>>;
  /**
   * Returns a COMPOSITION of the EHR `ehrId` by a version id or a versioned object id, or
   * `null` on a `404` (EHR API, "Get COMPOSITION": `GET /ehr/{ehr_id}/composition/{uid_based_id}`).
   */
  getComposition(
    ehrId: string,
    uidBasedId: string,
  ): Promise<OpenEhrResult<CompositionDocument | null>>;
}

// NOTE: no openEHR spec governs this: our own design. Ten seconds per request bounds a hanging
// FerroEHR or token endpoint; callers with a tighter budget (the B3 check) pass their own.
export const DEFAULT_TIMEOUT_MS = 10_000;

// NOTE: no openEHR spec governs these limits: our own design. A manifest and an error are small,
// a list stays well under 1 MiB, and an OPT of the eduLIMS-lab size well under 16 MiB.
export const OPTIONS_BODY_LIMIT_BYTES = 64 * 1024;
export const LIST_BODY_LIMIT_BYTES = 1024 * 1024;
export const TEMPLATE_BODY_LIMIT_BYTES = 16 * 1024 * 1024;
// NOTE: no openEHR spec governs this limit: our own design; an EHR summary is under 1 KiB.
export const EHR_BODY_LIMIT_BYTES = 64 * 1024;
// NOTE: no openEHR spec governs these limits: our own design; a contribution of one version is
// under 4 KiB, and one eduLIMS-lab composition under 64 KiB.
export const CONTRIBUTION_BODY_LIMIT_BYTES = 64 * 1024;
export const COMPOSITION_BODY_LIMIT_BYTES = 1024 * 1024;

const ADL14_TEMPLATES = "definition/template/adl1.4";

interface Call {
  method: "GET" | "OPTIONS" | "POST";
  /** Relative to the base path; `""` is the base path itself. */
  path: string;
  /** The query parameters, encoded by `URLSearchParams`. */
  query?: Record<string, string>;
  /** A JSON request body, sent as `application/json`. */
  json?: unknown;
  /** The `Prefer` header (ITS-REST 1.1.0, `return=representation`). */
  prefer?: string;
  accept: string;
  authenticated: boolean;
  bodyLimit: number;
  timeoutMs?: number | undefined;
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
    for (const [name, value] of Object.entries(call.query ?? {})) {
      url.searchParams.set(name, value);
    }
    const headers: Record<string, string> = { Accept: call.accept };
    if (token !== undefined) headers["Authorization"] = `Bearer ${token}`;
    if (call.prefer !== undefined) headers["Prefer"] = call.prefer;
    const payload = call.json === undefined ? undefined : JSON.stringify(call.json);
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    try {
      const response = await deps.fetch(url, {
        method: call.method,
        headers,
        ...(payload === undefined ? {} : { body: payload }),
        redirect: "manual",
        signal: AbortSignal.timeout(call.timeoutMs ?? timeoutMs),
      });
      const body = await readCapped(response, call.bodyLimit);
      const challenge = response.headers.get("WWW-Authenticate");
      const etag = response.headers.get("ETag");
      return success({ status: response.status, body, challenge, etag });
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
    return classify(sent.value);
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

    async listTemplates(call) {
      const sent = await send({
        method: "GET",
        path: ADL14_TEMPLATES,
        accept: "application/json",
        authenticated: true,
        bodyLimit: LIST_BODY_LIMIT_BYTES,
        timeoutMs: call?.timeoutMs,
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

    async getEhrBySubject(subject) {
      const sent = await send({
        method: "GET",
        path: "ehr",
        query: { subject_id: subject.id, subject_namespace: subject.namespace },
        accept: "application/json",
        authenticated: true,
        bodyLimit: EHR_BODY_LIMIT_BYTES,
      });
      if (!sent.ok) {
        const { error } = sent;
        // NOTE: ITS-REST 1.1.0, EHR API, "Get EHR by subject id": 404 means no EHR names it.
        return error.kind === "refused" && error.status === 404 ? success(null) : sent;
      }
      return parseEhr(sent.value);
    },

    async createEhr(status) {
      const sent = await send({
        method: "POST",
        path: "ehr",
        json: status,
        prefer: "return=representation",
        accept: "application/json",
        authenticated: true,
        bodyLimit: EHR_BODY_LIMIT_BYTES,
      });
      if (!sent.ok) {
        const { error } = sent;
        // NOTE: ITS-REST 1.1.0, EHR API, "Create EHR": 409 when an EHR has the same subject id
        // and namespace pair.
        return error.kind === "refused" && error.status === 409
          ? success({ outcome: "conflict" })
          : sent;
      }
      if (sent.value.status !== 201) return unexpectedStatus(sent.value.status);
      const ehr = parseEhr(sent.value);
      return ehr.ok ? success({ outcome: "created", ehr: ehr.value }) : ehr;
    },

    async createContribution(ehrId, body) {
      const sent = await send({
        method: "POST",
        path: `ehr/${encodeURIComponent(ehrId)}/contribution`,
        json: body,
        prefer: "return=representation",
        accept: "application/json",
        authenticated: true,
        bodyLimit: CONTRIBUTION_BODY_LIMIT_BYTES,
      });
      if (!sent.ok) {
        const { error } = sent;
        // NOTE: ITS-REST 1.1.0, `contribution_create.yaml`: a supplied `uid` "will be accepted in
        // case is not in-use, otherwise error will be returned", the `409` of that operation.
        return error.kind === "refused" && error.status === 409
          ? success({ outcome: "conflict" })
          : sent;
      }
      if (sent.value.status !== 201) return unexpectedStatus(sent.value.status);
      const parsed = parseBody(sent.value, contribution);
      return parsed.ok ? success({ outcome: "created", contribution: parsed.value }) : parsed;
    },

    async getContribution(ehrId, uid) {
      const sent = await send({
        method: "GET",
        path: `ehr/${encodeURIComponent(ehrId)}/contribution/${encodeURIComponent(uid)}`,
        accept: "application/json",
        authenticated: true,
        bodyLimit: CONTRIBUTION_BODY_LIMIT_BYTES,
      });
      if (!sent.ok) return notFoundAsNull(sent.error);
      if (sent.value.status !== 200) return unexpectedStatus(sent.value.status);
      return parseBody(sent.value, contribution);
    },

    async getComposition(ehrId, uidBasedId) {
      const sent = await send({
        method: "GET",
        path: `ehr/${encodeURIComponent(ehrId)}/composition/${encodeURIComponent(uidBasedId)}`,
        accept: "application/json",
        authenticated: true,
        bodyLimit: COMPOSITION_BODY_LIMIT_BYTES,
      });
      if (!sent.ok) return notFoundAsNull(sent.error);
      if (sent.value.status !== 200) return unexpectedStatus(sent.value.status);
      return parseBody(sent.value, compositionDocument);
    },
  };
}

/** Parses an EHR summary (ITS-REST 1.1.0, `schemas/ehr/EHR.yaml`) from a `200` or `201`. */
function parseEhr(answer: Answer): OpenEhrResult<EhrSummary> {
  if (answer.status !== 200 && answer.status !== 201) return unexpectedStatus(answer.status);
  return parseBody(answer, ehrSummary);
}

/** Returns `null` for a `404`, which the read operations of the EHR API give an unknown id. */
function notFoundAsNull<T>(error: OpenEhrError): OpenEhrResult<T | null> {
  return error.kind === "refused" && error.status === 404 ? success(null) : failure(error);
}
