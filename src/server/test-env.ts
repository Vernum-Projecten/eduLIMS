// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/** A complete, valid environment for unit tests; override single keys per test. */
export const VALID_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://edulims:edulims@localhost:5432/edulims",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
  BETTER_AUTH_URL: "http://localhost:3000",
  MICROSOFT_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
  MICROSOFT_CLIENT_SECRET: "test-client-secret",
  MICROSOFT_TENANT_ID: "00000000-0000-0000-0000-000000000002",
  FERROEHR_BASE_URL: "http://localhost:4001",
  FERROBRIDGE_BASE_URL: "http://localhost:4002",
  EDULIMS_DEV_LOGIN: "true",
} as const satisfies Record<string, string>;
