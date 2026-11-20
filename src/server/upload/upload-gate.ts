// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The gate in front of the Gen5 upload's server function (ASVS 5.0 V5.2.1, V15.2.2; security
// review of #400, S1). It runs in request middleware, before Start reads the form: only a caller
// with a valid session may send the 5 MiB upload form, and only so many uploads are read at once.
// No server-only marker: src/start.ts imports it, and the Start compiler strips its use from the
// client bundle with the middleware's `.server()` body.
import { logBodyRefusal } from "../body-refusal-log.ts";
import { FORM_BODY_MAX, GEN5_FORM_BODY_MAX, refuseFormBody } from "../form-body-limit.ts";
import { BODY_REFUSAL_HEADERS } from "../json-body-limit.ts";

// NOTE: no requirement governs these: our own design (security review of #400, S1). Two let a
// student retry while one upload is slow; four bound the buffered bodies to about 21 MiB.
/** The most Gen5 upload bodies one user may have in flight at once. */
export const UPLOADS_PER_USER = 2;
/** The most Gen5 upload bodies one server process reads at once. */
export const UPLOADS_IN_FLIGHT = 4;

/** Counts the uploads in flight, per user and in all, and hands out a slot while one is free. */
export class UploadSlots {
  readonly #perUser = new Map<string, number>();
  readonly #userLimit: number;
  readonly #processLimit: number;
  #total = 0;

  constructor(perUser: number = UPLOADS_PER_USER, inFlight: number = UPLOADS_IN_FLIGHT) {
    this.#userLimit = perUser;
    this.#processLimit = inFlight;
  }

  /** Returns the release of a slot for `userId`, or `null` when the user or the process is full. */
  acquire(userId: string): (() => void) | null {
    const held = this.#perUser.get(userId) ?? 0;
    if (held >= this.#userLimit || this.#total >= this.#processLimit) return null;
    this.#perUser.set(userId, held + 1);
    this.#total += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#total -= 1;
      const left = (this.#perUser.get(userId) ?? 1) - 1;
      if (left === 0) this.#perUser.delete(userId);
      else this.#perUser.set(userId, left);
    };
  }

  /** How many uploads are in flight, for the tests. */
  get inUse(): number {
    return this.#total;
  }
}

/** The one counter of this process. */
export const uploadSlots = new UploadSlots();

/** Returns whether `pathname` is the call of the Gen5 upload's function, whose `url` is `gen5Path`. */
export function isGen5UploadCall(pathname: string, gen5Path: string | undefined): boolean {
  return gen5Path !== undefined && pathname === gen5Path;
}

/** What the gate decided: a refusal to answer with, or a pass with the slot to release after. */
export type Gen5Gate =
  | { readonly kind: "refused"; readonly response: Response }
  | { readonly kind: "pass"; readonly release: () => void };

const NO_SLOT = () => undefined;

/**
 * Decides on a call of the Gen5 upload's server function before its body is read. A caller with
 * no valid session keeps the form limit of every other function (411 or 413, and the body is not
 * read); a signed-in caller gets {@link GEN5_FORM_BODY_MAX} and a slot of {@link UploadSlots},
 * or 429 when none is free. Every refusal closes the connection and is logged with its code.
 * The function's own middleware checks the role and the lab after this.
 */
export async function gateGen5Upload(
  request: Request,
  sessionUserId: (headers: Headers) => Promise<string | null>,
  slots: UploadSlots = uploadSlots,
): Promise<Gen5Gate> {
  const userId = await sessionUserId(request.headers);
  const refusal = refuseFormBody(request, userId === null ? FORM_BODY_MAX : GEN5_FORM_BODY_MAX);
  if (refusal !== null) return { kind: "refused", response: refusal };
  if (userId === null) return { kind: "pass", release: NO_SLOT };
  const release = slots.acquire(userId);
  if (release === null) {
    logBodyRefusal(request, { reason: "upload_busy", status: 429 });
    return {
      kind: "refused",
      response: new Response(null, { status: 429, headers: BODY_REFUSAL_HEADERS }),
    };
  }
  return { kind: "pass", release };
}
