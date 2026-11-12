// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The activity log of the SCIM endpoint (#45; B4, ASVS V16.3.1, V16.3.2): every write, every
// refused token (401: `scim_token_refused` with why) and every refused read or write of a
// resource (403, 404: another provider's user is a 404). Ids and codes only. A burst of the
// same refused token is logged once per window. Relative imports: `pnpm db:seed` loads auth.ts.
import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { isAPIError } from "better-auth/api";
import type { Kysely } from "kysely";
import { requestIdOf } from "../audit/better-auth-hooks.ts";
import { type AuditEvent, auditProvider, toReasonCode } from "../audit/events.ts";
import { recordCommittedAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import { bearerOf } from "./limits.ts";
import { inspectScimToken } from "./verify.ts";

const USER_ACTIONS = [
  "scim_user_created",
  "scim_user_updated",
  "scim_user_deleted",
  "scim_user_read",
] as const;
const GROUP_ACTIONS = [
  "scim_group_created",
  "scim_group_updated",
  "scim_group_deleted",
  "scim_group_read",
] as const;
type UserAction = (typeof USER_ACTIONS)[number];
type GroupAction = (typeof GROUP_ACTIONS)[number];
/** An activity-log action about one SCIM resource. */
export type ScimResourceAction = UserAction | GroupAction;

function isUserAction(action: ScimResourceAction): action is UserAction {
  return (USER_ACTIONS as readonly string[]).includes(action);
}

/** Returns the action of a SCIM request on Users or Groups, a read included; else `null`. */
export function scimResourceAction(method: string, path: string): ScimResourceAction | null {
  const users = path.startsWith("/scim/v2/Users");
  if (!users && !path.startsWith("/scim/v2/Groups")) return null;
  const actions: readonly ScimResourceAction[] = users ? USER_ACTIONS : GROUP_ACTIONS;
  if (method === "POST") return actions[0] ?? null;
  if (method === "PUT" || method === "PATCH") return actions[1] ?? null;
  if (method === "DELETE") return actions[2] ?? null;
  if (method === "GET" || method === "HEAD") return actions[3] ?? null;
  return null;
}

type EventBase = Pick<AuditEvent, "actor" | "outcome" | "provider" | "requestId" | "reason">;

/** Builds the event of one SCIM request, with the SCIM resource as its target when known. */
export function scimResourceEvent(
  action: ScimResourceAction,
  base: EventBase,
  resourceId: string | undefined,
): AuditEvent {
  if (isUserAction(action)) {
    return {
      ...base,
      action,
      ...(resourceId ? { target: { type: "scim_user", id: resourceId } } : {}),
    };
  }
  return {
    ...base,
    action,
    ...(resourceId ? { target: { type: "scim_group", id: resourceId } } : {}),
  };
}

/** Remembers which refused tokens were logged in the current window (L2), bounded. */
export class RefusalDeduper {
  readonly #windowMs: number;
  readonly #maxKeys: number;
  #seen = new Map<string, { at: number; suppressed: number }>();

  constructor(windowMs = 60_000, maxKeys = 10_000) {
    this.#windowMs = windowMs;
    this.#maxKeys = maxKeys;
  }

  /**
   * Returns how many refusals of `key` the row logged now stands for (this one and those left
   * out since the last row), or `null` when `key` was logged within the window.
   */
  next(key: string, now: number = Date.now()): number | null {
    const seen = this.#seen.get(key);
    if (seen !== undefined && now - seen.at < this.#windowMs) {
      seen.suppressed += 1;
      return null;
    }
    if (seen === undefined && this.#seen.size >= this.#maxKeys) {
      for (const [key, entry] of this.#seen) {
        if (now - entry.at >= this.#windowMs) this.#seen.delete(key);
      }
      // NOTE: #45 (L2); when every slot is live the oldest goes, so logging never stops.
      if (this.#seen.size >= this.#maxKeys) {
        const oldest = this.#seen.keys().next();
        if (!oldest.done) this.#seen.delete(oldest.value);
      }
    }
    this.#seen.set(key, { at: now, suppressed: 0 });
    return 1 + (seen?.suppressed ?? 0);
  }

  /** Returns whether `key` should be logged at `now`: once per window. */
  first(key: string, now: number = Date.now()): boolean {
    return this.next(key, now) !== null;
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Returns the dedupe key of a refused token: a digest of it, never the token. */
function tokenKey(token: string | null): string {
  return token === null ? "missing" : createHash("sha256").update(token).digest("hex");
}

/**
 * Writes the activity-log row of one SCIM request from better-auth's after-hook context: a
 * 401 is `scim_token_refused` with the reason (deduplicated per token per window), a 403 or
 * 404 a refused resource action, another error a failure, and a successful write a success.
 * A successful read is not logged.
 */
export async function auditScimRequest(
  db: Kysely<DB>,
  ctx: unknown,
  deduper: RefusalDeduper,
  clientKeyOf: (headers: Headers) => string,
): Promise<void> {
  const path = text(field(ctx, "path")) ?? "";
  const request = field(ctx, "request");
  const method = text(field(ctx, "method")) ?? text(field(request, "method")) ?? "GET";
  const headers = field(ctx, "headers");
  const token = headers instanceof Headers ? bearerOf(headers) : null;
  const returned = field(field(ctx, "context"), "returned");
  const status = isAPIError(returned) ? (returned.statusCode ?? 500) : 200;
  const requestId = requestIdOf(ctx);
  const withRequest = requestId ? { requestId } : {};
  if (status === 401) {
    const inspected = await inspectScimToken(db, token);
    const reason = inspected.ok ? "token_refused" : inspected.reason;
    // NOTE: #45 (finding 3); unknown and missing tokens collapse per client and reason, so a
    // flood of random tokens is one row per window, with how many it stands for.
    const anonymous = reason === "token_unknown" || reason === "token_missing";
    const clientKey = headers instanceof Headers ? clientKeyOf(headers) : "ip:unknown";
    const count = deduper.next(`${anonymous ? clientKey : tokenKey(token)}|${reason}`);
    if (count === null) return;
    const providerId = inspected.providerId;
    const provider = auditProvider(providerId);
    await recordCommittedAudit(db, {
      action: "scim_token_refused",
      actor: { type: "anonymous" },
      outcome: "refused",
      reason,
      ...(providerId ? { target: { type: "identity_provider", id: providerId } } : {}),
      ...(provider ? { provider } : {}),
      metadata: { ...(providerId ? { provider_id: providerId } : {}), refused_count: count },
      ...withRequest,
    });
    return;
  }
  const action = scimResourceAction(method, path);
  if (!action) return;
  const read = action === "scim_user_read" || action === "scim_group_read";
  if (status < 400 && read) return;
  const inspected = await inspectScimToken(db, token);
  const provider = auditProvider(inspected.providerId);
  const params = field(ctx, "params");
  const resourceId =
    text(field(params, "userId")) ?? text(field(params, "groupId")) ?? text(field(returned, "id"));
  const known = { ...(provider ? { provider } : {}), ...withRequest };
  if (status >= 400) {
    const body = isAPIError(returned) ? returned.body : undefined;
    const reason = toReasonCode(field(body, "scimType")) ?? toReasonCode(`http_${status}`);
    // A 404 is what a token gets for another provider's resource (A01), so it is a refusal.
    const refused = status === 403 || status === 404;
    const base: EventBase = {
      actor: { type: "system" },
      outcome: refused ? "refused" : "failure",
      ...known,
      ...(reason ? { reason } : {}),
    };
    await recordCommittedAudit(db, scimResourceEvent(action, base, resourceId));
    return;
  }
  const base: EventBase = { actor: { type: "system" }, outcome: "success", ...known };
  await recordCommittedAudit(db, scimResourceEvent(action, base, resourceId));
}
