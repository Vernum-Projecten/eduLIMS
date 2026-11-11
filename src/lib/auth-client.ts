// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { ssoClient } from "@better-auth/sso/client";
import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { accessControl, roles } from "./roles";

/** Browser auth client; talks to /api/auth on the same origin. */
export const authClient = createAuthClient({
  plugins: [adminClient({ ac: accessControl, roles }), ssoClient()],
});
