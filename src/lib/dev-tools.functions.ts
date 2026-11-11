// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions callable from beforeLoad on both sides; bodies run on the server.
import { createServerFn } from "@tanstack/react-start";
import { devPagesEnabled } from "@/server/dev-tools";

/**
 * Whether the development pages (`/dev/*`) are served, read from the server's `NODE_ENV` at
 * request time, so the production build that the e2e suite runs with `NODE_ENV=test` serves
 * them and a production deployment does not. The pages read no data and need no session.
 */
export const getDevPagesEnabled = createServerFn({ method: "GET" }).handler(() =>
  devPagesEnabled(process.env),
);
