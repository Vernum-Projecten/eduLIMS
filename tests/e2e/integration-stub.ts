// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A stand-in for FerroEHR, its token endpoint and FerroBRIDGE on this run's integration port
// (playwright.config.ts), so the integration status journey can force each state without a live
// service (#227). It listens only while a journey holds it; otherwise nothing answers there.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

/** One stubbed answer: a status, a JSON body and extra headers. */
export interface StubReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** What each endpoint answers, and how long every answer waits. */
export interface StubMode {
  options: StubReply;
  token: StubReply;
  templates: StubReply;
  readiness: StubReply;
  delayMs: number;
}

const template = (id: string) => ({
  template_id: id,
  concept: "Laboratory result",
  archetype_id: "openEHR-EHR-COMPOSITION.report-result.v1",
  created_timestamp: "2026-11-01T00:00:00Z",
});

/** Every check passes: FerroEHR holds the eduLIMS template, FerroBRIDGE is ready. */
export const HEALTHY: StubMode = {
  options: {
    status: 200,
    body: { solution: "FerroEHR", solution_version: "5.7.0", restapi_specs_version: "1.1.0" },
  },
  // No `expires_in`, so the app takes a new token on every check (RFC 6749 §5.1).
  token: { status: 200, body: { access_token: "e2e-stub-token", token_type: "Bearer" } },
  templates: { status: 200, body: [template("other.v1"), template("eduLIMS-lab.v1")] },
  readiness: {
    status: 200,
    body: { state: "up", phase: "serving", indicators: [{ name: "cdr", state: "up" }] },
  },
  delayMs: 0,
};

const ROUTES: Record<string, keyof Omit<StubMode, "delayMs">> = {
  "OPTIONS /ferroehr/rest/openehr/v1": "options",
  "POST /token": "token",
  "GET /ferroehr/rest/openehr/v1/definition/template/adl1.4": "templates",
  "GET /ferrobridge/health/readiness": "readiness",
};

/** A running stub: change its answers with `set`, stop it with `close`. */
export interface IntegrationStub {
  set(mode: Partial<StubMode>): void;
  close(): Promise<void>;
}

function integrationsPort(): number {
  const port = Number(process.env["EDULIMS_E2E_INTEGRATIONS_PORT"]);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("EDULIMS_E2E_INTEGRATIONS_PORT is not set; playwright.config.ts sets it.");
  }
  return port;
}

/** Starts the stub on this run's integration port, answering as {@link HEALTHY}. */
export async function startIntegrationStub(): Promise<IntegrationStub> {
  let mode: StubMode = HEALTHY;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    request.resume();
    const path = new URL(request.url ?? "/", "http://stub.test").pathname;
    const endpoint = ROUTES[`${request.method ?? "GET"} ${path}`];
    const reply: StubReply = endpoint ? mode[endpoint] : { status: 404 };
    setTimeout(() => {
      response.writeHead(reply.status, { "Content-Type": "application/json", ...reply.headers });
      response.end(reply.body === undefined ? "{}" : JSON.stringify(reply.body));
    }, mode.delayMs);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(integrationsPort(), "127.0.0.1", () => resolve());
  });
  return {
    set(change) {
      mode = { ...HEALTHY, ...change };
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
