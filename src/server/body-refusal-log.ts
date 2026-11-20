// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The log line of a refused request body (ASVS V16.2.5, V16.3.3; #347, #292, #350): one line per
// client and reason in a minute, with the number of refusals it stands for, so a flood of
// oversized bodies cannot fill the log. The client is the address behind the trusted proxies.
import { toRequestId } from "./audit/events.ts";
import { clientIpOf } from "./client-ip.ts";
import { getEnv } from "./env.ts";
import { RefusalDeduper } from "./refusal-deduper.ts";
import { logSecurityEvent } from "./security-log.ts";

/** One refusal of a request body, in the codes the security log takes. */
export interface BodyRefusal {
  readonly reason: string;
  readonly status: 411 | 413;
  /** The route family of a server route refusal. */
  readonly kind?: string;
}

/** What the refusal log reads besides the request: the trusted proxies and its window. */
export interface BodyRefusalLogDeps {
  readonly trustedProxies: () => readonly string[];
  readonly deduper: RefusalDeduper;
}

let deps: BodyRefusalLogDeps = {
  trustedProxies: () => getEnv().EDULIMS_TRUSTED_PROXIES,
  deduper: new RefusalDeduper(),
};

/** Replaces what the refusal log reads and returns a function that restores it (tests). */
export function setBodyRefusalLogDeps(next: BodyRefusalLogDeps): () => void {
  const previous = deps;
  deps = next;
  return () => {
    deps = previous;
  };
}

/**
 * Logs `refusal` of the body of `request` as `input_validation_fail`, unless the same client had
 * the same refusal logged within the window; the line written carries `refused_count`, the
 * refusals it stands for. A request middleware runs before any session, so no user is known.
 */
export function logBodyRefusal(request: Request, refusal: BodyRefusal, now = Date.now()): void {
  const client = clientIpOf(request.headers, deps.trustedProxies()) ?? "unknown";
  const count = deps.deduper.next(`${client}|${refusal.reason}`, now);
  if (count === null) return;
  logSecurityEvent("warn", "input_validation_fail", {
    outcome: "refused",
    reason: refusal.reason,
    kind: refusal.kind,
    status: refusal.status,
    refused_count: count,
    request_id: toRequestId(request.headers.get("x-request-id")),
  });
}
