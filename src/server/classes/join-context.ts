// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// What the join-code server functions need from the request and the environment (#49): the
// client IP as better-auth resolves it, with the operator's trusted proxies, and the one hasher.
import "@tanstack/react-start/server-only";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { getIP } from "better-auth/api";
import { getAuth } from "../auth.ts";
import { getEnv } from "../env.ts";
import type { JoinContext } from "./join.ts";
import { type JoinCodeHasher, joinCodeHasher } from "./join-code.ts";
import { joinFailureLimiter } from "./join-limits.ts";

let hasher: JoinCodeHasher | undefined;

/** Returns the hasher of join codes under this server's better-auth secret. */
export function serverJoinCodeHasher(): JoinCodeHasher {
  hasher ??= joinCodeHasher(getEnv().BETTER_AUTH_SECRET);
  return hasher;
}

/**
 * Returns the join context of the current request: better-auth's client IP
 * (`advanced.ipAddress`, with `EDULIMS_TRUSTED_PROXIES`), the hasher and the process limiter.
 */
export function requestJoinContext(now: Date): JoinContext {
  return {
    now,
    clientIp: getIP(getRequestHeaders(), getAuth().options),
    hash: serverJoinCodeHasher(),
    limiter: joinFailureLimiter,
  };
}
