// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

/** A complete, valid environment for unit tests; override single keys per test. */
export const VALID_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://edulims:edulims@localhost:5432/edulims",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
  BETTER_AUTH_URL: "http://localhost:3000",
  // A public test-only key: 32 bytes, base64 ("edulims-test-data-key-0123456789").
  EDULIMS_DATA_KEY: "ZWR1bGltcy10ZXN0LWRhdGEta2V5LTAxMjM0NTY3ODk=",
  EDULIMS_IDP_PRIVATE_ORIGINS: "http://localhost:8180",
  FERROEHR_BASE_URL: "http://localhost:4001",
  FERROEHR_TOKEN_URL: "http://localhost:4003/token",
  FERROEHR_CLIENT_ID: "edulims-ferroehr",
  FERROEHR_CLIENT_SECRET: "test-only-ferroehr-client-secret",
  FERROEHR_SCOPE: "system/template-*.cr",
  FERROBRIDGE_BASE_URL: "http://localhost:4002",
  EDULIMS_DEV_LOGIN: "true",
} as const satisfies Record<string, string>;
