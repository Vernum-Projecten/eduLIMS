// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The server's one openEHR client, created on first use from the validated configuration.
import "@tanstack/react-start/server-only";
import { type Env, getEnv } from "../env.ts";
import { createOpenEhrClient, type OpenEhrClient } from "./client.ts";
import type { LabResultWriteSettings } from "./lab-result-writer.ts";

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

/** Returns the settings of a result write from the environment: facility, territory, committer. */
export function labResultWriteSettings(
  env: Pick<
    Env,
    | "FERROEHR_CLIENT_ID"
    | "FERROEHR_FACILITY_ISSUER"
    | "FERROEHR_FACILITY_ID"
    | "FERROEHR_TERRITORY"
  >,
): LabResultWriteSettings {
  return {
    facility: { issuer: env.FERROEHR_FACILITY_ISSUER, id: env.FERROEHR_FACILITY_ID },
    territory: env.FERROEHR_TERRITORY,
    committerName: env.FERROEHR_CLIENT_ID,
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
  CreateContributionOutcome,
  OpenEhrClient,
  OpenEhrClientConfig,
  TemplateDocument,
  TemplateFormat,
} from "./client.ts";
export { createOpenEhrClient, DEFAULT_TIMEOUT_MS } from "./client.ts";
export type { OpenEhrError, OpenEhrResult, OpenEhrTarget } from "./errors.ts";
export { describeOpenEhrError } from "./errors.ts";
