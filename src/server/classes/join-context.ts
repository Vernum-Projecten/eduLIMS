// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// What the join-code server functions need from the request and the environment (#49): the
// client IP through the operator's trusted proxies, the one key of join codes, and the limits.
import "@tanstack/react-start/server-only";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { clientIpOf } from "../client-ip.ts";
import { getEnv } from "../env.ts";
import type { JoinContext } from "./join.ts";
import { type JoinCodeKey, joinCodeKey } from "./join-code.ts";
import { JOIN_LIMITS } from "./join-limits.ts";

let key: JoinCodeKey | undefined;

/** Returns the key of join codes under this server's better-auth secret. */
export function serverJoinCodeKey(): JoinCodeKey {
  key ??= joinCodeKey(getEnv().BETTER_AUTH_SECRET);
  return key;
}

/**
 * Returns the join context of the current request: the client IP through
 * `EDULIMS_TRUSTED_PROXIES` (none trusted: `null`), the key and the limits.
 */
export function requestJoinContext(now: Date): JoinContext {
  return {
    now,
    clientIp: clientIpOf(getRequestHeaders(), getEnv().EDULIMS_TRUSTED_PROXIES),
    key: serverJoinCodeKey(),
    limits: JOIN_LIMITS,
  };
}
