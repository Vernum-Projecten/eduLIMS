// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The server's one openEHR client, created on first use from the validated configuration.
import "@tanstack/react-start/server-only";
import { type Env, getEnv } from "../env.ts";
import { createOpenEhrClient, type OpenEhrClient } from "./client.ts";

/** Returns the client configuration from the FerroEHR settings of the environment. */
export function openEhrConfig(
  env: Pick<
    Env,
    | "FERROEHR_BASE_URL"
    | "FERROEHR_TOKEN_URL"
    | "FERROEHR_CLIENT_ID"
    | "FERROEHR_CLIENT_SECRET"
    | "FERROEHR_SCOPE"
  >,
) {
  return {
    baseUrl: new URL(env.FERROEHR_BASE_URL),
    tokenUrl: new URL(env.FERROEHR_TOKEN_URL),
    clientId: env.FERROEHR_CLIENT_ID,
    clientSecret: env.FERROEHR_CLIENT_SECRET,
    scope: env.FERROEHR_SCOPE,
  };
}

let client: OpenEhrClient | undefined;

/**
 * Returns the server's openEHR client, created once with the global `fetch`.
 *
 * @throws EnvConfigError when a FerroEHR setting (or any other) is missing or invalid.
 */
export function getOpenEhrClient(): OpenEhrClient {
  client ??= createOpenEhrClient(openEhrConfig(getEnv()), {
    fetch: (url, init) => fetch(url, init),
    nowMs: () => Date.now(),
  });
  return client;
}

export type {
  OpenEhrClient,
  OpenEhrClientConfig,
  TemplateDocument,
  TemplateFormat,
  TemplateUpload,
} from "./client.ts";
export { createOpenEhrClient, DEFAULT_TIMEOUT_MS } from "./client.ts";
export type { OpenEhrError, OpenEhrResult, OpenEhrTarget } from "./errors.ts";
export { describeOpenEhrError } from "./errors.ts";
