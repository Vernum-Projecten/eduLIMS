// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions callable from loaders/beforeLoad on both sides; bodies run on the server.
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { getEnv } from "@/server/env";
import { getSessionUser } from "@/server/session";

/** The signed-in user (id, name, email, roles) or `null`. */
export const getSession = createServerFn({ method: "GET" }).handler(() =>
  getSessionUser(getRequestHeaders()),
);

/** Which sign-in methods the login page may offer. */
export const getLoginOptions = createServerFn({ method: "GET" }).handler(() => ({
  devLogin: getEnv().EDULIMS_DEV_LOGIN,
}));
